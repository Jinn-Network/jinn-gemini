import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const execAsync = promisify(exec);

export interface Worktree {
  id: string;
  path: string;
  branch: string;
  baseBranch: string;
}

/**
 * Manages git worktrees for isolated autofix work
 */
export class WorktreeManager {
  private worktreeDir: string;
  private repoRoot: string;

  constructor(repoRoot = process.cwd(), worktreeDir = '.codespec/worktrees') {
    this.repoRoot = repoRoot;
    this.worktreeDir = join(repoRoot, worktreeDir);
  }

  /**
   * Creates a new worktree for fixing a violation
   */
  async createWorktree(violationId: string, baseBranch = 'main'): Promise<Worktree> {
    // Ensure worktree directory exists
    await mkdir(this.worktreeDir, { recursive: true });

    // Generate branch name
    const branch = `codespec/fix-${violationId}`;
    const worktreePath = join(this.worktreeDir, violationId);

    // Check if worktree already exists
    if (existsSync(worktreePath)) {
      throw new Error(`Worktree already exists for ${violationId} at ${worktreePath}`);
    }

    try {
      // Create worktree with new branch
      await this.exec(`git worktree add -b ${branch} ${worktreePath} ${baseBranch}`);

      return {
        id: violationId,
        path: worktreePath,
        branch,
        baseBranch,
      };
    } catch (error: any) {
      // Cleanup on failure
      await rm(worktreePath, { recursive: true, force: true }).catch(() => {});
      throw new Error(`Failed to create worktree: ${error.message}`);
    }
  }

  /**
   * Checks if a worktree exists for a violation
   */
  async worktreeExists(violationId: string): Promise<boolean> {
    const worktreePath = join(this.worktreeDir, violationId);
    return existsSync(worktreePath);
  }

  /**
   * Gets the path to an existing worktree
   */
  getWorktreePath(violationId: string): string {
    return join(this.worktreeDir, violationId);
  }

  /**
   * Lists all active worktrees
   */
  async listWorktrees(): Promise<Worktree[]> {
    try {
      const { stdout } = await this.exec('git worktree list --porcelain');
      return this.parseWorktreeList(stdout);
    } catch (error) {
      return [];
    }
  }

  /**
   * Removes a worktree
   */
  async removeWorktree(violationId: string, force = false): Promise<void> {
    const worktreePath = join(this.worktreeDir, violationId);

    if (!existsSync(worktreePath)) {
      return; // Already removed
    }

    try {
      // Remove worktree
      const forceFlag = force ? '--force' : '';
      await this.exec(`git worktree remove ${forceFlag} ${worktreePath}`);
    } catch (error: any) {
      throw new Error(`Failed to remove worktree: ${error.message}`);
    }
  }

  /**
   * Commits changes in a worktree
   */
  async commit(violationId: string, message: string): Promise<void> {
    const worktreePath = this.getWorktreePath(violationId);

    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree not found: ${worktreePath}`);
    }

    try {
      // Stage all changes
      await this.exec('git add -A', { cwd: worktreePath });

      // Check if there are changes to commit
      const { stdout: status } = await this.exec('git status --porcelain', { cwd: worktreePath });
      if (!status.trim()) {
        throw new Error('No changes to commit');
      }

      // Commit
      await this.exec(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: worktreePath });
    } catch (error: any) {
      throw new Error(`Failed to commit: ${error.message}`);
    }
  }

  /**
   * Pushes a worktree branch to remote
   */
  async push(violationId: string, remote = 'origin'): Promise<void> {
    const worktree = await this.getWorktree(violationId);
    if (!worktree) {
      throw new Error(`Worktree not found: ${violationId}`);
    }

    try {
      await this.exec(`git push -u ${remote} ${worktree.branch}`, { cwd: worktree.path });
    } catch (error: any) {
      throw new Error(`Failed to push: ${error.message}`);
    }
  }

  /**
   * Gets worktree info for a violation
   */
  async getWorktree(violationId: string): Promise<Worktree | null> {
    const worktrees = await this.listWorktrees();
    return worktrees.find(w => w.id === violationId) || null;
  }

  /**
   * Cleans up all worktrees in the worktree directory
   */
  async cleanup(force = false): Promise<number> {
    const worktrees = await this.listWorktrees();
    const codespecWorktrees = worktrees.filter(w => w.path.includes('.codespec/worktrees'));

    for (const worktree of codespecWorktrees) {
      try {
        await this.removeWorktree(worktree.id, force);
      } catch (error) {
        // Continue with other worktrees
        console.error(`Failed to remove worktree ${worktree.id}:`, error);
      }
    }

    return codespecWorktrees.length;
  }

  /**
   * Parses git worktree list output
   */
  private parseWorktreeList(output: string): Worktree[] {
    const worktrees: Worktree[] = [];
    const entries = output.split('\n\n');

    for (const entry of entries) {
      const lines = entry.split('\n').filter(l => l);
      let path = '';
      let branch = '';

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          path = line.replace('worktree ', '');
        } else if (line.startsWith('branch ')) {
          branch = line.replace('branch refs/heads/', '');
        }
      }

      if (path && branch && path.includes('.codespec/worktrees')) {
        const id = path.split('/').pop() || '';
        worktrees.push({
          id,
          path,
          branch,
          baseBranch: 'main', // Default, actual base not in porcelain output
        });
      }
    }

    return worktrees;
  }

  /**
   * Executes a git command
   */
  private async exec(command: string, options: { cwd?: string } = {}): Promise<{ stdout: string; stderr: string }> {
    const cwd = options.cwd || this.repoRoot;
    return execAsync(command, { cwd, encoding: 'utf-8' });
  }
}
