#!/usr/bin/env node
import { readFile } from 'fs/promises';
import { Ledger, NewViolation } from './ledger.js';

/**
 * Unified ledger update script
 * Replaces the old approach of spawning 3 separate background processes
 * with a single synchronous call for reliability and testability.
 *
 * Usage:
 *   tsx update-all-reviews.ts obj1:/path/to/file.txt obj2:/path/to/file.txt obj3:/path/to/file.txt
 *
 * Design rationale:
 * - Synchronous operation ensures ledger is updated before script exits
 * - Single process is more efficient than spawning 3 Node.js processes
 * - Errors are visible to users immediately
 * - Tests work reliably without polling/timeouts
 * - Performance overhead: ~200-500ms (negligible on 60-180s detection scripts)
 */

interface ReviewInput {
  objective: string;
  file: string;
}

interface UpdateResults {
  added: number;
  updated: number;
  errors: Array<{ objective: string; error: string }>;
}

interface ReviewViolation {
  file: string;
  line: number;
  issue: string;
  current?: string;
  suggested_fix?: string;
  pattern_ref?: string;
}

/**
 * Maps objective to clauses
 */
const OBJECTIVE_TO_CLAUSES: Record<string, string[]> = {
  obj1: ['obj1'],
  obj2: ['obj2'],
  obj3: ['obj3'],
};

/**
 * Maps objective to default severity
 */
const OBJECTIVE_TO_SEVERITY: Record<string, NewViolation['severity']> = {
  obj1: 'medium',
  obj2: 'info',
  obj3: 'critical',
};

/**
 * Parses review script output and extracts violations
 */
function parseReviewOutput(output: string, objective: string): ReviewViolation[] {
  const violations: ReviewViolation[] = [];
  const blocks = output.split('---').map(b => b.trim()).filter(b => b);

  for (const block of blocks) {
    const lines = block.split('\n');
    const violation: Partial<ReviewViolation> = {};

    let currentField: 'current' | 'suggested_fix' | null = null;
    let codeBuffer: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('File:')) {
        violation.file = line.replace('File:', '').trim();
      } else if (line.startsWith('Line:')) {
        violation.line = parseInt(line.replace('Line:', '').trim(), 10);
      } else if (line.startsWith('Issue:')) {
        violation.issue = line.replace('Issue:', '').trim();
      } else if (line.startsWith('Pattern reference:')) {
        violation.pattern_ref = line.replace('Pattern reference:', '').trim();
      } else if (line.startsWith('Current code:')) {
        if (currentField && codeBuffer.length > 0) {
          violation[currentField] = codeBuffer.join('\n').trim();
          codeBuffer = [];
        }
        currentField = 'current';
      } else if (line.startsWith('Suggested fix:')) {
        if (currentField && codeBuffer.length > 0) {
          violation[currentField] = codeBuffer.join('\n').trim();
          codeBuffer = [];
        }
        currentField = 'suggested_fix';
      } else if (currentField) {
        if (line !== '```' && line !== '```typescript' && line !== '```ts') {
          codeBuffer.push(line);
        }
      }
    }

    if (currentField && codeBuffer.length > 0) {
      violation[currentField] = codeBuffer.join('\n').trim();
    }

    if (violation.file && violation.line && violation.issue) {
      violations.push(violation as ReviewViolation);
    }
  }

  return violations;
}

/**
 * Converts review violations to ledger format
 */
function convertToLedgerViolations(
  violations: ReviewViolation[],
  objective: string
): NewViolation[] {
  const clauses = OBJECTIVE_TO_CLAUSES[objective] || [objective];
  const severity = OBJECTIVE_TO_SEVERITY[objective] || 'medium';

  return violations.map(v => ({
    clauses,
    severity,
    path: v.file,
    line: v.line,
    title: v.issue.length > 80 ? v.issue.slice(0, 77) + '...' : v.issue,
    description: v.issue,
    suggested_fix: v.suggested_fix || 'See description',
    status: 'open' as const,
  }));
}

/**
 * Parses command-line arguments
 * Expected format: obj1:/path/to/file.txt obj2:/path/to/file.txt ...
 */
function parseArgs(args: string[]): ReviewInput[] {
  return args.map(arg => {
    const [objective, file] = arg.split(':');
    if (!objective || !file) {
      throw new Error(`Invalid argument: ${arg} (expected format: obj1:/path/to/file.txt)`);
    }
    if (!['obj1', 'obj2', 'obj3'].includes(objective)) {
      throw new Error(`Invalid objective: ${objective} (must be obj1, obj2, or obj3)`);
    }
    return { objective, file };
  });
}

/**
 * Updates ledger from all review outputs in a single transaction
 */
async function updateLedgerFromReviews(inputs: ReviewInput[]): Promise<UpdateResults> {
  const ledger = new Ledger();
  const results: UpdateResults = { added: 0, updated: 0, errors: [] };

  for (const { objective, file } of inputs) {
    try {
      // Read review output
      const output = await readFile(file, 'utf-8');

      // Parse violations (reuse existing parser)
      const reviewViolations = parseReviewOutput(output, objective);

      // Convert to ledger format (reuse existing converter)
      const ledgerViolations = convertToLedgerViolations(reviewViolations, objective);

      // Add to ledger
      for (const v of ledgerViolations) {
        const result = await ledger.addViolation(v);
        if (result.first_seen === result.last_seen) {
          results.added++;
        } else {
          results.updated++;
        }
      }

      console.error(`✅ ${objective}: Processed ${reviewViolations.length} violations`);
    } catch (error: any) {
      console.error(`❌ ${objective}: Failed to update ledger: ${error.message}`);
      results.errors.push({ objective, error: error.message });
    }
  }

  return results;
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: update-all-reviews.ts obj1:/path/to/file.txt obj2:/path/to/file.txt ...');
    console.error('');
    console.error('Example:');
    console.error('  tsx update-all-reviews.ts obj1:/tmp/obj1.txt obj2:/tmp/obj2.txt obj3:/tmp/obj3.txt');
    console.error('');
    console.error('This script replaces the old approach of spawning 3 separate background');
    console.error('processes with a single synchronous call for improved reliability.');
    process.exit(1);
  }

  try {
    const inputs = parseArgs(args);
    const results = await updateLedgerFromReviews(inputs);

    // Print summary for bash script to parse
    console.log(`LEDGER_UPDATED: ${results.added} new, ${results.updated} updated`);

    if (results.errors.length > 0) {
      console.error(`LEDGER_ERRORS: ${JSON.stringify(results.errors)}`);
      process.exit(1);
    }

    // Success
    process.exit(0);
  } catch (error: any) {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { updateLedgerFromReviews, parseArgs };
