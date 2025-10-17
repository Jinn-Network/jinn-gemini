#!/usr/bin/env node
import { Ledger } from '../lib/ledger.js';
import { WorktreeManager } from '../lib/worktree-manager.js';
import { ContextGenerator } from '../lib/context-generator.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile } from 'fs/promises';
import { join } from 'path';

const execAsync = promisify(exec);

/**
 * Autofix workflow orchestrator
 */
class AutofixOrchestrator {
  private ledger: Ledger;
  private worktreeManager: WorktreeManager;
  private contextGenerator: ContextGenerator;
  private repoRoot: string;

  constructor(repoRoot = process.cwd()) {
    this.repoRoot = repoRoot;
    this.ledger = new Ledger();
    this.worktreeManager = new WorktreeManager(repoRoot);
    this.contextGenerator = new ContextGenerator(repoRoot);
  }

  /**
   * Runs the autofix workflow for a violation
   */
  async autofix(violationId: string, options: { baseBranch?: string; dryRun?: boolean } = {}) {
    const { baseBranch = 'main', dryRun = false } = options;

    console.log(`\n🔧 Starting autofix workflow for ${violationId}...\n`);

    // 1. Get violation from ledger
    const violations = await this.ledger.getAll();
    const violation = violations.find(v => v.id === violationId);

    if (!violation) {
      throw new Error(`Violation ${violationId} not found in ledger`);
    }

    console.log(`📋 Violation: ${violation.title}`);
    console.log(`📁 File: ${violation.path}:${violation.line}`);
    console.log(`🏷️  Clauses: ${violation.clauses.join(', ')}`);
    console.log('');

    // 2. Check if worktree already exists
    if (await this.worktreeManager.worktreeExists(violationId)) {
      console.log(`⚠️  Worktree already exists for ${violationId}`);
      console.log(`   Path: ${this.worktreeManager.getWorktreePath(violationId)}`);
      console.log('   Remove it first or continue working in the existing worktree.');
      return;
    }

    // 3. Create worktree
    console.log(`🌳 Creating worktree...`);
    const worktree = await this.worktreeManager.createWorktree(violationId, baseBranch);
    console.log(`✅ Worktree created: ${worktree.path}`);
    console.log(`   Branch: ${worktree.branch}`);
    console.log('');

    try {
      // 4. Update ledger status
      await this.ledger.updateStatus(violation.fingerprint, {
        status: 'in_progress',
        worktree_branch: worktree.branch,
      });

      // 5. Generate fix context and prompt
      console.log(`📝 Generating fix prompt...`);
      const context = await this.contextGenerator.generateContext(violation);
      const prompt = await this.contextGenerator.generatePrompt(context);

      // Save prompt to worktree
      const promptPath = join(worktree.path, '.codespec-autofix-prompt.md');
      await writeFile(promptPath, prompt);
      console.log(`✅ Prompt saved to: ${promptPath}`);
      console.log('');

      if (dryRun) {
        console.log('🔍 Dry run mode - stopping here.');
        console.log(`   Review the prompt at: ${promptPath}`);
        console.log(`   To continue, run Claude Code in the worktree:`);
        console.log(`   cd ${worktree.path}`);
        console.log(`   claude -p "$(cat .codespec-autofix-prompt.md)"`);
        return;
      }

      // 6. Invoke Claude Code for autofix
      console.log(`🤖 Invoking Claude Code for autofix...`);
      console.log(`   This may take 1-3 minutes depending on the complexity...`);
      console.log('');

      try {
        await this.invokeClaudeAutofix(worktree.path, promptPath);
        console.log(`✅ Autofix completed`);
        console.log('');
      } catch (error: any) {
        console.error(`❌ Autofix failed: ${error.message}`);
        console.log(`   Worktree left open for manual fix: ${worktree.path}`);
        return;
      }

      // 7. Verify the fix
      console.log(`🔍 Verifying fix...`);
      const verifyResult = await this.verifyFix(worktree.path, violation.path);

      if (!verifyResult.reviewPassed) {
        console.log(`❌ Review still finds violations`);
        console.log(`   Worktree left open for manual fix: ${worktree.path}`);
        return;
      }

      if (!verifyResult.testsPassed) {
        console.log(`❌ Tests failed`);
        console.log(`   Worktree left open for manual fix: ${worktree.path}`);
        return;
      }

      console.log(`✅ Verification passed!`);
      console.log('');

      // 8. Commit changes
      console.log(`💾 Committing changes...`);
      const commitMessage = `fix(codespec): ${violation.title}\n\nFixes ${violationId}\nClauses: ${violation.clauses.join(', ')}\n\n🤖 Generated with CodeSpec Autofix`;
      await this.worktreeManager.commit(violationId, commitMessage);
      console.log(`✅ Changes committed`);
      console.log('');

      // 9. Push to remote
      console.log(`📤 Pushing to remote...`);
      await this.worktreeManager.push(violationId);
      console.log(`✅ Pushed to remote`);
      console.log('');

      // 10. Create PR
      console.log(`📬 Creating pull request...`);
      const prUrl = await this.createPR(violation, worktree.branch);
      console.log(`✅ PR created: ${prUrl}`);
      console.log('');

      // 11. Update ledger
      await this.ledger.updateStatus(violation.fingerprint, {
        status: 'pr_open',
        pr_url: prUrl,
      });

      console.log(`🎉 Autofix workflow complete!`);
      console.log(`   PR: ${prUrl}`);
      console.log(`   Next: Review and merge the PR`);
    } catch (error: any) {
      console.error(`\n❌ Error during autofix: ${error.message}`);
      console.log(`   Worktree left open for debugging: ${worktree.path}`);
      throw error;
    }
  }

