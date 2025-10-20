#!/usr/bin/env node
import { Ledger, Violation, StatusUpdate } from './ledger.js';

/**
 * Unified CLI client for managing the violations ledger
 *
 * Usage:
 *   ledger-cli.ts get <violation-id> [--json]
 *   ledger-cli.ts update <violation-id> <status> [--json]
 *   ledger-cli.ts list [--status=<status>] [--severity=<severity>] [--clause=<clause>] [--json]
 *   ledger-cli.ts stats [--json]
 *
 * Subcommands:
 *   get      Get a single violation by ID
 *   update   Update violation status
 *   list     List violations with optional filters
 *   stats    Show aggregate statistics
 *
 * Options:
 *   --json   Output JSON instead of human-readable format
 */

/**
 * Formats violation for human-readable output
 */
function formatViolation(v: Violation): string {
  const lines = [
    `ID: ${v.id}`,
    `Status: ${v.status}`,
    `Severity: ${v.severity}`,
    `Clauses: ${v.clauses.join(', ')}`,
    `File: ${v.path}:${v.line}`,
    `Title: ${v.title}`,
    ``,
    `Description:`,
    v.description,
    ``,
    `Suggested Fix:`,
    v.suggested_fix,
  ];

  if (v.owner) {
    lines.splice(2, 0, `Owner: ${v.owner}`);
  }

  if (v.worktree_branch) {
    lines.splice(2, 0, `Worktree Branch: ${v.worktree_branch}`);
  }

  if (v.pr_url) {
    lines.splice(2, 0, `PR URL: ${v.pr_url}`);
  }

  lines.push('');
  lines.push(`First Seen: ${v.first_seen}`);
  lines.push(`Last Seen: ${v.last_seen}`);

  return lines.join('\n');
}

/**
 * Formats violation for compact list view
 */
function formatViolationCompact(v: Violation): string {
  const statusEmoji = {
    open: '🔴',
    triaged: '🟡',
    in_progress: '🔵',
    pr_open: '🟣',
    merged: '🟢',
    verified: '✅',
    closed: '⚫',
    suppressed: '🔇',
  };

  const severityColor = {
    critical: '🔥',
    high: '⚠️',
    medium: '📝',
    low: 'ℹ️',
    info: '💡',
  };

  return `${statusEmoji[v.status]} ${severityColor[v.severity]} ${v.id} | ${v.path}:${v.line} | ${v.title}`;
}

/**
 * Get subcommand - retrieves a single violation by ID
 */
async function cmdGet(args: string[]): Promise<number> {
  if (args.length === 0) {
    console.error('Usage: ledger-cli.ts get <violation-id> [--json]');
    console.error('');
    console.error('Example:');
    console.error('  yarn tsx codespec/lib/ledger-cli.ts get V-d68bbf');
    console.error('  yarn tsx codespec/lib/ledger-cli.ts get V-d68bbf --json');
    return 1;
  }

  const violationId = args[0];
  const jsonOutput = args.includes('--json');

  try {
    const ledger = new Ledger();
    const all = await ledger.getAll();
    const violation = all.find(v => v.id.toLowerCase() === violationId.toLowerCase());

    if (!violation) {
      if (jsonOutput) {
        console.log(JSON.stringify({ error: 'Violation not found', id: violationId }));
      } else {
        console.error(`❌ Violation not found: ${violationId}`);
      }
      return 1;
    }

    if (jsonOutput) {
      console.log(JSON.stringify(violation, null, 2));
    } else {
      console.log(formatViolation(violation));
    }

    return 0;
  } catch (error: any) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: error.message }));
    } else {
      console.error(`❌ Error: ${error.message}`);
    }
    return 1;
  }
}

/**
 * Update subcommand - updates violation status
 */
async function cmdUpdate(args: string[]): Promise<number> {
  if (args.length < 2) {
    console.error('Usage: ledger-cli.ts update <violation-id> <status> [options]');
    console.error('');
    console.error('Valid statuses:');
    console.error('  open, triaged, in_progress, pr_open, merged, verified, closed, suppressed');
    console.error('');
    console.error('Options:');
    console.error('  --worktree-branch=<branch>  Set worktree branch name');
    console.error('  --pr-url=<url>              Set pull request URL');
    console.error('  --json                      Output JSON');
    console.error('');
    console.error('Examples:');
    console.error('  yarn tsx codespec/lib/ledger-cli.ts update V-d68bbf verified');
    console.error('  yarn tsx codespec/lib/ledger-cli.ts update V-d68bbf in_progress --worktree-branch=codespec/fix-V-d68bbf');
    console.error('  yarn tsx codespec/lib/ledger-cli.ts update V-d68bbf pr_open --pr-url=https://github.com/org/repo/pull/123');
    return 1;
  }

  const violationId = args[0];
  const newStatus = args[1] as Violation['status'];
  const jsonOutput = args.includes('--json');

  // Parse optional flags
  const worktreeBranch = args.find(a => a.startsWith('--worktree-branch='))?.split('=')[1];
  const prUrl = args.find(a => a.startsWith('--pr-url='))?.split('=')[1];

  const validStatuses = ['open', 'triaged', 'in_progress', 'pr_open', 'merged', 'verified', 'closed', 'suppressed'];
  if (!validStatuses.includes(newStatus)) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: `Invalid status: ${newStatus}`, validStatuses }));
    } else {
      console.error(`❌ Invalid status: ${newStatus}`);
      console.error(`Valid statuses: ${validStatuses.join(', ')}`);
    }
    return 1;
  }

  try {
    const ledger = new Ledger();
    const all = await ledger.getAll();
    const violation = all.find(v => v.id.toLowerCase() === violationId.toLowerCase());

    if (!violation) {
      if (jsonOutput) {
        console.log(JSON.stringify({ error: 'Violation not found', id: violationId }));
      } else {
        console.error(`❌ Violation not found: ${violationId}`);
      }
      return 1;
    }

    // Update status
    const update: StatusUpdate = {
      status: newStatus,
      ...(worktreeBranch && { worktree_branch: worktreeBranch }),
      ...(prUrl && { pr_url: prUrl })
    };
    await ledger.updateStatus(violation.fingerprint, update);

    if (jsonOutput) {
      console.log(JSON.stringify({
        success: true,
        id: violation.id,
        oldStatus: violation.status,
        newStatus,
        ...(worktreeBranch && { worktreeBranch }),
        ...(prUrl && { prUrl })
      }));
    } else {
      console.log(`✅ Updated ${violation.id}: ${violation.status} → ${newStatus}`);
      if (worktreeBranch) {
        console.log(`   Worktree branch: ${worktreeBranch}`);
      }
      if (prUrl) {
        console.log(`   PR URL: ${prUrl}`);
      }
    }

    return 0;
  } catch (error: any) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: error.message }));
    } else {
      console.error(`❌ Error: ${error.message}`);
    }
    return 1;
  }
}

