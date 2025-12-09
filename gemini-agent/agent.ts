import { spawn } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, existsSync, statSync } from 'fs';
import { join, dirname, resolve, isAbsolute, delimiter } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { agentLogger } from '../logging/index.js';
import { getOptionalCodeMetadataRepoRoot } from '../config/index.js';
import { getRepoRoot } from '../shared/repo_utils.js';
import { computeToolPolicy, UNIVERSAL_TOOLS, type ToolPolicyResult } from './toolPolicy.js';

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
  inputTokens?: number;
  outputTokens?: number;
  totalTokens: number;
  toolCalls: ToolCall[];
  duration: number;
  errorMessage?: string;
  errorType?: string;
  raw?: any;
}

interface AgentResult {
  output: string;
  structuredSummary?: string;
  telemetry: JobTelemetry;
}

export class Agent {
  private model: string;
  private enabledTools: string[];
  private settingsPath: string;
  private agentRoot: string;
  private codeWorkspace: string;
  private lastTelemetryFile: string | null = null;
  private jobContext?: { jobId: string; jobDefinitionId: string | null; jobName: string; phase?: string; projectRunId: string | null; sourceEventId: string | null; projectDefinitionId: string | null };
  private cachedToolPolicy: ToolPolicyResult | null = null;
  private isCodingJob: boolean;
  
  // Stdout protection limits (configurable via environment variables)
  private readonly MAX_STDOUT_SIZE = parseInt(process.env.AGENT_MAX_STDOUT_SIZE || '5242880'); // 5MB default
  private readonly MAX_CHUNK_SIZE = parseInt(process.env.AGENT_MAX_CHUNK_SIZE || '102400'); // 100KB default
  private readonly REPETITION_WINDOW = parseInt(process.env.AGENT_REPETITION_WINDOW || '20'); // Track last 20 lines
  private readonly REPETITION_THRESHOLD = parseInt(process.env.AGENT_REPETITION_THRESHOLD || '10'); // Same line 10+ times = loop
  private readonly MAX_IDENTICAL_CHUNKS = parseInt(process.env.AGENT_MAX_IDENTICAL_CHUNKS || '10'); // Same chunk repeated
  
  // Universal tools are now defined in toolPolicy.ts
  private readonly universalTools = UNIVERSAL_TOOLS;

