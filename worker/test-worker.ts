import { readFileSync, writeFileSync } from 'fs';
import { Agent } from '../gemini-agent/agent.js';

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const val = process.argv[idx + 1];
  if (!val || val.startsWith('-')) return null;
  return val;
}

function getArgBool(flag: string): boolean {
  return process.argv.includes(flag);
}

function parseCsvArg(flag: string): string[] | null {
  const raw = getArg(flag);
  if (!raw) return null;
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function randomUUID(): string {
  try {
    // Node 20+
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require('crypto');
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch {}
  // Fallback simple UUID v4 generator
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function usageAndExit(msg?: string): never {
  if (msg) console.error(msg);
  console.error(
    'Usage: tsx worker/test-worker.ts --prompt-file <path> [--model <name>] [--enabled-tools <csv>] [--report-file <path>] [--debug]'
  );
  process.exit(1);
}

async function main() {
  const promptFile = getArg('--prompt-file');
  if (!promptFile) usageAndExit('Missing required --prompt-file');

  const model = getArg('--model') || 'gemini-2.5-flash';
  const enabledToolsArg = parseCsvArg('--enabled-tools');
  const reportFile = getArg('--report-file');
  const debug = getArgBool('--debug') || process.argv.includes('-d');

  // Default tool set (can be overridden with --enabled-tools)
  const defaultTools = [
    'get_details',
    'manage_artifact',
    'send_message',
    'create_job_batch',
    'list_tools',
    'update_job',
    'create_job',
    'create_memory',
    'search_memories',
    'read_records'
  ];
  const enabledTools = enabledToolsArg && enabledToolsArg.length > 0 ? enabledToolsArg : defaultTools;

  // Read prompt (already full production format; no composition here)
  let prompt = '';
  try {
    prompt = readFileSync(promptFile, 'utf8');
  } catch (e: any) {
    usageAndExit(`Failed to read --prompt-file: ${e?.message || String(e)}`);
  }

  // Hardcoded job context (use real IDs if known; these can be adjusted)
  const jobContext = {
    jobId: null,
    jobDefinitionId: 'eb462084-3fc4-49da-b92d-a050fad82d64',
    jobName: 'Human Supervisor',
    projectRunId: 'f45bb9a7-db17-4115-ab18-7600a2867a55',
    sourceEventId: '',
    projectDefinitionId: '4e235bf7-9176-4c50-ae06-e3a0fbe2d825',
    threadId: ''
  } as any;

  // Pass-through debug flag to process.argv so Agent forwards to CLI
  if (debug && !process.argv.includes('--debug')) process.argv.push('--debug');

  const agent = new Agent(model, enabledTools, jobContext);

  try {
    const result = await agent.run(prompt);
    // Print output
    console.log(result.output);

    if (reportFile) {
      const report = {
        model,
        enabledTools,
        jobContext,
        output: result.output,
        telemetry: result.telemetry
      };
      try { writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8'); } catch {}
    }
    process.exit(0);
  } catch (err: any) {
    const nested = err?.error ?? err;
    const message = nested?.message || String(nested);
    const telemetry = err?.telemetry || null;

    console.error('Test worker failed:', message);
    if (telemetry) {
      try {
        console.error('Telemetry summary:', JSON.stringify({
          totalTokens: telemetry.totalTokens,
          toolCalls: telemetry.toolCalls?.length || 0,
          errorType: telemetry.errorType,
          raw: telemetry.raw ? { eventCount: telemetry.raw.eventCount } : undefined
        }, null, 2));
      } catch {}
    }

    if (reportFile) {
      try { writeFileSync(reportFile, JSON.stringify({ error: message, telemetry }, null, 2), 'utf8'); } catch {}
    }
    process.exit(1);
  }
}

main();