/**
 * List subcommand - lists violations with optional filters
 */
async function cmdList(args: string[]): Promise<number> {
  const jsonOutput = args.includes('--json');

  // Parse filters
  const statusFilter = args.find(a => a.startsWith('--status='))?.split('=')[1];
  const severityFilter = args.find(a => a.startsWith('--severity='))?.split('=')[1];
  const clauseFilter = args.find(a => a.startsWith('--clause='))?.split('=')[1];

  try {
    const ledger = new Ledger();
    let violations = await ledger.getAll();

    // Apply filters
    if (statusFilter) {
      violations = violations.filter(v => v.status === statusFilter);
    }
    if (severityFilter) {
      violations = violations.filter(v => v.severity === severityFilter);
    }
    if (clauseFilter) {
      violations = violations.filter(v => v.clauses.includes(clauseFilter));
    }

    if (jsonOutput) {
      console.log(JSON.stringify(violations, null, 2));
    } else {
      if (violations.length === 0) {
        console.log('No violations found.');
        return 0;
      }

      console.log(`Found ${violations.length} violation(s):\n`);
      violations.forEach(v => {
        console.log(formatViolationCompact(v));
      });
    }

    return 0;
  } catch (error: any) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: error.message }));
    } else {
      console.error(`❌ Error: ${error.message}`);
    }
    return 1;
  }
}

/**
 * Stats subcommand - shows aggregate statistics
 */
async function cmdStats(args: string[]): Promise<number> {
  const jsonOutput = args.includes('--json');

  try {
    const ledger = new Ledger();
    const stats = await ledger.getStats();

    if (jsonOutput) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log('Violations Ledger Statistics:\n');
      console.log(`Total Violations: ${stats.total}\n`);

      console.log('By Status:');
      Object.entries(stats.by_status).forEach(([status, count]) => {
        console.log(`  ${status}: ${count}`);
      });
      console.log('');

      console.log('By Severity:');
      Object.entries(stats.by_severity).forEach(([severity, count]) => {
        console.log(`  ${severity}: ${count}`);
      });
      console.log('');

      console.log('By Clause:');
      Object.entries(stats.by_clause).forEach(([clause, count]) => {
        console.log(`  ${clause}: ${count}`);
      });
    }

    return 0;
  } catch (error: any) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: error.message }));
    } else {
      console.error(`❌ Error: ${error.message}`);
    }
    return 1;
  }
}

/**
 * Show help
 */
function showHelp(): void {
  console.log('Unified CLI client for managing the violations ledger');
  console.log('');
  console.log('Usage:');
  console.log('  ledger-cli.ts <subcommand> [options]');
  console.log('');
  console.log('Subcommands:');
  console.log('  get <id>              Get a single violation by ID');
  console.log('  update <id> <status>  Update violation status');
  console.log('  list [filters]        List violations with optional filters');
  console.log('  stats                 Show aggregate statistics');
  console.log('');
  console.log('Examples:');
  console.log('  yarn tsx codespec/lib/ledger-cli.ts get V-d68bbf');
  console.log('  yarn tsx codespec/lib/ledger-cli.ts update V-d68bbf verified');
  console.log('  yarn tsx codespec/lib/ledger-cli.ts list --status=open');
  console.log('  yarn tsx codespec/lib/ledger-cli.ts list --severity=critical --json');
  console.log('  yarn tsx codespec/lib/ledger-cli.ts stats');
  console.log('');
  console.log('Global Options:');
  console.log('  --json                Output JSON instead of human-readable format');
  console.log('');
  console.log('List Filters:');
  console.log('  --status=<status>     Filter by status (open, verified, etc.)');
  console.log('  --severity=<severity> Filter by severity (critical, high, etc.)');
  console.log('  --clause=<clause>     Filter by clause (obj1, obj2, obj3, r1, r2, r3)');
}

/**
 * Main function
 */
async function main(): Promise<number> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    return args.includes('--help') || args.includes('-h') ? 0 : 1;
  }

  const subcommand = args[0];
  const subcommandArgs = args.slice(1);

  switch (subcommand) {
    case 'get':
      return await cmdGet(subcommandArgs);
    case 'update':
      return await cmdUpdate(subcommandArgs);
    case 'list':
      return await cmdList(subcommandArgs);
    case 'stats':
      return await cmdStats(subcommandArgs);
    default:
      console.error(`❌ Unknown subcommand: ${subcommand}`);
      console.error('');
      showHelp();
      return 1;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(exitCode => {
    process.exit(exitCode);
  }).catch(error => {
    console.error(`❌ Fatal error: ${error.message}`);
    process.exit(1);
  });
}