  constructor(
    model: string, 
    enabledTools: string[], 
    jobContext?: { jobId: string; jobDefinitionId: string | null; jobName: string; phase?: string; projectRunId: string | null; sourceEventId: string | null; projectDefinitionId: string | null },
    codeWorkspace?: string | null,
    options?: { isCodingJob?: boolean }
  ) {
    this.model = model;
    this.enabledTools = enabledTools || [];
    this.jobContext = jobContext;
    
    // Determine if this is a coding job
    // Primary source: explicit option, fallback to inferring from codeWorkspace
    if (options?.isCodingJob !== undefined) {
      this.isCodingJob = options.isCodingJob;
    } else {
      // Infer from codeWorkspace: null means explicitly non-coding, empty string means no workspace
      this.isCodingJob = codeWorkspace !== null && codeWorkspace !== '';
    }
    
    // agentRoot must point to the actual gemini-agent directory containing config files
    // Resolve relative to this file's location for reliable path resolution
    // This ensures agentRoot is correct regardless of CODE_METADATA_REPO_ROOT or process.cwd()
    const currentFile = fileURLToPath(import.meta.url);
    const agentDir = dirname(currentFile);
    this.agentRoot = agentDir; // This file is already in gemini-agent directory
    this.settingsPath = join(this.agentRoot, '.gemini', 'settings.json');
    
    // Verify agentRoot exists and contains expected files
    if (!existsSync(this.agentRoot)) {
      throw new Error(`Agent root directory does not exist: ${this.agentRoot}`);
    }
    const templatePath = join(this.agentRoot, 'settings.template.dev.json');
    const fallbackTemplatePath = join(this.agentRoot, 'settings.template.json');
    if (!existsSync(templatePath) && !existsSync(fallbackTemplatePath)) {
      agentLogger.warn({ 
        agentRoot: this.agentRoot, 
        templatePath, 
        fallbackTemplatePath,
        currentFile,
        agentDir 
      }, 'Settings template files not found in agentRoot - path resolution may be incorrect');
    }

    // Allow explicit codeWorkspace override (e.g., null for recognition agents)
    // Use shared getRepoRoot logic for codeWorkspace
    // This supports JINN_WORKSPACE_DIR (for ventures) and CODE_METADATA_REPO_ROOT (legacy)
    // Note: We don't have codeMetadata here, so it will fallback to env vars or cwd
    if (codeWorkspace === null) {
      // Explicitly set to null - don't include any workspace (for recognition agents)
      this.codeWorkspace = '';
      agentLogger.debug('codeWorkspace explicitly set to empty (no repo includes)');
    } else if (codeWorkspace) {
      // Explicit codeWorkspace provided
      this.codeWorkspace = codeWorkspace;
      agentLogger.debug({ codeWorkspace }, 'Using explicit codeWorkspace');
    } else {
      // Default behavior: use getRepoRoot()
      const repoRoot = getRepoRoot();
      if (existsSync(repoRoot)) {
        this.codeWorkspace = repoRoot;
      } else {
        agentLogger.warn({ path: repoRoot, fallback: this.agentRoot }, 'Repo root does not exist, falling back to agent root');
        this.codeWorkspace = this.agentRoot;
      }
    }
    
    // Log protection limits
    agentLogger.info({
      maxStdoutSizeMB: (this.MAX_STDOUT_SIZE / 1024 / 1024).toFixed(1),
      repetitionThreshold: this.REPETITION_THRESHOLD
    }, 'Loop protection enabled');
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
      } catch {} // Ignore errors here

