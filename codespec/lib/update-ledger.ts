#!/usr/bin/env node
import { readFile } from 'fs/promises';
import { Ledger, NewViolation } from './ledger.js';

/**
 * Represents a violation from the review script output
 */
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
 * Parses the review script output and extracts violations
 *
 * Expected format from review scripts:
 * File: worker/config.ts
 * Line: 42
 * Issue: Using multiple error handling patterns
 * Current code:
 * ```
 * throw new Error(...)
 * ```
 * Suggested fix:
 * ```
 * logger.error(...); throw new Error(...)
 * ```
 * Pattern reference: docs/spec/code-spec/examples/obj1.md#error-handling
 * ---
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

      // Check for field markers
      if (line.startsWith('File:')) {
        violation.file = line.replace('File:', '').trim();
      } else if (line.startsWith('Line:')) {
        violation.line = parseInt(line.replace('Line:', '').trim(), 10);
      } else if (line.startsWith('Issue:')) {
        violation.issue = line.replace('Issue:', '').trim();
      } else if (line.startsWith('Pattern reference:')) {
        violation.pattern_ref = line.replace('Pattern reference:', '').trim();
      } else if (line.startsWith('Current code:')) {
        // Save any buffered code from previous field
        if (currentField && codeBuffer.length > 0) {
          violation[currentField] = codeBuffer.join('\n').trim();
          codeBuffer = [];
        }
        currentField = 'current';
      } else if (line.startsWith('Suggested fix:')) {
        // Save any buffered code from previous field
        if (currentField && codeBuffer.length > 0) {
          violation[currentField] = codeBuffer.join('\n').trim();
          codeBuffer = [];
        }
        currentField = 'suggested_fix';
      } else if (currentField) {
        // Accumulate code lines (skip markdown code fences)
        if (line !== '```' && line !== '```typescript' && line !== '```ts') {
          codeBuffer.push(line);
        }
      }
    }

    // Save final buffered code
    if (currentField && codeBuffer.length > 0) {
      violation[currentField] = codeBuffer.join('\n').trim();
    }

    // Add violation if we have minimum required fields
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
 * Main function: updates ledger from review output
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: update-ledger.ts <objective> <output-file>');
    console.error('  objective: obj1, obj2, or obj3');
    console.error('  output-file: path to review script output');
    process.exit(1);
  }

  const [objective, outputFile] = args;

  // Validate objective
  if (!['obj1', 'obj2', 'obj3'].includes(objective)) {
    console.error(`Invalid objective: ${objective} (must be obj1, obj2, or obj3)`);
    process.exit(1);
  }

  try {
    // Read review output
    const output = await readFile(outputFile, 'utf-8');

    // Parse violations
    const reviewViolations = parseReviewOutput(output, objective);
    console.error(`Parsed ${reviewViolations.length} violations from ${objective} review`);

    // Convert to ledger format
    const ledgerViolations = convertToLedgerViolations(reviewViolations, objective);

    // Update ledger
    const ledger = new Ledger();
    let added = 0;
    let updated = 0;

    for (const v of ledgerViolations) {
      const result = await ledger.addViolation(v);
      if (result.first_seen === result.last_seen) {
        added++;
      } else {
        updated++;
      }
    }

    console.error(`Ledger updated: ${added} new, ${updated} updated`);

    // Output stats
    const stats = await ledger.getStats();
    console.error(`Total violations: ${stats.total}`);
    console.error(`By status:`, stats.by_status);
    console.error(`By clause:`, stats.by_clause);
  } catch (error) {
    console.error('Error updating ledger:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { parseReviewOutput, convertToLedgerViolations };
