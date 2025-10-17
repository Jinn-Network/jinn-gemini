#!/usr/bin/env node
import { writeFile } from 'fs/promises';
import { Ledger, Violation } from '../lib/ledger.js';

/**
 * Groups violations by file path
 */
function groupByPath(violations: Violation[]): Map<string, Violation[]> {
  const grouped = new Map<string, Violation[]>();

  for (const v of violations) {
    const existing = grouped.get(v.path) || [];
    existing.push(v);
    grouped.set(v.path, existing);
  }

  return grouped;
}

/**
 * Formats a violation as markdown
 */
function formatViolation(v: Violation): string {
  const clausesBadge = v.clauses.map(c => `\`${c}\``).join(' ');
  const severityEmoji = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🟢',
    info: '🔵',
  }[v.severity];

  let md = `#### ${v.id}: ${v.title}\n\n`;
  md += `${severityEmoji} **Severity:** ${v.severity} | **Clauses:** ${clausesBadge} | **Status:** ${v.status}\n\n`;
  md += `**Location:** [${v.path}:${v.line}](${v.path}#L${v.line})\n\n`;
  md += `**Description:**\n${v.description}\n\n`;
  md += `**Suggested Fix:**\n\`\`\`typescript\n${v.suggested_fix}\n\`\`\`\n\n`;

  if (v.owner) {
    md += `**Owner:** ${v.owner}\n\n`;
  }

  if (v.pr_url) {
    md += `**PR:** ${v.pr_url}\n\n`;
  }

  md += `**First seen:** ${new Date(v.first_seen).toLocaleDateString()} | **Last seen:** ${new Date(v.last_seen).toLocaleDateString()}\n\n`;
  md += `---\n\n`;

  return md;
}

/**
 * Generates VIOLATIONS.md report
 */
async function generateReport() {
  const ledger = new Ledger();
  const all = await ledger.getAll();
  const stats = await ledger.getStats();

  // Filter out closed/verified violations
  const active = all.filter(v => !['closed', 'verified'].includes(v.status));

  // Sort by severity (critical first) then by path
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  active.sort((a, b) => {
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return a.path.localeCompare(b.path);
  });

  // Generate markdown
  let md = `# Code Spec Violations Report\n\n`;
  md += `**Generated:** ${new Date().toISOString()}\n\n`;
  md += `## Summary\n\n`;
  md += `- **Total violations:** ${stats.total}\n`;
  md += `- **Active violations:** ${active.length}\n\n`;

  md += `### By Status\n\n`;
  for (const [status, count] of Object.entries(stats.by_status).sort(([, a], [, b]) => b - a)) {
    md += `- ${status}: ${count}\n`;
  }
  md += `\n`;

  md += `### By Severity\n\n`;
  for (const [severity, count] of Object.entries(stats.by_severity).sort(([, a], [, b]) => b - a)) {
    const emoji = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢', info: '🔵' }[severity] || '';
    md += `- ${emoji} ${severity}: ${count}\n`;
  }
  md += `\n`;

  md += `### By Clause\n\n`;
  for (const [clause, count] of Object.entries(stats.by_clause).sort(([, a], [, b]) => b - a)) {
    md += `- \`${clause}\`: ${count}\n`;
  }
  md += `\n`;

  if (active.length === 0) {
    md += `## No Active Violations\n\n`;
    md += `All violations have been resolved! 🎉\n`;
  } else {
    md += `## Active Violations\n\n`;

    // Group by file
    const grouped = groupByPath(active);

    for (const [path, violations] of Array.from(grouped.entries()).sort()) {
      md += `### [${path}](${path})\n\n`;
      md += `${violations.length} violation(s)\n\n`;

      for (const v of violations) {
        md += formatViolation(v);
      }
    }
  }

  // Append closed violations summary
  const closed = all.filter(v => ['closed', 'verified'].includes(v.status));
  if (closed.length > 0) {
    md += `## Resolved Violations (${closed.length})\n\n`;
    md += `The following violations have been resolved:\n\n`;

    for (const v of closed.sort((a, b) => a.path.localeCompare(b.path))) {
      md += `- ${v.id} in [${v.path}:${v.line}](${v.path}#L${v.line}) - ${v.title}\n`;
    }
    md += `\n`;
  }

  return md;
}

/**
 * Main function
 */
async function main() {
  try {
    const report = await generateReport();
    const outputPath = 'docs/spec/code-spec/VIOLATIONS.md';

    await writeFile(outputPath, report, 'utf-8');
    console.log(`✅ Report generated: ${outputPath}`);

    const ledger = new Ledger();
    const stats = await ledger.getStats();
    console.log(`📊 Total violations: ${stats.total}`);
    console.log(`📊 Active violations: ${Object.values(stats.by_status).reduce((sum, n) => sum + n, 0) - (stats.by_status['closed'] || 0) - (stats.by_status['verified'] || 0)}`);
  } catch (error) {
    console.error('Error generating report:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { generateReport, formatViolation, groupByPath };
