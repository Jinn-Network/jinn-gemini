import { createHash } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';

/**
 * Represents a code spec violation tracked in the ledger
 */
export interface Violation {
  /** Unique ID (V-{first 6 chars of fingerprint}) */
  id: string;
  /** Clauses violated (e.g., ["r1", "obj3"]) */
  clauses: string[];
  /** Severity level */
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  /** File path relative to repo root */
  path: string;
  /** Line number where violation occurs */
  line: number;
  /** Short title describing the violation */
  title: string;
  /** Detailed description of the violation */
  description: string;
  /** Suggested fix */
  suggested_fix: string;
  /** SHA1 fingerprint for deduplication */
  fingerprint: string;
  /** ISO timestamp when first seen */
  first_seen: string;
  /** ISO timestamp when last seen */
  last_seen: string;
  /** Current status */
  status: 'open' | 'triaged' | 'in_progress' | 'pr_open' | 'merged' | 'verified' | 'closed' | 'suppressed';
  /** Assigned owner (optional) */
  owner?: string;
  /** Git worktree branch for autofix (optional) */
  worktree_branch?: string;
  /** Pull request URL (optional) */
  pr_url?: string;
}

/**
 * Type for creating a new violation (before ID/fingerprint/timestamps are assigned)
 */
export type NewViolation = Omit<Violation, 'id' | 'fingerprint' | 'first_seen' | 'last_seen'> & {
  first_seen?: string;
  last_seen?: string;
};

/**
 * Type for updating violation status
 */
export interface StatusUpdate {
  status: Violation['status'];
  owner?: string;
  worktree_branch?: string;
  pr_url?: string;
}

/**
 * Manages the violations ledger (append-only JSONL database)
 */
export class Ledger {
  private ledgerPath: string;

  constructor(ledgerPath = '.codespec/ledger.jsonl') {
    this.ledgerPath = ledgerPath;
  }

  /**
   * Generates a fingerprint for deduplication
   * Format: sha1(sort(clauses).join('|') + normalized_path + line)
   */
  private generateFingerprint(v: Pick<Violation, 'clauses' | 'path' | 'line'>): string {
    const normalized = v.path.replace(/\\/g, '/');
    const clausesStr = [...v.clauses].sort().join('|');
    const input = `${clausesStr}:${normalized}:${v.line}`;
    return createHash('sha1').update(input).digest('hex');
  }

  /**
   * Adds a new violation to the ledger
   * If a violation with the same fingerprint exists, updates last_seen instead
   */
  async addViolation(v: NewViolation): Promise<Violation> {
    // Ensure ledger directory exists
    await mkdir(dirname(this.ledgerPath), { recursive: true });

    // Generate fingerprint
    const fingerprint = this.generateFingerprint(v);
    const id = `V-${fingerprint.slice(0, 6)}`;

    // Check if violation already exists
    const existing = await this.getByFingerprint(fingerprint);

    const now = new Date().toISOString();

    if (existing) {
      // Update last_seen for existing violation
      const updated: Violation = {
        ...existing,
        last_seen: now,
        // Update description/suggested_fix in case they improved
        description: v.description,
        suggested_fix: v.suggested_fix,
      };

      await this.appendToLedger(updated);
      return updated;
    }

    // Create new violation
    const violation: Violation = {
      ...v,
      id,
      fingerprint,
      first_seen: v.first_seen || now,
      last_seen: v.last_seen || now,
    };

    await this.appendToLedger(violation);
    return violation;
  }

  /**
   * Updates the status of a violation
   */
  async updateStatus(fingerprint: string, update: StatusUpdate): Promise<void> {
    const existing = await this.getByFingerprint(fingerprint);

    if (!existing) {
      throw new Error(`Violation with fingerprint ${fingerprint} not found`);
    }

    const updated: Violation = {
      ...existing,
      status: update.status,
      last_seen: new Date().toISOString(),
      ...(update.owner !== undefined && { owner: update.owner }),
      ...(update.worktree_branch !== undefined && { worktree_branch: update.worktree_branch }),
      ...(update.pr_url !== undefined && { pr_url: update.pr_url }),
    };

    await this.appendToLedger(updated);
  }

  /**
   * Gets a violation by fingerprint (returns latest version)
   */
  async getByFingerprint(fingerprint: string): Promise<Violation | null> {
    if (!existsSync(this.ledgerPath)) {
      return null;
    }

    const content = await readFile(this.ledgerPath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l);

    // Build map of fingerprint -> latest violation
    const violations = new Map<string, Violation>();

    for (const line of lines) {
      const v = JSON.parse(line) as Violation;
      const existing = violations.get(v.fingerprint);

      if (!existing || new Date(v.last_seen) >= new Date(existing.last_seen)) {
        violations.set(v.fingerprint, v);
      }
    }

    return violations.get(fingerprint) || null;
  }

  /**
   * Gets all violations with status 'open'
   */
  async getAllOpen(): Promise<Violation[]> {
    return this.getAll().then(violations =>
      violations.filter(v => v.status === 'open')
    );
  }

  /**
   * Gets all violations (returns latest version of each)
   */
  async getAll(): Promise<Violation[]> {
    if (!existsSync(this.ledgerPath)) {
      return [];
    }

    const content = await readFile(this.ledgerPath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l);

    // Build map of fingerprint -> latest violation
    const violations = new Map<string, Violation>();

    for (const line of lines) {
      const v = JSON.parse(line) as Violation;
      const existing = violations.get(v.fingerprint);

      if (!existing || new Date(v.last_seen) >= new Date(existing.last_seen)) {
        violations.set(v.fingerprint, v);
      }
    }

    return Array.from(violations.values());
  }

  /**
   * Gets violations by clause (e.g., "r1", "obj3")
   */
  async getByClauses(clauses: string[]): Promise<Violation[]> {
    const all = await this.getAll();
    return all.filter(v =>
      clauses.some(c => v.clauses.includes(c))
    );
  }

  /**
   * Gets violations by file path
   */
  async getByPath(path: string): Promise<Violation[]> {
    const normalized = path.replace(/\\/g, '/');
    const all = await this.getAll();
    return all.filter(v => v.path === normalized);
  }

  /**
   * Appends a violation to the ledger (internal helper)
   */
  private async appendToLedger(violation: Violation): Promise<void> {
    const line = JSON.stringify(violation) + '\n';

    if (existsSync(this.ledgerPath)) {
      const existing = await readFile(this.ledgerPath, 'utf-8');
      await writeFile(this.ledgerPath, existing + line, 'utf-8');
    } else {
      await writeFile(this.ledgerPath, line, 'utf-8');
    }
  }

  /**
   * Gets ledger statistics
   */
  async getStats(): Promise<{
    total: number;
    by_status: Record<string, number>;
    by_severity: Record<string, number>;
    by_clause: Record<string, number>;
  }> {
    const all = await this.getAll();

    const by_status: Record<string, number> = {};
    const by_severity: Record<string, number> = {};
    const by_clause: Record<string, number> = {};

    for (const v of all) {
      by_status[v.status] = (by_status[v.status] || 0) + 1;
      by_severity[v.severity] = (by_severity[v.severity] || 0) + 1;

      for (const clause of v.clauses) {
        by_clause[clause] = (by_clause[clause] || 0) + 1;
      }
    }

    return {
      total: all.length,
      by_status,
      by_severity,
      by_clause,
    };
  }
}
