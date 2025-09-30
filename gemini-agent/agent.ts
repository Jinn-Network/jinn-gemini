import { spawn } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import dotenv from 'dotenv';
import { agentLogger } from '../worker/logger.js';

dotenv.config({ path: join(process.cwd(), '.env') });

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
  result?: any;
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
  private jobContext?: { jobId: string; jobDefinitionId: string | null; jobName: string; projectRunId: string | null; sourceEventId: string | null; projectDefinitionId: string | null };
  
  // Stdout protection limits (configurable via environment variables)
  private readonly MAX_STDOUT_SIZE = parseInt(process.env.AGENT_MAX_STDOUT_SIZE || '5242880'); // 5MB default
  private readonly MAX_CHUNK_SIZE = parseInt(process.env.AGENT_MAX_CHUNK_SIZE || '102400'); // 100KB default
  private readonly REPETITION_WINDOW = parseInt(process.env.AGENT_REPETITION_WINDOW || '20'); // Track last 20 lines
  private readonly REPETITION_THRESHOLD = parseInt(process.env.AGENT_REPETITION_THRESHOLD || '10'); // Same line 10+ times = loop
  private readonly MAX_IDENTICAL_CHUNKS = parseInt(process.env.AGENT_MAX_IDENTICAL_CHUNKS || '10'); // Same chunk repeated
  
  // Define universal tools once as a class property
  private readonly universalTools = [
    'list_tools',
    'get_details',
    'get_job_context',
    'dispatch_new_job',
    'dispatch_existing_job',
    'create_artifact',
    'signal_completion',
    'search_jobs',
    'search_artifacts',
    'google_web_search',
    'web_fetch'
  ];

  constructor(model: string, enabledTools: string[], jobContext?: { jobId: string; jobDefinitionId: string | null; jobName: string; projectRunId: string | null; sourceEventId: string | null; projectDefinitionId: string | null }) {
    this.model = model;
    this.enabledTools = enabledTools || [];
    this.jobContext = jobContext;
    this.agentRoot = join(process.cwd(), 'gemini-agent');
    this.settingsPath = join(this.agentRoot, '.gemini', 'settings.json');
    
    // Log protection limits
    console.log(`[AGENT] Loop protection enabled - Max stdout: ${(this.MAX_STDOUT_SIZE / 1024 / 1024).toFixed(1)}MB, Repetition threshold: ${this.REPETITION_THRESHOLD} lines`);
  }

  public async run(prompt: string): Promise<AgentResult> {
    const startTime = Date.now();
    try {
      // Set job context for tools to access
      if (this.jobContext) {
        // No in-process setter; canonical path is env-only
      }

      this.generateJobSpecificSettings();
      // Small delay to allow OpenTelemetry resource attributes to settle
      await new Promise(resolve => setTimeout(resolve, 100));
      const result = await this.runGeminiWithTelemetry(prompt);
      const telemetry = await this.parseTelemetryFromFile(result.telemetryFile, result.output, startTime);

      // Attach last API request for diagnostics
      try {
        const lastReq = telemetry.requestText && telemetry.requestText.length > 0
          ? telemetry.requestText[telemetry.requestText.length - 1]
          : undefined;
        telemetry.raw = telemetry.raw || {};
        if (lastReq) telemetry.raw.lastApiRequest = lastReq;
      } catch {}

      // Capture stderr warnings without failing the job
      if (result.stderr && result.stderr.trim()) {
        console.log(`[TELEMETRY] Warning-level errors detected in stderr: ${result.stderr.substring(0, 200)}...`);
        telemetry.raw = telemetry.raw || {};
        telemetry.raw.stderrWarnings = result.stderr;
      }

      // If Gemini exited with non-zero, throw with enriched telemetry
      if (result.exitCode !== 0) {
        // Capture partial output so callers can persist work-in-progress
        try {
          const partialOutput = this.extractFinalOutput(result.output);
          telemetry.raw = telemetry.raw || {};
          (telemetry.raw as any).partialOutput = partialOutput;
        } catch {}
        const err = new Error(`Gemini process exited with code ${result.exitCode}`);
        // Preserve stderr in error message context
        (err as any).stderr = result.stderr;
        throw { error: err, telemetry };
      }

      // Extract final output; if tool responses are JSON blobs from our tools, keep them as-is
      const output = this.extractFinalOutput(result.output);
      return { output, telemetry };
    } catch (error) {
      // Preserve telemetry if the thrown error already includes it (e.g., from non-zero exit path)
      const nestedError = (error as any)?.error ?? error;
      const primaryMessage =
        (nestedError && (nestedError as any).message) ||
        ((error as any)?.message) ||
        String(nestedError ?? error);

      let telemetry: JobTelemetry;
      if (error && typeof error === 'object' && 'telemetry' in (error as any)) {
        // Keep existing telemetry (which may contain raw.partialOutput, toolCalls, etc.)
        telemetry = (error as any).telemetry as JobTelemetry;
        telemetry.duration = telemetry.duration || (Date.now() - startTime);
        telemetry.errorMessage = telemetry.errorMessage || String(primaryMessage);
        telemetry.errorType = telemetry.errorType || this.categorizeError(nestedError);
      } else {
        telemetry = {
          totalTokens: 0,
          toolCalls: [],
          duration: Date.now() - startTime,
          errorMessage: String(primaryMessage),
          errorType: this.categorizeError(nestedError)
        };
      }
      // Preserve the original shape { error, telemetry } but ensure `error` is the actual Error, not the wrapper
      throw { error: nestedError, telemetry };
    } finally {
      // Clear job context
      if (this.jobContext) {
        // No in-process clear; canonical path is env-only
      }
      this.cleanupJobSpecificSettings();
      // Note: telemetry file cleanup handled in runGeminiWithTelemetry result
    }
  }

  private runGeminiWithTelemetry(prompt: string): Promise<{ output: string; telemetryFile: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const args: string[] = ['--yolo'];
      if (this.model) {
        args.unshift('--model', this.model);
      }

      // CRITICAL: Use --prompt flag for non-interactive mode to prevent "Please continue" loops
      // The --prompt flag enables non-interactive mode and appends to stdin (if any)
      args.push('--prompt', '');

      // Debug passthrough
      if (process.argv.includes('--debug') || process.argv.includes('-d')) {
        args.push('--debug');
      }

      // Telemetry flags (workaround for known CLI bug pattern)
      args.push('--telemetry', 'true');
      args.push('--telemetry-target', 'local');
      args.push('--telemetry-otlp-endpoint', ''); // prevent network attempts
      args.push('--telemetry-log-prompts', 'true');

        // Telemetry outfile
        const telemetryFile = `/tmp/telemetry-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.json`;
        args.push('--telemetry-outfile', telemetryFile);

      // Persist the last prompt locally for debugging/repro and send via stdin + --prompt for non-interactive mode
      const promptDir = dirname(this.settingsPath);
      try { mkdirSync(promptDir, { recursive: true }); } catch {}
      const lastPromptPath = join(promptDir, 'last-prompt.txt');
      try { writeFileSync(lastPromptPath, prompt, 'utf8'); } catch {}

      console.log(`[TELEMETRY] Will write telemetry to: ${telemetryFile}`);
      console.log(`Spawning Gemini CLI with model: ${this.model} (prompt provided via stdin + --prompt flag for non-interactive mode)`);

      // Propagate job context to the MCP server via environment variables so the separate
      // MCP process can read them on startup
      const envWithJob: NodeJS.ProcessEnv = { ...process.env };
      try {
        if (this.jobContext) {
          envWithJob.JINN_JOB_ID = this.jobContext.jobId || '';
          envWithJob.JINN_JOB_DEFINITION_ID = this.jobContext.jobDefinitionId || '';
          envWithJob.JINN_JOB_NAME = this.jobContext.jobName || '';
          envWithJob.JINN_PROJECT_RUN_ID = this.jobContext.projectRunId || '';
          envWithJob.JINN_SOURCE_EVENT_ID = this.jobContext.sourceEventId || '';
          envWithJob.JINN_PROJECT_DEFINITION_ID = this.jobContext.projectDefinitionId || '';
        }
      } catch {}

      const geminiProcess = spawn('gemini', args, {
        cwd: this.agentRoot,
        env: envWithJob
      });

      let stdout = '';
      let stderr = '';
      let terminated = false;
      let terminationReason = '';
      
      // Tracking variables for protection
      // Consecutive-only line repetition tracking
      let lastTrackedLine: string | null = null;
      let consecutiveRepeatCount = 0;
      const chunkHistory: string[] = [];
      let lineCount = 0;
      let lastLineTime = Date.now();
      
      // Removed time-based process timeout

      // Feed prompt to stdin (combined with --prompt flag for non-interactive mode)
      try {
        geminiProcess.stdin.write(prompt);
        geminiProcess.stdin.end();
      } catch {}

      geminiProcess.stdout.on('data', (data) => {
        if (terminated) return;
        
        const chunk = data.toString();
        
        // Check chunk size
        if (chunk.length > this.MAX_CHUNK_SIZE) {
          console.warn(`[LOOP DETECTION] Terminating process due to large chunk (${chunk.length} bytes)`);
          terminated = true;
          terminationReason = `Large chunk detected: ${chunk.length} bytes`;
          geminiProcess.kill('SIGTERM');
          return;
        }
        
        // Check total stdout size
        if (stdout.length + chunk.length > this.MAX_STDOUT_SIZE) {
          console.warn(`[LOOP DETECTION] Terminating process due to output size limit (${stdout.length + chunk.length} bytes)`);
          terminated = true;
          terminationReason = `Output size limit exceeded: ${(stdout.length + chunk.length) / 1024 / 1024}MB`;
          geminiProcess.kill('SIGTERM');
          return;
        }
        
        // Check for identical chunk repetition
        chunkHistory.push(chunk);
        if (chunkHistory.length > this.MAX_IDENTICAL_CHUNKS) {
          chunkHistory.shift();
        }
        
        const identicalChunks = chunkHistory.filter(c => c === chunk).length;
        if (identicalChunks >= this.MAX_IDENTICAL_CHUNKS) {
          console.warn(`[LOOP DETECTION] Terminating process due to identical chunk repetition (${identicalChunks} times)`);
          terminated = true;
          terminationReason = `Identical chunks repeated ${identicalChunks} times`;
          geminiProcess.kill('SIGTERM');
          return;
        }
        
        // Process lines for repetition detection and rate limiting
        const lines = chunk.split('\n');
        const currentTime = Date.now();
        
        for (const line of lines) {
          if (line.trim().length > 0) {
            lineCount++;
            
            // Removed per-second output rate limiting
            
            // Line repetition detection (consecutive-only) with benign prefix ignore
            const isBenignPrefix = /^\s*call:/i.test(line);
            if (!isBenignPrefix) {
              if (lastTrackedLine === line) {
                consecutiveRepeatCount += 1;
              } else {
                lastTrackedLine = line;
                consecutiveRepeatCount = 1;
              }
              if (consecutiveRepeatCount >= this.REPETITION_THRESHOLD) {
                console.warn(`[LOOP DETECTION] Terminating process due to consecutive repetitive output: "${line.substring(0, 100)}..."`);
                terminated = true;
                terminationReason = `Consecutive repetitive line detected ${consecutiveRepeatCount} times`;
                geminiProcess.kill('SIGTERM');
                return;
              }
            } else {
              // Reset repetition tracking when encountering benign prefixes
              lastTrackedLine = null;
              consecutiveRepeatCount = 0;
            }
            
            // Console logging (existing logic)
            const truncatedLine = line.length > 200 ? line.substring(0, 200) + '...' : line;
            agentLogger.output(truncatedLine);
          }
        }
        
        // Add chunk to stdout if not terminated
        stdout += chunk;
      });

      geminiProcess.stderr.on('data', (data) => {
        const chunk = data.toString();
        chunk.split('\n').forEach((line: string) => {
            if (line.trim().length > 0) {
                const truncatedLine = line.length > 200 ? line.substring(0, 200) + '...' : line;
                console.error(truncatedLine);
            }
        });
        stderr += chunk;
      });

      geminiProcess.on('close', (code) => {
        // No timeout to clear
        
        // Inspect stderr for API/tool errors even if process exits 0
        let hasApiError = (stderr && (
          stderr.includes('Error when talking to Gemini API') ||
          stderr.toLowerCase().includes('could not parse tool response')
        )) || false;
        const rawExit = typeof code === 'number' ? code : 0;
        let exitCode = hasApiError ? (rawExit || 1) : rawExit;

        // Downgrade specific tool errors to warnings so the process can continue successfully
        const isToolNotFound = typeof stderr === 'string' && /tool\s+"?.+?"?\s+not\s+found\s+in\s+registry/i.test(stderr);
        if (isToolNotFound) {
          // Treat as warning-only: do not fail the run on missing tool
          hasApiError = false;
          exitCode = 0;
        }
        
        // Handle termination cases
        if (terminated) {
          console.log(`[LOOP DETECTION] Process terminated: ${terminationReason}`);
          // Add termination reason to output for debugging
          stdout += `\n\n[PROCESS TERMINATED: ${terminationReason}]`;
          // Force non-zero exit code for terminated processes
          exitCode = exitCode || 1;
        }
        
        resolve({ output: stdout, telemetryFile, stderr, exitCode });
      });

      geminiProcess.on('error', (err) => {
        // No timeout to clear
        
        // Surface as a synthetic non-zero exit with captured streams
        const exitCode = 1;
        const synthetic = `Gemini spawn error: ${err?.message || String(err)}`;
        resolve({ output: stdout, telemetryFile, stderr: `${stderr}\n${synthetic}`.trim(), exitCode });
      });
    });
  }

  private generateJobSpecificSettings(): void {
    // Always generate settings if we have universal tools, even if no job-specific tools
    if (this.enabledTools.length === 0 && this.universalTools.length === 0) return;
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

      // UNIVERSAL TOOLS: Every agent automatically gets these core capabilities
      // regardless of what's specified in their job definition. This ensures
      // all agents can plan projects, create jobs, manage artifacts, etc.

      // Merge universal tools with job-specific tools, removing duplicates
      const allTools = [...this.universalTools, ...this.enabledTools];
      const uniqueTools = [...new Set(allTools)];

      // Include the merged tool set (universal + job-specific)
      mcpServer.includeTools = uniqueTools;

      // Exclude native tools not enabled, BUT allow web tools by default
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
        // Intentionally exclude web tools from this list so they remain enabled by default:
        // 'web_fetch', 'google_web_search'
      ];

      // Always-enabled native tools
      const alwaysEnabledNativeTools = ['web_fetch', 'google_web_search'];

      // Compute native tools to exclude (never exclude always-enabled web tools)
      const nativeToolsToExclude = allNativeTools.filter(tool => !alwaysEnabledNativeTools.includes(tool));
      templateSettings.excludeTools = nativeToolsToExclude;

      // Ensure directory exists
      const settingsDir = dirname(this.settingsPath);
      mkdirSync(settingsDir, { recursive: true });

      writeFileSync(this.settingsPath, JSON.stringify(templateSettings, null, 2));
      console.log(`Generated job-specific settings for server '${serverName}' with tools: ${uniqueTools.join(', ')}`);
      console.log(`  - Universal tools: ${this.universalTools.join(', ')}`);
      console.log(`  - Job-specific tools: ${this.enabledTools.join(', ') || 'none'}`);
      console.log(`Excluded native tools: ${nativeToolsToExclude.join(', ')}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('Failed to generate job-specific settings:', errorMsg);
      throw error;
    }
  }

  private cleanupJobSpecificSettings(): void {
    // Always cleanup if we have universal tools, even if no job-specific tools
    if (this.enabledTools.length === 0 && this.universalTools.length === 0) return;
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

  private cleanupTelemetryFile(telemetryFile: string): void {
    if (!telemetryFile || telemetryFile.trim() === '') return;
    try {
      unlinkSync(telemetryFile);
      console.log('Cleaned up telemetry file.');
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('Failed to clean up telemetry file:', errorMsg);
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
      if (readFileSync && telemetryFile && telemetryFile.trim() !== '') {
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

      // Extract tool results from conversation history and attach to tool calls
      this.attachToolResultsToToolCalls(telemetry);

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

  private attachToolResultsToToolCalls(telemetry: JobTelemetry): void {
    if (!telemetry.requestText || telemetry.toolCalls.length === 0) return;

    try {
      // Parse conversation history from requestText to find tool responses
      for (const requestText of telemetry.requestText) {
        if (typeof requestText !== 'string') continue;

        try {
          const conversations = JSON.parse(requestText);
          if (!Array.isArray(conversations)) continue;

          for (const message of conversations) {
            if (message.role === 'user' && Array.isArray(message.parts)) {
              for (const part of message.parts) {
                if (part.functionResponse && part.functionResponse.name && part.functionResponse.response) {
                  const toolName = part.functionResponse.name;
                  const response = part.functionResponse.response;

                  // Find corresponding tool call and attach result
                  const toolCall = telemetry.toolCalls.find(tc => 
                    tc.tool === toolName && tc.success && !tc.result
                  );

                  if (toolCall && response.output) {
                    try {
                      // Parse the tool response output
                      const output = JSON.parse(response.output);
                      if (output.data && output.meta?.ok) {
                        toolCall.result = output.data;
                        console.log(`[TELEMETRY] Attached result to ${toolName} tool call:`, Object.keys(output.data));
                      }
                    } catch (parseError) {
                      // If JSON parsing fails, store raw output
                      toolCall.result = { rawOutput: response.output };
                    }
                  }
                }
              }
            }
          }
        } catch (parseError) {
          // Skip malformed conversation JSON
          continue;
        }
      }
    } catch (error: any) {
      console.warn(`[TELEMETRY] Failed to attach tool results:`, error.message);
    }
  }

  private categorizeError(error: any): string {
    if (!error) return 'UNKNOWN';
    const message = error.message || String(error);

    if (message.includes('exited with code')) return 'PROCESS_ERROR';
    if (message.includes('timeout') || message.includes('Process timeout')) return 'TIMEOUT';
    if (message.includes('PROCESS TERMINATED')) return 'LOOP_PROTECTION';
    if (message.includes('Output size limit') || message.includes('Repetitive line')) return 'LOOP_PROTECTION';
    if (message.includes('High output rate') || message.includes('Large chunk')) return 'LOOP_PROTECTION';
    if (message.includes('ENOTFOUND') || message.includes('network')) return 'NETWORK_ERROR';
    if (message.includes('API') || message.includes('401') || message.includes('403')) return 'API_ERROR';
    if (message.includes('tool') || message.includes('function')) return 'TOOL_ERROR';

    return 'SYSTEM_ERROR';
  }
}