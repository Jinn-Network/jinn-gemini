import { spawn } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// Add this interface for better type safety
interface MCPServerConfig {
  command: string;
  args?: string[];
  includeTools?: string[];
  excludeTools?: string[];
  trust?: boolean;
}

interface GeminiSettings {
  mcpServers?: {
    [serverName: string]: MCPServerConfig;
  };
  coreTools?: string[];
  excludeTools?: string[];
}

interface ToolCall {
  tool: string;
  args?: any;
  duration_ms?: number;
  success: boolean;
  error?: string;
}

interface JobTelemetry {
  requestText?: any[];
  responseText?: any[];
  totalTokens: number;
  toolCalls: ToolCall[];
  duration: number;
  errorMessage?: string;
  errorType?: string;
  raw?: any;
}

interface AgentResult {
  output: string;
  telemetry: JobTelemetry;
}

export class Agent {
    private model: string;
    private enabledTools: string[];
    private settingsPath: string;
    private agentRoot: string;
    private jobContext?: { jobId: string; jobName: string; threadId: string | null };

    constructor(model: string, enabledTools: string[], jobContext?: { jobId: string; jobName: string; threadId: string | null }) {
        this.model = model;
        this.enabledTools = enabledTools || [];
        this.jobContext = jobContext;
        this.agentRoot = join(process.cwd(), 'gemini-agent');
        // Define the path for the final, job-specific settings file
        // Use .gemini directory relative to the agent's working directory
        this.settingsPath = join(this.agentRoot, '.gemini', 'settings.json');
    }

    public async run(prompt: string): Promise<AgentResult> {
        const startTime = Date.now();
        try {
            // Set job context for tools to access
            if (this.jobContext) {
                const { setJobContext } = await import('./mcp/tools/shared/supabase.js');
                setJobContext(this.jobContext.jobId, this.jobContext.jobName, this.jobContext.threadId);
            }

            this.generateJobSpecificSettings();
            // Small delay to allow OpenTelemetry resource attributes to settle
            await new Promise(resolve => setTimeout(resolve, 100));
            const result = await this.runGeminiWithTelemetry(prompt);
            const telemetry = await this.parseTelemetryFromFile(result.telemetryFile, result.output, startTime);

            // Check for stderr warnings even on successful runs
            if (result.stderr && result.stderr.trim()) {
                console.log(`[TELEMETRY] Warning-level errors detected in stderr: ${result.stderr.substring(0, 200)}...`);
                // Add stderr warnings to telemetry but don't fail the job
                telemetry.raw = telemetry.raw || {};
                telemetry.raw.stderrWarnings = result.stderr;
            }

            return { output: this.extractFinalOutput(result.output), telemetry };
        } catch (error) {
            const telemetry: JobTelemetry = {
                totalTokens: 0,
                toolCalls: [],
                duration: Date.now() - startTime,
                errorMessage: error instanceof Error ? error.message : String(error),
                errorType: this.categorizeError(error)
            };
            throw { error, telemetry };
        } finally {
            // Clear job context
            if (this.jobContext) {
                const { clearJobContext } = await import('./mcp/tools/shared/supabase.js');
                clearJobContext();
            }
            this.cleanupJobSpecificSettings();
        }
    }