  /**
   * Invokes Claude Code to apply the autofix
   */
  private async invokeClaudeAutofix(worktreePath: string, promptPath: string): Promise<void> {
    try {
      const { stdout, stderr } = await execAsync(
        `claude -p "$(cat ${promptPath})"`,
        { cwd: worktreePath, timeout: 300000, encoding: 'utf-8' }
      );

      console.log('Claude Code output:');
      console.log(stdout);
      if (stderr) {
        console.error('Stderr:', stderr);
      }
    } catch (error: any) {
      throw new Error(`Claude Code invocation failed: ${error.message}`);
    }
  }

  /**
   * Verifies that the fix resolved the violation and tests pass
   */
  private async verifyFix(worktreePath: string, filePath: string): Promise<{
    reviewPassed: boolean;
    testsPassed: boolean;
  }> {
    let reviewPassed = false;
    let testsPassed = false;

    // Run review script
    console.log(`   Running review on ${filePath}...`);
    try {
      await execAsync(`./codespec/scripts/detect-violations.sh ${filePath}`, {
        cwd: worktreePath,
        timeout: 180000,
      });
      reviewPassed = true;
      console.log(`   ✅ Review passed`);
    } catch (error) {
      console.log(`   ❌ Review found violations`);
    }

    // Run tests
    console.log(`   Running tests...`);
    try {
      await execAsync('yarn test', {
        cwd: worktreePath,
        timeout: 300000,
      });
      testsPassed = true;
      console.log(`   ✅ Tests passed`);
    } catch (error) {
      console.log(`   ❌ Tests failed`);
    }

    return { reviewPassed, testsPassed };
  }

  /**
   * Creates a pull request using gh CLI
   */
  private async createPR(violation: any, branch: string): Promise<string> {
    const title = `fix(codespec): ${violation.title}`;
    const body = this.contextGenerator.generatePRSummary([violation]);

    try {
      const { stdout } = await execAsync(
        `gh pr create --title "${title}" --body "${body.replace(/"/g, '\\"')}" --head ${branch}`,
        { cwd: this.repoRoot, encoding: 'utf-8' }
      );

      // Extract PR URL from output
      const urlMatch = stdout.match(/https:\/\/github\.com\/[^\s]+/);
      return urlMatch ? urlMatch[0] : stdout.trim();
    } catch (error: any) {
      throw new Error(`Failed to create PR: ${error.message}`);
    }
  }
}

/**
 * Main CLI
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: autofix-violation.ts <violation-id> [--dry-run] [--base-branch <branch>]');
    console.error('');
    console.error('Options:');
    console.error('  --dry-run          Generate prompt but do not invoke Claude');
    console.error('  --base-branch      Base branch for worktree (default: main)');
    process.exit(1);
  }

  const violationId = args[0];
  const dryRun = args.includes('--dry-run');
  const baseBranchIndex = args.indexOf('--base-branch');
  const baseBranch = baseBranchIndex >= 0 ? args[baseBranchIndex + 1] : 'main';

  const orchestrator = new AutofixOrchestrator();

  try {
    await orchestrator.autofix(violationId, { dryRun, baseBranch });
  } catch (error: any) {
    console.error(`\n❌ Autofix failed: ${error.message}`);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { AutofixOrchestrator };
