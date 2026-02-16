#!/usr/bin/env npx tsx
/**
 * Parse Gemini CLI telemetry files and verify tool usage.
 *
 * Telemetry files contain concatenated JSON objects (not a JSON array).
 * This script uses a streaming brace-counting parser to extract them.
 *
 * Usage:
 *   yarn test:e2e:parse-telemetry <file>
 *   yarn test:e2e:parse-telemetry <file> --required-tools google_web_search,create_artifact
 *   yarn test:e2e:parse-telemetry /tmp/jinn-telemetry/telemetry-*.json
 *
 * Exit code:
 *   0 — all required tools were called (or no --required-tools specified)
 *   1 — one or more required tools were NOT called
 */

import { promises as fs } from 'fs';
import { glob } from 'glob';

// ─── Streaming JSON Parser ──────────────────────────────────────────────────
// Extracted from jinn-node/src/agent/agent.ts parseTelemetryFromContent()

function parseJsonObjects(content: string): any[] {
  const objects: any[] = [];
  let buffer = '';
  let started = false;
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;
  let parseErrors = 0;

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
        objects.push(JSON.parse(candidate));
      } catch {
        parseErrors++;
      }
      started = false;
      buffer = '';
      inString = false;
      escapeNext = false;
    }
  }

  if (parseErrors > 0) {
    console.error(`  (${parseErrors} unparseable JSON fragments skipped)`);
  }

  return objects;
}

// ─── Event Processing ───────────────────────────────────────────────────────

interface ToolCall {
  tool: string;
  success: boolean;
  duration_ms: number;
  args?: string;
}

interface TelemetryReport {
  coreToolsEnabled: string;
  model: string;
  toolCalls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  eventCounts: Record<string, number>;
  eventCount: number;
}

function processEvents(events: any[]): TelemetryReport {
  const report: TelemetryReport = {
    coreToolsEnabled: '',
    model: '',
    toolCalls: [],
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    eventCounts: {},
    eventCount: events.length,
  };

  for (const event of events) {
    if (!event?.attributes) continue;
    const attrs = event.attributes;
    const eventName = attrs['event.name'] || 'unknown';

    report.eventCounts[eventName] = (report.eventCounts[eventName] || 0) + 1;

    switch (eventName) {
      case 'gemini_cli.config':
        if (attrs['core_tools_enabled']) {
          report.coreToolsEnabled = attrs['core_tools_enabled'];
        }
        break;

      case 'gemini_cli.api_request':
        if (attrs['model']) report.model = attrs['model'];
        break;

      case 'gemini_cli.api_response':
        if (typeof attrs['total_token_count'] === 'number') {
          report.totalTokens = Math.max(report.totalTokens, attrs['total_token_count']);
        }
        if (attrs['input_token_count']) {
          report.inputTokens += attrs['input_token_count'];
        }
        if (attrs['output_token_count']) {
          report.outputTokens += attrs['output_token_count'];
        }
        break;

      case 'gemini_cli.tool_call':
      case 'gemini_cli.function_call':
        report.toolCalls.push({
          tool: attrs['function_name'] || attrs['tool_name'] || attrs['name'] || 'unknown',
          success: attrs['success'] !== false,
          duration_ms: attrs['duration_ms'] || 0,
          args: String(attrs['function_args'] || attrs['parameters'] || attrs['args'] || '').substring(0, 120),
        });
        break;
    }
  }

  return report;
}

// ─── Output ─────────────────────────────────────────────────────────────────

function printReport(report: TelemetryReport, requiredTools: string[]): boolean {
  console.log('\n=== Telemetry Report ===\n');

  // Config
  console.log(`Model: ${report.model || '(not found)'}`);
  console.log(`Core tools enabled: ${report.coreToolsEnabled || '(not found)'}`);
  if (!report.coreToolsEnabled) {
    console.log('  WARNING: No core_tools_enabled — native tools may not have been configured');
  }

  // Token usage
  console.log(`\nTokens: input=${report.inputTokens}, output=${report.outputTokens}, total=${report.totalTokens}`);

  // Tool calls
  console.log(`\nTool calls (${report.toolCalls.length}):`);
  if (report.toolCalls.length === 0) {
    console.log('  (none)');
  } else {
    for (const tc of report.toolCalls) {
      const status = tc.success ? 'OK' : 'FAIL';
      console.log(`  ${tc.tool} [${status}] ${tc.duration_ms}ms`);
      if (tc.args) console.log(`    args: ${tc.args}`);
    }
  }

  // Required tool verification
  let allPassed = true;
  if (requiredTools.length > 0) {
    console.log('\nRequired tool verification:');
    const calledTools = new Set(report.toolCalls.map(tc => tc.tool));
    for (const required of requiredTools) {
      const found = calledTools.has(required);
      const status = found ? 'PASS' : 'FAIL';
      console.log(`  [${status}] ${required}`);
      if (!found) allPassed = false;
    }
  }

  // Event summary
  console.log(`\nEvents parsed: ${report.eventCount}`);
  const sortedEvents = Object.entries(report.eventCounts).sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sortedEvents) {
    console.log(`  ${name}: ${count}`);
  }

  console.log('');
  return allPassed;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(args: string[]): { files: string[]; requiredTools: string[] } {
  const files: string[] = [];
  const requiredTools: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--required-tools' && i + 1 < args.length) {
      requiredTools.push(...args[++i].split(',').map(t => t.trim()).filter(Boolean));
    } else if (!args[i].startsWith('--')) {
      files.push(args[i]);
    }
  }

  return { files, requiredTools };
}

async function main() {
  const { files: filePatterns, requiredTools } = parseArgs(process.argv.slice(2));

  if (filePatterns.length === 0) {
    console.error('Usage: parse-telemetry <file|glob> [--required-tools tool1,tool2]');
    process.exit(1);
  }

  // Resolve glob patterns
  const resolvedFiles: string[] = [];
  for (const pattern of filePatterns) {
    const matches = await glob(pattern);
    resolvedFiles.push(...matches);
  }

  if (resolvedFiles.length === 0) {
    console.error(`No files matched: ${filePatterns.join(', ')}`);
    process.exit(1);
  }

  // Read and concatenate all files
  let allContent = '';
  for (const file of resolvedFiles) {
    console.log(`Reading: ${file}`);
    const content = await fs.readFile(file, 'utf-8');
    allContent += content;
  }

  console.log(`Total content: ${(allContent.length / 1024).toFixed(1)} KB`);

  // Parse
  const events = parseJsonObjects(allContent);
  console.log(`Parsed ${events.length} telemetry events`);

  if (events.length === 0) {
    console.error('ERROR: No telemetry events found');
    process.exit(1);
  }

  // Process and report
  const report = processEvents(events);
  const allPassed = printReport(report, requiredTools);

  if (requiredTools.length > 0 && !allPassed) {
    process.exit(1);
  }
}

main().catch(e => {
  console.error('FAILED:', e.message || e);
  process.exit(1);
});