    private runGeminiWithTelemetry(prompt: string): Promise<{output: string, telemetryFile: string, stderr?: string}> {
        return new Promise((resolve, reject) => {
            const args = ['--prompt', prompt, '--yolo'];
            if (this.model) {
                args.unshift('--model', this.model);
            }

            // Check for debug flag from command line args
            if (process.argv.includes('--debug') || process.argv.includes('-d')) {
                args.push('--debug');
            }

            // Add telemetry flags with workaround for known bug #5063
            // https://github.com/google-gemini/gemini-cli/issues/5063
            args.push('--telemetry');
            args.push('--telemetry-target', 'local');
            args.push('--telemetry-otlp-endpoint', ''); // Empty endpoint to prevent connection attempts
            args.push('--telemetry-log-prompts');

            // Write telemetry to a temporary file for local parsing
            const telemetryFile = `/tmp/telemetry-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.json`;
            args.push('--telemetry-outfile', telemetryFile);

            console.log(`[TELEMETRY] Will write telemetry to: ${telemetryFile}`);

            console.log(`Spawning Gemini CLI with model: ${this.model} and prompt: "${prompt.substring(0, 100)}..."`);
            // The Gemini CLI will automatically find and load GEMINI.md and .gemini/settings.json
            // from the working directory.
            const geminiProcess = spawn('gemini', args, {
                cwd: this.agentRoot,
                env: {
                    ...process.env
                }
            });

            let stdout = '';
            let stderr = '';

            geminiProcess.stdout.on('data', (data) => {
                const chunk = data.toString();
                console.log('Gemini CLI stdout:', chunk);
                stdout += chunk;
            });

            geminiProcess.stderr.on('data', (data) => {
                const chunk = data.toString();
                console.error('Gemini CLI stderr:', chunk);
                stderr += chunk;
            });

            geminiProcess.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`Gemini process exited with code ${code}\n${stderr}`));
                } else {
                    // Include stderr even on successful runs for warning-level errors
                    resolve({ output: stdout, telemetryFile, stderr });
                }
            });

            geminiProcess.on('error', (err) => {
                reject(err);
            });
        });
    }

    private generateJobSpecificSettings(): void {
        if (this.enabledTools.length === 0) {
            return; // No tools to enable, so no settings file needed.
        }
        try {
            // Look for template in the gemini-agent directory
            const templatePath = join(this.agentRoot, 'settings.template.json');
            const templateSettings: GeminiSettings = JSON.parse(readFileSync(templatePath, 'utf8'));

            if (!templateSettings.mcpServers) {
                throw new Error('No MCP servers configured in settings.template.json');
            }

            const serverName = templateSettings.mcpServers.metacog ? 'metacog' : Object.keys(templateSettings.mcpServers)[0];

            if (!serverName) {
                throw new Error('No MCP servers found in template configuration');
            }

            const mcpServer = templateSettings.mcpServers[serverName];
            if (!mcpServer) {
                throw new Error(`MCP server '${serverName}' not found in template configuration`);
            }

            // Inject the job-specific tools (includes both MCP tools and native web tools)
            mcpServer.includeTools = this.enabledTools;

            // Exclude all native tools except the ones in enabledTools
            const allNativeTools = [
                'list_directory',
                'read_file',
                'write_file',
                'search_file_content',
                'glob',
                'replace',
                'read_many_files',
                'run_shell_command',
                'save_memory',
                'web_fetch',
                'google_web_search'
            ];

            // When enabledTools is empty, exclude ALL native tools
            // Otherwise, only exclude native tools that are NOT in the enabledTools array
            const nativeToolsToExclude = this.enabledTools.length === 0 
                ? allNativeTools  // Exclude all native tools when no tools enabled
                : allNativeTools.filter(tool => !this.enabledTools.includes(tool));
            templateSettings.excludeTools = nativeToolsToExclude;

            // Ensure the directory exists before writing the file
            const settingsDir = dirname(this.settingsPath);
            mkdirSync(settingsDir, { recursive: true });

            writeFileSync(this.settingsPath, JSON.stringify(templateSettings, null, 2));

            console.log(`Generated job-specific settings for server '${serverName}' with tools: ${this.enabledTools.join(', ')}`);
            console.log(`Excluded native tools: ${nativeToolsToExclude.join(', ')}`);

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error('Failed to generate job-specific settings:', errorMsg);
            throw error;
        }
    }

    private cleanupJobSpecificSettings(): void {
        if (this.enabledTools.length === 0) {
            return;
        }
        try {
            unlinkSync(this.settingsPath);
            console.log('Cleaned up job-specific settings.');
        } catch (error) {
            // We can ignore errors if the file doesn't exist, but log others.
            if (error.code !== 'ENOENT') {
                const errorMsg = error instanceof Error ? error.message : String(error);
                console.error('Failed to clean up job-specific settings:', errorMsg);
            }
        }
    }

    private parseTelemetryFromOutput(output: string, startTime: number): JobTelemetry {
        const telemetry: JobTelemetry = {
            totalTokens: 0,
            toolCalls: [],
            duration: Date.now() - startTime,
            raw: {} // Store structured data
        };

        try {
            // Parse structured telemetry using key-value extraction
            const telemetryData = this.parseStructuredTelemetry(output);

            // Extract token count - look for metrics with Value: pattern
            telemetry.totalTokens = telemetryData.totalTokens || 0;

            // Extract tool calls from structured log entries
            telemetry.toolCalls = telemetryData.toolCalls || [];

            // Extract request/response text if available
            telemetry.requestText = telemetryData.requestText;
            telemetry.responseText = telemetryData.responseText;

            // Store structured metadata
            telemetry.raw = {
                sessionId: telemetryData.sessionId,
                promptId: telemetryData.promptId,
                modelName: telemetryData.modelName,
                originalOutput: output.substring(0, 1000) // Store first 1KB for debugging
            };

        } catch (error) {
            console.error('Error parsing telemetry:', error);
            telemetry.errorMessage = `Telemetry parsing failed: ${error.message}`;
            telemetry.raw = { parseError: error.message, output: output.substring(0, 500) };
        }

        return telemetry;
    }

    private async parseTelemetryFromFile(telemetryFile: string, output: string, startTime: number): Promise<JobTelemetry> {
        try {
            // Try to read telemetry from file first
            if (readFileSync && telemetryFile) {
                console.log(`[TELEMETRY] Attempting to read telemetry file: ${telemetryFile}`);
                const telemetryContent = readFileSync(telemetryFile, 'utf8');
                console.log(`[TELEMETRY] File content length: ${telemetryContent.length} characters`);
                console.log(`[TELEMETRY] First 1000 chars: ${telemetryContent.substring(0, 1000)}`);
                console.log(`[TELEMETRY] Last 500 chars: ${telemetryContent.substring(Math.max(0, telemetryContent.length - 500))}`);

                const result = this.parseTelemetryFromContent(telemetryContent, startTime);

                // Keep telemetry file for inspection (will be overwritten by next job)
                console.log(`[TELEMETRY] Telemetry file preserved for inspection: ${telemetryFile}`);

                return result;
            }
        } catch (error) {
            console.warn(`[TELEMETRY] Failed to read telemetry file ${telemetryFile}:`, error.message);

            // Check if file exists
            try {
                const fs = await import('fs');
                const exists = fs.existsSync(telemetryFile);
                console.log(`[TELEMETRY] File exists: ${exists}`);
                if (exists) {
                    const stats = fs.statSync(telemetryFile);
                    console.log(`[TELEMETRY] File size: ${stats.size} bytes`);
                }
            } catch (fsError) {
                console.warn(`[TELEMETRY] Failed to check file stats:`, fsError.message);
            }
        }

        // Fallback to parsing from output
        console.log(`[TELEMETRY] Falling back to output parsing`);
        return this.parseTelemetryFromOutput(output, startTime);
    }

    private parseTelemetryFromContent(content: string, startTime: number): JobTelemetry {
        const telemetry: JobTelemetry = {
            totalTokens: 0,
            toolCalls: [],
            duration: Date.now() - startTime,
            raw: {}
        };

        try {
            console.log(`[TELEMETRY] Parsing telemetry content (${content.length} chars)...`);

            // Parse newline-delimited JSON objects
            const telemetryEvents = [];
            let currentObject = '';
            let braceCount = 0;

            for (let i = 0; i < content.length; i++) {
                const char = content[i];
                currentObject += char;

                if (char === '{') {
                    braceCount++;
                } else if (char === '}') {
                    braceCount--;

                    // When braceCount reaches 0, we have a complete JSON object
                    if (braceCount === 0) {
                        try {
                            const data = JSON.parse(currentObject.trim());
                            telemetryEvents.push(data);
                        } catch (parseError) {
                            console.log(`[TELEMETRY] Failed to parse JSON object: ${parseError.message}`);
                        }
                        currentObject = '';
                    }
                }
            }

            console.log(`[TELEMETRY] Successfully parsed ${telemetryEvents.length} telemetry events`);

            // Process each telemetry event
            for (const event of telemetryEvents) {
                if (!event || !event.attributes) continue;

                const attrs = event.attributes;
                const eventName = attrs['event.name'];

                // Extract session ID (from any event)
                if (attrs['session.id'] && !telemetry.raw.sessionId) {
                    telemetry.raw.sessionId = attrs['session.id'];
                }

                // Process different event types
                switch (eventName) {
                    case 'gemini_cli.user_prompt':
                        if (attrs['prompt']) {
                            if (!telemetry.requestText) telemetry.requestText = [];
                            telemetry.requestText.push(attrs['prompt']);
                        }
                        if (attrs['prompt_length']) {
                            telemetry.raw.promptLength = attrs['prompt_length'];
                        }
                        break;

                    case 'gemini_cli.api_request':
                        if (attrs['request_text']) {
                            if (!telemetry.requestText) telemetry.requestText = [];
                            telemetry.requestText.push(attrs['request_text']);
                        }
                        if (attrs['model']) {
                            telemetry.raw.model = attrs['model'];
                        }
                        break;

                    case 'gemini_cli.api_response':
                        // Extract token counts - this is the key data we need!
                        if (attrs['total_token_count'] && typeof attrs['total_token_count'] === 'number') {
                            telemetry.totalTokens = Math.max(telemetry.totalTokens, attrs['total_token_count']);
                            console.log(`[TELEMETRY] Found total token count: ${attrs['total_token_count']}`);
                        }
                        if (attrs['input_token_count']) {
                            telemetry.raw.inputTokens = attrs['input_token_count'];
                        }
                        if (attrs['output_token_count']) {
                            telemetry.raw.outputTokens = attrs['output_token_count'];
                        }
                        if (attrs['duration_ms']) {
                            telemetry.raw.apiDurationMs = attrs['duration_ms'];
                        }
                        if (attrs['response_text']) {
                            if (!telemetry.responseText) telemetry.responseText = [];
                            telemetry.responseText.push(attrs['response_text']);
                        }
                        break;

                    case 'gemini_cli.tool_call':
                    case 'gemini_cli.function_call':
                        // Extract function/tool call information
                        telemetry.toolCalls.push({
                            tool: attrs['function_name'] || attrs['tool_name'] || attrs['name'] || 'unknown',
                            success: attrs['success'] !== false,
                            duration_ms: attrs['duration_ms'] || 0,
                            args: attrs['parameters'] || attrs['args'] || attrs['arguments']
                        });
                        console.log(`[TELEMETRY] Found tool call: ${attrs['function_name'] || attrs['tool_name'] || attrs['name']}`);
                        break;
                }
            }

            // Store summary in raw telemetry
            telemetry.raw.eventCount = telemetryEvents.length;
            telemetry.raw.events = telemetryEvents.map(e => e.attributes?.['event.name']).filter(Boolean);

            console.log(`[TELEMETRY] Final parsing results - tokens: ${telemetry.totalTokens}, tools: ${telemetry.toolCalls.length}, session: ${telemetry.raw.sessionId}`);

        } catch (error) {
            console.error(`[TELEMETRY] Error parsing telemetry content:`, error);
            telemetry.errorMessage = `Telemetry file parsing failed: ${error.message}`;
            telemetry.raw = { parseError: error.message, content: content.substring(0, 500) };
        }

        return telemetry;
    }

    private parseStructuredTelemetry(output: string): any {
        const result: any = {
            toolCalls: [],
            totalTokens: 0
        };

        // Split into lines for structured parsing
        const lines = output.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Extract key-value pairs using simple string parsing
            if (line.includes('-> session.id: Str(')) {
                result.sessionId = this.extractValue(line, 'Str');
            }
            else if (line.includes('-> prompt_id: Str(')) {
                result.promptId = this.extractValue(line, 'Str');
            }
            else if (line.includes('-> model: Str(')) {
                result.modelName = this.extractValue(line, 'Str');
            }
            else if (line.includes('-> function_name: Str(')) {
                const functionName = this.extractValue(line, 'Str');
                if (functionName) {
                    // Look for duration in subsequent lines
                    const duration = this.findDurationNearLine(lines, i);
                    result.toolCalls.push({
                        tool: functionName,
                        duration_ms: duration || 0,
                        success: true // Assume success if present in logs
                    });
                }
            }
            else if (line.includes('Value: ') && line.includes('Int(')) {
                const tokenValue = this.extractValue(line, 'Int');
                if (tokenValue && parseInt(tokenValue) > result.totalTokens) {
                    result.totalTokens = parseInt(tokenValue);
                }
            }
            else if (line.includes('Tool call:') && line.includes('Duration:')) {
                // Handle formatted tool call messages: "Tool call: create_record. Success: true. Duration: 184ms."
                const toolMatch = line.match(/Tool call: ([^.]+)\. Success: (true|false)\. Duration: (\d+)ms\./);
                if (toolMatch) {
                    result.toolCalls.push({
                        tool: toolMatch[1],
                        success: toolMatch[2] === 'true',
                        duration_ms: parseInt(toolMatch[3])
                    });
                }
            }
        }

        return result;
    }

    private extractValue(line: string, type: 'Str' | 'Int'): string | null {
        const pattern = type === 'Str'
            ? /Str\(([^)]+)\)/
            : /Int\(([^)]+)\)/;

        const match = line.match(pattern);
        return match ? match[1] : null;
    }

    private findDurationNearLine(lines: string[], startIndex: number): number | null {
        // Look for duration_ms in the next few lines
        for (let i = startIndex; i < Math.min(startIndex + 5, lines.length); i++) {
            if (lines[i].includes('-> duration_ms: Int(')) {
                const duration = this.extractValue(lines[i], 'Int');
                return duration ? parseInt(duration) : null;
            }
        }
        return null;
    }

    private extractSessionId(output: string): string | undefined {
        const match = output.match(/session\.id: Str\(([^)]+)\)/);
        return match ? match[1] : undefined;
    }

    private extractPromptId(output: string): string | undefined {
        const match = output.match(/prompt_id: Str\(([^)]+)\)/);
        return match ? match[1] : undefined;
    }

    private extractModelVersion(output: string): string | undefined {
        const match = output.match(/model: Str\(([^)]+)\)/);
        return match ? match[1] : undefined;
    }

    private extractFinalOutput(output: string): string {
        // Extract the final user-facing output, excluding telemetry data
        const lines = output.split('\n');
        const finalOutput = [];

        for (const line of lines) {
            // Skip telemetry lines
            if (line.includes('-> ') || line.includes('Trace ID:') || line.includes('otel-collector')) {
                continue;
            }
            // Skip OpenTelemetry messages
            if (line.includes('OpenTelemetry SDK')) {
                continue;
            }
            finalOutput.push(line);
        }

        return finalOutput.join('\n').trim();
    }

    private categorizeError(error: any): string {
        if (!error) return 'UNKNOWN';

        const message = error.message || String(error);

        if (message.includes('exited with code')) return 'PROCESS_ERROR';
        if (message.includes('timeout')) return 'TIMEOUT';
        if (message.includes('ENOTFOUND') || message.includes('network')) return 'NETWORK_ERROR';
        if (message.includes('API') || message.includes('401') || message.includes('403')) return 'API_ERROR';
        if (message.includes('tool') || message.includes('function')) return 'TOOL_ERROR';

        return 'SYSTEM_ERROR';
    }
}