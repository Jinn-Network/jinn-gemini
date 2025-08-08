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

      // Capture stderr warnings without failing the job
      if (result.stderr && result.stderr.trim()) {
        console.log(`[TELEMETRY] Warning-level errors detected in stderr: ${result.stderr.substring(0, 200)}...`);
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

  private runGeminiWithTelemetry(prompt: string): Promise<{ output: string; telemetryFile: string; stderr?: string }> {
    return new Promise((resolve, reject) => {
      const args = ['--prompt', prompt, '--yolo'];
      if (this.model) {
        args.unshift('--model', this.model);
      }

      // Debug passthrough
      if (process.argv.includes('--debug') || process.argv.includes('-d')) {
        args.push('--debug');
      }

      // Telemetry flags (workaround for known CLI bug pattern)
      args.push('--telemetry');
      args.push('--telemetry-target', 'local');
      args.push('--telemetry-otlp-endpoint', ''); // prevent network attempts
      args.push('--telemetry-log-prompts');

      // Telemetry outfile
      const telemetryFile = `/tmp/telemetry-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.json`;
      args.push('--telemetry-outfile', telemetryFile);

      console.log(`[TELEMETRY] Will write telemetry to: ${telemetryFile}`);
      console.log(`Spawning Gemini CLI with model: ${this.model} and prompt: "${prompt.substring(0, 100)}..."`);

      const geminiProcess = spawn('gemini', args, {
        cwd: this.agentRoot,
        env: { ...process.env }
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
          resolve({ output: stdout, telemetryFile, stderr });
        }
      });

      geminiProcess.on('error', (err) => reject(err));
    });
  }

  private generateJobSpecificSettings(): void {
    if (this.enabledTools.length === 0) return;
    try {
      const templateFileName = process.env.USE_TSX_MCP === '1'
        ? 'settings.template.dev.json'
        : 'settings.template.json';
      const templatePath = join(this.agentRoot, templateFileName);
      const templateSettings: GeminiSettings = JSON.parse(readFileSync(templatePath, 'utf8'));

      if (!templateSettings.mcpServers) {
        throw new Error('No MCP servers configured in settings.template.json');
      }

      const serverName = templateSettings.mcpServers.metacog ? 'metacog' : Object.keys(templateSettings.mcpServers)[0];
      if (!serverName) throw new Error('No MCP servers found in template configuration');

      const mcpServer = templateSettings.mcpServers[serverName];
      if (!mcpServer) throw new Error(`MCP server '${serverName}' not found in template configuration`);

      // Include only job-specific tools
      mcpServer.includeTools = this.enabledTools;

      // Exclude native tools not enabled
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

      const nativeToolsToExclude = this.enabledTools.length === 0
        ? allNativeTools
        : allNativeTools.filter(tool => !this.enabledTools.includes(tool));
      templateSettings.excludeTools = nativeToolsToExclude;

      // Ensure directory exists
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
    if (this.enabledTools.length === 0) return;
    try {
      unlinkSync(this.settingsPath);
      console.log('Cleaned up job-specific settings.');
    } catch (error: any) {
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
      raw: {}
    };

    try {
      const telemetryData = this.parseStructuredTelemetry(output);
      telemetry.totalTokens = telemetryData.totalTokens || 0;
      telemetry.toolCalls = telemetryData.toolCalls || [];
      telemetry.requestText = telemetryData.requestText;
      telemetry.responseText = telemetryData.responseText;

      telemetry.raw = {
        sessionId: telemetryData.sessionId,
        promptId: telemetryData.promptId,
        modelName: telemetryData.modelName,
        originalOutput: output.substring(0, 1000)
      };
    } catch (error: any) {
      console.error('Error parsing telemetry:', error);
      telemetry.errorMessage = `Telemetry parsing failed: ${error.message}`;
      telemetry.raw = { parseError: error.message, output: output.substring(0, 500) };
    }

    return telemetry;
  }

  private async parseTelemetryFromFile(telemetryFile: string, output: string, startTime: number): Promise<JobTelemetry> {
    try {
      if (readFileSync && telemetryFile) {
        console.log(`[TELEMETRY] Attempting to read telemetry file: ${telemetryFile}`);
        const telemetryContent = readFileSync(telemetryFile, 'utf8');

        // Optional safety: cap processing to avoid runaway memory usage
        const maxProcessChars = 50 * 1024 * 1024; // 50MB
        const contentToParse = telemetryContent.length > maxProcessChars
          ? telemetryContent.substring(0, maxProcessChars)
          : telemetryContent;

        console.log(`[TELEMETRY] File content length: ${telemetryContent.length} characters`);
        console.log(`[TELEMETRY] First 1000 chars: ${telemetryContent.substring(0, 1000)}`);
        console.log(`[TELEMETRY] Last 500 chars: ${telemetryContent.substring(Math.max(0, telemetryContent.length - 500))}`);

        const result = this.parseTelemetryFromContent(contentToParse, startTime);

        console.log(`[TELEMETRY] Telemetry file preserved for inspection: ${telemetryFile}`);
        return result;
      }
    } catch (error: any) {
      console.warn(`[TELEMETRY] Failed to read telemetry file ${telemetryFile}:`, error.message);
      try {
        const fs = await import('fs');
        const exists = fs.existsSync(telemetryFile);
        console.log(`[TELEMETRY] File exists: ${exists}`);
        if (exists) {
          const stats = fs.statSync(telemetryFile);
          console.log(`[TELEMETRY] File size: ${stats.size} bytes`);
        }
      } catch (fsError: any) {
        console.warn(`[TELEMETRY] Failed to check file stats:`, fsError.message);
      }
    }

    console.log(`[TELEMETRY] Falling back to output parsing`);
    return this.parseTelemetryFromOutput(output, startTime);
  }

  // Streaming JSON parser: assembles complete JSON objects from mixed-content file
  private parseTelemetryFromContent(content: string, startTime: number): JobTelemetry {
    const telemetry: JobTelemetry = {
      totalTokens: 0,
      toolCalls: [],
      duration: Date.now() - startTime,
      raw: {}
    };

    try {
      console.log(`[TELEMETRY] Parsing telemetry content (${content.length} chars)...`);

      const telemetryEvents: any[] = [];
      let buffer = '';
      let started = false;
      let braceCount = 0;
      let inString = false;
      let escapeNext = false;
      let parseErrors = 0;
      const maxParseErrors = 10;

      for (let i = 0; i < content.length; i++) {
        const ch = content[i];

        if (!started) {
          if (ch === '{') {
            started = true;
            braceCount = 1;
            buffer = '{';
            inString = false;
            escapeNext = false;
          }
          continue;
        }

        buffer += ch;

        if (escapeNext) {
          escapeNext = false;
        } else if (ch === '\\' && inString) {
          escapeNext = true;
        } else if (ch === '"') {
          inString = !inString;
        } else if (!inString) {
          if (ch === '{') braceCount++;
          else if (ch === '}') braceCount--;
        }

        if (started && braceCount === 0) {
          const candidate = buffer.trim();
          try {
            const obj = JSON.parse(candidate);
            telemetryEvents.push(obj);
          } catch (e: any) {
            parseErrors++;
            if (parseErrors <= maxParseErrors) {
              console.log(`[TELEMETRY] Failed to parse JSON object: ${e.message}. Sample: ${candidate.substring(0, 120)}${candidate.length > 120 ? '...' : ''}`);
            } else if (parseErrors === maxParseErrors + 1) {
              console.log(`[TELEMETRY] Too many parse errors (${parseErrors}+). Further errors suppressed.`);
            }
          }
          started = false;
          buffer = '';
          inString = false;
          escapeNext = false;
        }
      }

      console.log(`[TELEMETRY] Successfully parsed ${telemetryEvents.length} telemetry events${parseErrors ? ` (${parseErrors} parse errors)` : ''}`);

      // Process events
      for (const event of telemetryEvents) {
        if (!event || !event.attributes) continue;
        const attrs = event.attributes;
        const eventName = attrs['event.name'];

        if (attrs['session.id'] && !telemetry.raw.sessionId) {
          telemetry.raw.sessionId = attrs['session.id'];
        }

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

      telemetry.raw.eventCount = telemetryEvents.length;
      telemetry.raw.events = telemetryEvents.map(e => e.attributes?.['event.name']).filter(Boolean);
      console.log(`[TELEMETRY] Final parsing results - tokens: ${telemetry.totalTokens}, tools: ${telemetry.toolCalls.length}, session: ${telemetry.raw.sessionId}`);
    } catch (error: any) {
      console.error(`[TELEMETRY] Error parsing telemetry content:`, error);
      telemetry.errorMessage = `Telemetry file parsing failed: ${error.message}`;
      telemetry.raw = { parseError: error.message, content: content.substring(0, 500) };
    }

    return telemetry;
  }

  private parseStructuredTelemetry(output: string): any {
    const result: any = { toolCalls: [], totalTokens: 0 };
    const lines = output.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.includes('-> session.id: Str(')) {
        result.sessionId = this.extractValue(line, 'Str');
      } else if (line.includes('-> prompt_id: Str(')) {
        result.promptId = this.extractValue(line, 'Str');
      } else if (line.includes('-> model: Str(')) {
        result.modelName = this.extractValue(line, 'Str');
      } else if (line.includes('-> function_name: Str(')) {
        const functionName = this.extractValue(line, 'Str');
        if (functionName) {
          const duration = this.findDurationNearLine(lines, i);
          result.toolCalls.push({
            tool: functionName,
            duration_ms: duration || 0,
            success: true
          });
        }
      } else if (line.includes('Value: ') && line.includes('Int(')) {
        const tokenValue = this.extractValue(line, 'Int');
        if (tokenValue && parseInt(tokenValue) > result.totalTokens) {
          result.totalTokens = parseInt(tokenValue);
        }
      } else if (line.includes('Tool call:') && line.includes('Duration:')) {
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
    const pattern = type === 'Str' ? /Str\(([^)]+)\)/ : /Int\(([^)]+)\)/;
    const match = line.match(pattern);
    return match ? match[1] : null;
  }

  private findDurationNearLine(lines: string[], startIndex: number): number | null {
    for (let i = startIndex; i < Math.min(startIndex + 5, lines.length); i++) {
      if (lines[i].includes('-> duration_ms: Int(')) {
        const duration = this.extractValue(lines[i], 'Int');
        return duration ? parseInt(duration) : null;
      }
    }
    return null;
  }

  private extractFinalOutput(output: string): string {
    const lines = output.split('\n');
    const finalOutput: string[] = [];

    for (const line of lines) {
      if (line.includes('-> ') || line.includes('Trace ID:') || line.includes('otel-collector')) continue;
      if (line.includes('OpenTelemetry SDK')) continue;
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