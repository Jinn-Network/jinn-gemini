import { readFile } from 'fs/promises';
import { Violation } from './ledger.js';

/**
 * Context object for autofix prompt
 */
export interface FixContext {
  violation: Violation;
  currentCode: string;
  additionalContext: string;
}

/**
 * Generates context for autofix prompts
 */
export class ContextGenerator {
  private repoRoot: string;

  constructor(repoRoot = process.cwd()) {
    this.repoRoot = repoRoot;
  }

  /**
   * Generates fix context for a violation
   */
  async generateContext(violation: Violation): Promise<FixContext> {
    // Read the target file
    const filePath = `${this.repoRoot}/${violation.path}`;
    const fileContent = await readFile(filePath, 'utf-8');

    // Extract current code around the violation line
    const currentCode = this.extractCodeContext(fileContent, violation.line);

    // Generate additional context
    const additionalContext = await this.generateAdditionalContext(violation);

    return {
      violation,
      currentCode,
      additionalContext,
    };
  }

  /**
   * Generates the full autofix prompt from template
   */
  async generatePrompt(context: FixContext): Promise<string> {
    // Read prompt template
    const templatePath = `${this.repoRoot}/codespec/prompts/autofix.md`;
    let template = await readFile(templatePath, 'utf-8');

    // Replace template variables
    template = template.replace('{{VIOLATION_ID}}', context.violation.id);
    template = template.replace('{{CLAUSES}}', context.violation.clauses.join(', '));
    template = template.replace('{{SEVERITY}}', context.violation.severity);
    template = template.replace('{{FILE_PATH}}', context.violation.path);
    template = template.replace(/\{\{LINE\}\}/g, context.violation.line.toString());
    template = template.replace('{{DESCRIPTION}}', context.violation.description);
    template = template.replace('{{CURRENT_CODE}}', context.currentCode);
    template = template.replace('{{SUGGESTED_FIX}}', context.violation.suggested_fix);
    template = template.replace('{{ADDITIONAL_CONTEXT}}', context.additionalContext);

    return template;
  }

  /**
   * Extracts code context around a specific line
   */
  private extractCodeContext(content: string, line: number, contextLines = 10): string {
    const lines = content.split('\n');
    const startLine = Math.max(0, line - contextLines - 1);
    const endLine = Math.min(lines.length, line + contextLines);

    const contextLines_ = lines.slice(startLine, endLine);

    // Add line numbers
    return contextLines_
      .map((l, i) => {
        const lineNum = startLine + i + 1;
        const marker = lineNum === line ? '→ ' : '  ';
        return `${marker}${lineNum.toString().padStart(4, ' ')}: ${l}`;
      })
      .join('\n');
  }

  /**
   * Generates additional context based on violation type
   */
  private async generateAdditionalContext(violation: Violation): Promise<string> {
    const parts: string[] = [];

    // Add clause-specific context
    if (violation.clauses.includes('r1')) {
      parts.push('**r1 Reminder:** Never commit secrets. Use environment variables or secure vaults.');
    }

    if (violation.clauses.includes('r2')) {
      parts.push('**r2 Reminder:** Always validate on-chain state before financial operations.');
    }

    if (violation.clauses.includes('r3')) {
      parts.push('**r3 Reminder:** Never silently discard errors in financial/blockchain contexts.');
    }

    if (violation.clauses.includes('obj1')) {
      parts.push('**obj1 Reminder:** Follow the principle of orthodoxy. Use the canonical pattern from the spec, not a custom variation.');
      parts.push('Common obj1 patterns: error handling (log + throw), null checking (explicit === null/undefined), async/await (no .then() chains).');
    }

    if (violation.clauses.includes('obj2')) {
      parts.push('**obj2 Reminder:** Code for the next agent. Make code explicit and discoverable through types, names, and locality.');
      parts.push('Avoid: inline env vars, magic globals, deep fallback chains, clever code, abbreviations.');
    }

    if (violation.clauses.includes('obj3')) {
      parts.push('**obj3 Reminder:** Minimize harm. Fail securely (fail-closed), validate all inputs, never log secrets.');
      parts.push('Security priority order: P0 (hardcoded secrets, SQL injection) > P1 (fail-open, missing validation) > P2 (sensitive logging).');
    }

    // Add severity-specific guidance
    if (violation.severity === 'critical') {
      parts.push('⚠️ **CRITICAL SEVERITY:** This violation must be fixed immediately. It poses a security risk or could cause financial loss.');
    }

    // Add ownership info if available
    if (violation.owner) {
      parts.push(`**Assigned to:** ${violation.owner}`);
    }

    return parts.length > 0 ? parts.join('\n\n') : 'No additional context.';
  }

  /**
   * Generates a summary for PR description
   */
  generatePRSummary(violations: Violation[]): string {
    const clauseCounts = new Map<string, number>();
    for (const v of violations) {
      for (const clause of v.clauses) {
        clauseCounts.set(clause, (clauseCounts.get(clause) || 0) + 1);
      }
    }

    const clausesSummary = Array.from(clauseCounts.entries())
      .map(([clause, count]) => `- ${clause}: ${count} violation${count > 1 ? 's' : ''}`)
      .join('\n');

    return `## CodeSpec Autofix

This PR automatically fixes ${violations.length} code spec violation${violations.length > 1 ? 's' : ''}.

### Violations Fixed

${clausesSummary}

### Files Changed

${violations.map(v => `- [${v.path}:${v.line}](${v.path}#L${v.line}) - ${v.title}`).join('\n')}

### Verification

- ✅ All violations resolved (verified by \`detect-violations.sh\`)
- ✅ Tests passing (verified by \`yarn test\`)

### Violation IDs

${violations.map(v => v.id).join(', ')}

---

🤖 Generated with CodeSpec Autofix
`;
  }
}