      // Capture stderr warnings without failing the job
      if (result.stderr && result.stderr.trim()) {
        agentLogger.warn({
          stderrPreview: result.stderr.substring(0, 200)
        }, 'Warning-level errors detected in stderr');
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
        } catch {} // Ignore errors here
        const err = new Error(`Gemini process exited with code ${result.exitCode}`);
        // Preserve stderr in error message context
        (err as any).stderr = result.stderr;
        throw { error: err, telemetry };
      }

      // Extract final output; if tool responses are JSON blobs from our tools, keep them as-is
      const output = this.extractFinalOutput(result.output);
      
      // Extract structured summary from output (Phase 4)
      const structuredSummary = extractStructuredSummary(output);
      
      return { output, structuredSummary, telemetry };
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
    return new Promise((resolvePromise) => {
      // Initialize CLI args
      // NOTE: Gemini CLI no longer accepts --approval-mode or --allowed-tools flags
      // Tool permissions are now controlled via MCP settings.json (includeTools/excludeTools)
      const args: string[] = [];
      
      // Use cached tool policy (computed in generateJobSpecificSettings)
      // This ensures tool access is properly restricted via MCP settings
      const toolPolicy = this.cachedToolPolicy || computeToolPolicy(this.enabledTools, { isCodingJob: this.isCodingJob });
      
      // Make sure Gemini CLI treats the job repo as part of the workspace to allow write_file
      const includeDirectories = new Set<string>();
      if (this.codeWorkspace && this.codeWorkspace.trim() !== '') {
        const resolvedWorkspace = resolve(this.codeWorkspace);
        agentLogger.debug({ workspace: resolvedWorkspace }, 'Adding codeWorkspace to include directories');
        includeDirectories.add(resolvedWorkspace);
      } else if (!this.codeWorkspace || this.codeWorkspace.trim() === '') {
        agentLogger.debug('codeWorkspace is empty - skipping all directory includes (including env vars)');
      }
      
      // Only add environment variable directories if codeWorkspace is not explicitly empty
      if (this.codeWorkspace && this.codeWorkspace.trim() !== '') {
        if (process.env.CODE_METADATA_REPO_ROOT) {
          const resolvedEnv = resolve(process.env.CODE_METADATA_REPO_ROOT);
          agentLogger.debug({ repoRoot: resolvedEnv }, 'Adding CODE_METADATA_REPO_ROOT to include directories');
          includeDirectories.add(resolvedEnv);
        }
        if (process.env.GEMINI_ADDITIONAL_INCLUDE_DIRS) {
          for (const rawDir of process.env.GEMINI_ADDITIONAL_INCLUDE_DIRS.split(delimiter)) {
            if (rawDir?.trim()) {
              includeDirectories.add(resolve(rawDir.trim()));
            }
          }
        }
      }
      for (const dir of includeDirectories) {
        try {
          if (dir && existsSync(dir)) {
            args.push('--include-directories', dir);
          } else {
            agentLogger.debug({ dir }, 'Skipping non-existent include directory for Gemini CLI');
          }
        } catch (err: any) {
          agentLogger.debug({ dir, error: err?.message }, 'Failed to register include directory for Gemini CLI');
        }
      }

      if (this.model) {
        args.unshift('--model', this.model);
      }

      // Force YOLO mode so write tools are available in non-interactive runs
      args.push('--yolo');

      // Debug passthrough
      if (process.argv.includes('--debug') || process.argv.includes('-d')) {
        args.push('--debug');
      }

      // Telemetry outfile
      const telemetryFile = `/tmp/telemetry-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.json`;
      this.lastTelemetryFile = telemetryFile;

      // Persist the last prompt locally for debugging/repro
      const promptDir = dirname(this.settingsPath);
      try { mkdirSync(promptDir, { recursive: true }); } catch {} // Ignore errors here
      const lastPromptPath = join(promptDir, 'last-prompt.txt');
      try { writeFileSync(lastPromptPath, prompt, 'utf8'); } catch {} // Ignore errors here

      agentLogger.info({ telemetryFile }, 'Will write telemetry to file');
      agentLogger.info({ 
        model: this.model,
        jobName: this.jobContext?.jobName || 'job',
        phase: this.jobContext?.phase || 'execution'
      }, 'Spawning Gemini CLI');
      
      // Add prompt as positional argument (replaces deprecated --prompt flag)
      // Positional prompts default to one-shot (non-interactive) mode, preventing "Please continue" loops
      args.push(prompt);

      // Propagate job context to the MCP server via environment variables so the separate
      // MCP process can read them on startup
      const envWithJob: NodeJS.ProcessEnv = { ...process.env };
      // Configure telemetry via environment variables (CLI 0.11+ no longer accepts telemetry flags)
      envWithJob.GEMINI_TELEMETRY_ENABLED = 'true';
      envWithJob.GEMINI_TELEMETRY_TARGET = envWithJob.GEMINI_TELEMETRY_TARGET || 'local';
      envWithJob.GEMINI_TELEMETRY_OUTFILE = telemetryFile;
      envWithJob.GEMINI_TELEMETRY_LOG_PROMPTS = envWithJob.GEMINI_TELEMETRY_LOG_PROMPTS || 'true';
      if (!('GEMINI_TELEMETRY_OTLP_ENDPOINT' in envWithJob)) {
        envWithJob.GEMINI_TELEMETRY_OTLP_ENDPOINT = '';
      }
      if (!('GEMINI_TELEMETRY_USE_COLLECTOR' in envWithJob)) {
        envWithJob.GEMINI_TELEMETRY_USE_COLLECTOR = 'false';
      }
      try {
        if (this.jobContext) {
          envWithJob.JINN_JOB_ID = this.jobContext.jobId || '';
          envWithJob.JINN_JOB_DEFINITION_ID = this.jobContext.jobDefinitionId || '';
          envWithJob.JINN_JOB_NAME = this.jobContext.jobName || '';
          envWithJob.JINN_PROJECT_RUN_ID = this.jobContext.projectRunId || '';
          envWithJob.JINN_SOURCE_EVENT_ID = this.jobContext.sourceEventId || '';
          envWithJob.JINN_PROJECT_DEFINITION_ID = this.jobContext.projectDefinitionId || '';
        }
      } catch {} // Ignore errors here

      if (!envWithJob.GEMINI_CLI_SYSTEM_SETTINGS_PATH) {
        envWithJob.GEMINI_CLI_SYSTEM_SETTINGS_PATH = this.settingsPath;
      }
      if (!envWithJob.GEMINI_CLI_SYSTEM_DEFAULTS_PATH) {
        envWithJob.GEMINI_CLI_SYSTEM_DEFAULTS_PATH = this.settingsPath;
      }

      // Use /tmp for Gemini CLI to avoid macOS com.apple.provenance protection
      // macOS automatically applies this extended attribute to ~/.gemini which prevents writes
      const geminiHome = join('/tmp', '.gemini-worker');
      try {
        mkdirSync(geminiHome, { recursive: true });
      } catch (err: any) {
        agentLogger.debug({ error: err.message }, 'Failed to create gemini home directory');
      }

      const geminiProcess = spawn('npx', ['@google/gemini-cli', ...args], {
        // Use stable cwd for Gemini CLI to prevent initialization hang in test environments.
        // Gemini CLI v0.11.2 hangs when spawned with cwd pointing to ephemeral/temporary directories.
        // Tests create temporary fixtures in /var/folders/.../jinn-gemini-tests/, which causes CLI to hang
        // during initialization (likely filesystem metadata/permission issues with transient paths).
        // Solution: Use stable agentRoot as cwd, but expose workspace via JINN_WORKSPACE_DIR env var
        // so native tools (write_file, etc.) can resolve paths correctly.
        cwd: (() => {
          const workspace = this.codeWorkspace && this.codeWorkspace.trim() !== '' 
            ? this.codeWorkspace 
            : this.agentRoot;
          
          // If workspace is a temporary test fixture, use agentRoot (stable directory)
          if (workspace.includes('/jinn-gemini-tests/') || process.env.VITEST === 'true') {
            return this.agentRoot; // Stable directory (gemini-agent/)
          }
          
          return workspace;
        })(),
        env: {
          ...envWithJob,
          // Set GEMINI_HOME to a writable directory within the project to avoid EPERM errors
          GEMINI_HOME: geminiHome,
          // Expose workspace directory for native tools even when cwd is stable
          ...(this.codeWorkspace && this.codeWorkspace.trim() !== '' ? { JINN_WORKSPACE_DIR: this.codeWorkspace } : {})
        }
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

      // Prompt is provided as positional argument, no stdin needed

      geminiProcess.stdout.on('data', (data) => {
        if (terminated) return;
        
        const chunk = data.toString();
        
        // Check chunk size
        if (chunk.length > this.MAX_CHUNK_SIZE) {
          agentLogger.warn({ chunkSize: chunk.length, maxChunkSize: this.MAX_CHUNK_SIZE }, 'Terminating process due to large chunk');
          terminated = true;
          terminationReason = `Large chunk detected: ${chunk.length} bytes`;
          geminiProcess.kill('SIGTERM');
          return;
        }
        
        // Check total stdout size
        if (stdout.length + chunk.length > this.MAX_STDOUT_SIZE) {
          const totalSizeMB = ((stdout.length + chunk.length) / 1024 / 1024).toFixed(2);
          agentLogger.warn({ totalSizeBytes: stdout.length + chunk.length, maxSizeBytes: this.MAX_STDOUT_SIZE, totalSizeMB }, 'Terminating process due to output size limit');
          terminated = true;
          terminationReason = `Output size limit exceeded: ${totalSizeMB}MB`;
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
          agentLogger.warn({ identicalChunks, maxIdenticalChunks: this.MAX_IDENTICAL_CHUNKS }, 'Terminating process due to identical chunk repetition');
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
                agentLogger.warn({
                  consecutiveRepeatCount,
                  repetitionThreshold: this.REPETITION_THRESHOLD,
                  linePreview: line.substring(0, 100)
                }, 'Terminating process due to consecutive repetitive output');
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

      // Exception: Uses console.error for subprocess stderr forwarding (per spec: "Subprocess streaming in process managers")
      // This forwards Gemini CLI stderr to console for operational visibility
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
          agentLogger.warn({ terminationReason }, 'Process terminated by loop detection');
          // Add termination reason to output for debugging
          stdout += `\n\n[PROCESS TERMINATED: ${terminationReason}]`;
          // Force non-zero exit code for terminated processes
          exitCode = exitCode || 1;
        }
        
        resolvePromise({ output: stdout, telemetryFile, stderr, exitCode });
      });

      geminiProcess.on('error', (err) => {
        // No timeout to clear
        
        // Surface as a synthetic non-zero exit with captured streams
        const exitCode = 1;
        const synthetic = `Gemini spawn error: ${err?.message || String(err)}`;
        resolvePromise({ output: stdout, telemetryFile, stderr: `${stderr}\n${synthetic}`.trim(), exitCode });
      });
    });
  }

  private generateJobSpecificSettings(): void {
    // Always generate settings if we have universal tools, even if no job-specific tools
    if (this.enabledTools.length === 0 && (this.universalTools as readonly string[]).length === 0) return;
    try {
      const templateFileName = process.env.USE_TSX_MCP === '1'
        ? 'settings.template.dev.json'
        : 'settings.template.json';
      const templatePath = join(this.agentRoot, templateFileName);
      
      // Verify template file exists before reading
      if (!existsSync(templatePath)) {
        const fallbackPath = join(this.agentRoot, templateFileName === 'settings.template.dev.json' 
          ? 'settings.template.json' 
          : 'settings.template.dev.json');
        const attemptedPaths = [templatePath];
        if (existsSync(fallbackPath)) {
          attemptedPaths.push(`(fallback exists: ${fallbackPath})`);
        }
        throw new Error(
          `Settings template file not found: ${templatePath}\n` +
          `Agent root: ${this.agentRoot}\n` +
          `Attempted paths: ${attemptedPaths.join(', ')}\n` +
          `Current working directory: ${process.cwd()}`
        );
      }
      
      const templateSettings: GeminiSettings = JSON.parse(readFileSync(templatePath, 'utf8'));

      if (!templateSettings.mcpServers) {
        throw new Error('No MCP servers configured in settings.template.json');
      }

      const serverName = templateSettings.mcpServers.metacog ? 'metacog' : Object.keys(templateSettings.mcpServers)[0];
      if (!serverName) throw new Error('No MCP servers found in template configuration');

      const mcpServer = templateSettings.mcpServers[serverName];
      if (!mcpServer) throw new Error(`MCP server '${serverName}' not found in template configuration`);

      // Resolve MCP command to absolute path so it works even when running outside repo root
      try {
        const tsxBinaryName = process.platform === 'win32' ? 'tsx.cmd' : 'tsx';
        const tsxCandidates = [
          resolve(this.agentRoot, '..', 'node_modules', '.bin', tsxBinaryName),
          resolve(this.agentRoot, 'node_modules', '.bin', tsxBinaryName)
        ];
        const tsxExecutable = tsxCandidates.find(candidate => existsSync(candidate));
        if (tsxExecutable) {
          mcpServer.command = tsxExecutable;
        }
      } catch (error) {
        agentLogger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Failed to resolve tsx binary for MCP server');
      }

      if (Array.isArray(mcpServer.args)) {
        mcpServer.args = mcpServer.args.map(arg => {
          if (typeof arg === 'string' && !arg.startsWith('-') && !isAbsolute(arg)) {
            return resolve(this.agentRoot, arg);
          }
          return arg;
        });
      }

      // Compute tool policy using centralized logic
      // This ensures MCP include/exclude and CLI whitelist are consistent
      // Cache it for reuse in runGeminiWithTelemetry to avoid double computation
      this.cachedToolPolicy = computeToolPolicy(this.enabledTools, { isCodingJob: this.isCodingJob });
      const toolPolicy = this.cachedToolPolicy;

      // Include the merged tool set (universal + job-specific)
      mcpServer.includeTools = toolPolicy.mcpIncludeTools;

      // CRITICAL: Do NOT set global excludeTools - it overrides per-server includeTools
      // The Gemini CLI respects per-server includeTools without needing global exclusions
      // templateSettings.excludeTools = toolPolicy.mcpExcludeTools;

      // Whitelist native tools at the CLI level (write_file, replace, etc.)
      templateSettings.coreTools = toolPolicy.cliAllowedTools;

      // Ensure directory exists
      const settingsDir = dirname(this.settingsPath);
      mkdirSync(settingsDir, { recursive: true });

      writeFileSync(this.settingsPath, JSON.stringify(templateSettings, null, 2));
      agentLogger.info({
        serverName,
        mcpIncludeTools: toolPolicy.mcpIncludeTools,
        universalTools: UNIVERSAL_TOOLS,
        jobSpecificTools: this.enabledTools.length > 0 ? this.enabledTools : 'none',
        mcpExcludedTools: toolPolicy.mcpExcludeTools.length > 0 ? toolPolicy.mcpExcludeTools : 'none',
        cliAllowedTools: toolPolicy.cliAllowedTools
      }, 'Generated job-specific settings');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      agentLogger.error({ error: errorMsg }, 'Failed to generate job-specific settings');
      throw error;
    }
  }

  private cleanupJobSpecificSettings(): void {
    // Always cleanup if we have universal tools, even if no job-specific tools
    if (this.enabledTools.length === 0 && (this.universalTools as readonly string[]).length === 0) return;
    try {
      unlinkSync(this.settingsPath);
      agentLogger.debug({ settingsPath: this.settingsPath }, 'Cleaned up job-specific settings');
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        const errorMsg = error instanceof Error ? error.message : String(error);
        agentLogger.warn({ error: errorMsg, settingsPath: this.settingsPath }, 'Failed to clean up job-specific settings');
      }
    }
    // Clear cached tool policy
    this.cachedToolPolicy = null;
  }

  private cleanupTelemetryFile(telemetryFile: string): void {
    if (!telemetryFile || telemetryFile.trim() === '') return;
    try {
      unlinkSync(telemetryFile);
      agentLogger.debug({ telemetryFile }, 'Cleaned up telemetry file');
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        const errorMsg = error instanceof Error ? error.message : String(error);
        agentLogger.warn({ error: errorMsg, telemetryFile }, 'Failed to clean up telemetry file');
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
      agentLogger.error({ error: error instanceof Error ? error.message : String(error) }, 'Error parsing telemetry from output');
      telemetry.errorMessage = `Telemetry parsing failed: ${error.message}`;
      telemetry.raw = { parseError: error.message, output: output.substring(0, 500) };
    }

    return telemetry;
  }

  private async parseTelemetryFromFile(telemetryFile: string | undefined, output: string | undefined, startTime: number): Promise<JobTelemetry> {
    let candidateFile = telemetryFile && telemetryFile.trim() !== ''
      ? telemetryFile
      : (this.lastTelemetryFile && this.lastTelemetryFile.trim() !== '' ? this.lastTelemetryFile : '');

    try {
      if (readFileSync && candidateFile) {
        // Give the CLI a moment to flush the telemetry file if the process just exited.
        const maxAttempts = 40;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          if (existsSync(candidateFile)) {
            const size = statSync(candidateFile).size;
            if (size > 0) {
              break;
            }
          }
          await new Promise(resolve => setTimeout(resolve, 250));
        }

        if (!existsSync(candidateFile)) {
          agentLogger.warn({ telemetryFile: candidateFile }, 'Telemetry file still missing after waiting');
        } else if (statSync(candidateFile).size === 0) {
          agentLogger.warn({ telemetryFile: candidateFile }, 'Telemetry file is still empty after waiting');
        } else {
          const telemetryContent = readFileSync(candidateFile, 'utf8');

          // Optional safety: cap processing to avoid runaway memory usage
          const maxProcessChars = 50 * 1024 * 1024; // 50MB
          const contentToParse = telemetryContent.length > maxProcessChars
            ? telemetryContent.substring(0, maxProcessChars)
            : telemetryContent;

          agentLogger.debug({
            telemetryFile: candidateFile,
            contentLength: telemetryContent.length,
            contentPreview: telemetryContent.substring(0, 100)
          }, 'Reading telemetry file');

          const result = this.parseTelemetryFromContent(contentToParse, startTime);
          return result;
        }
      }
    } catch (error: any) {
      agentLogger.warn({
        error: error.message,
        telemetryFile: telemetryFile || this.lastTelemetryFile || 'none'
      }, 'Failed to read telemetry file');
    }

    if (!candidateFile) {
      agentLogger.warn({}, 'Telemetry file path missing; falling back to stdout parsing');
    } else {
      agentLogger.debug({}, 'Falling back to output parsing');
    }
    return this.parseTelemetryFromOutput(output ?? '', startTime);
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
              agentLogger.debug({
                error: e.message,
                sample: candidate.substring(0, 120)
              }, 'Failed to parse JSON object in telemetry');
            } else if (parseErrors === maxParseErrors + 1) {
              agentLogger.debug({ parseErrors }, 'Too many parse errors; further errors suppressed');
            }
          }
          started = false;
          buffer = '';
          inString = false;
          escapeNext = false;
        }
      }

      agentLogger.debug({
        eventCount: telemetryEvents.length,
        parseErrors: parseErrors > 0 ? parseErrors : undefined
      }, 'Parsed telemetry events');

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
            }
            if (attrs['input_token_count']) {
              // Promote to top-level field and keep in raw for backwards compatibility
              telemetry.inputTokens = (telemetry.inputTokens || 0) + attrs['input_token_count'];
              telemetry.raw.inputTokens = attrs['input_token_count'];
            }
            if (attrs['output_token_count']) {
              // Promote to top-level field and keep in raw for backwards compatibility
              telemetry.outputTokens = (telemetry.outputTokens || 0) + attrs['output_token_count'];
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
              args: attrs['function_args'] || attrs['parameters'] || attrs['args'] || attrs['arguments']
            });
            break;
        }
      }

      // Extract tool results from conversation history and attach to tool calls
      this.attachToolResultsToToolCalls(telemetry);

      telemetry.raw.eventCount = telemetryEvents.length;
      telemetry.raw.events = telemetryEvents.map(e => e.attributes?.['event.name']).filter(Boolean);
      agentLogger.debug({
        totalTokens: telemetry.totalTokens,
        toolCallCount: telemetry.toolCalls.length,
        sessionId: telemetry.raw.sessionId
      }, 'Telemetry parsing completed');
    } catch (error: any) {
      agentLogger.error({ error: error instanceof Error ? error.message : String(error) }, 'Error parsing telemetry content');
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
                        agentLogger.debug({ toolName, resultKeys: Object.keys(output.data) }, 'Attached result to tool call');
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
      agentLogger.warn({ error: error.message }, 'Failed to attach tool results to telemetry');
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

/**
 * Extract structured summary from agent output
 * Looks for markdown sections like "**Execution Summary:**" and extracts from that point
 * Falls back to last 1200 chars if no structured format found
 */
export function extractStructuredSummary(output: string): string | null {
  if (!output || output.length === 0) {
    return null;
  }

  // Look for markdown headings indicating structured format
  const summaryMarkers = [
    /\*\*Execution Summary:\*\*/i,
    /### Work Completed/i,
    /## Execution Summary/i,
    /# Summary/i
  ];
  
  for (const marker of summaryMarkers) {
    if (marker.test(output)) {
      // Extract from marker to end (or to next major section)
      const match = output.match(marker);
      if (match && match.index !== undefined) {
        // Extract until end or next major heading (that's not part of the summary)
        const remaining = output.slice(match.index);
        
        // Don't cut off if we find internal headings like "### Actions Taken"
        // Only cut off if we find something that looks like a new top-level section
        // For now, just take everything from the marker to the end
        return remaining.trim();
      }
    }
  }
  
  // Fallback: Last 1200 chars (current behavior)
  return output.slice(-1200);
}
