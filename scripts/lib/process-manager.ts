/**
 * Process orchestration for dev-vnet services
 *
 * Responsibilities:
 * - Start services with proper environment
 * - Stream output with prefixes
 * - Detect crashes and quota errors
 * - Graceful shutdown
 */

import { execa, type ResultPromise } from 'execa';
import fetch from 'cross-fetch';
import { scriptLogger } from 'jinn-node/logging/index.js';

export interface ServiceConfig {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
}

export interface HealthCheckConfig {
  url: string;
  query: string;
  expectedResponse: (data: any) => boolean;
  timeoutMs: number;
  intervalMs: number;
}

export class ProcessManager {
  private processes = new Map<string, ResultPromise>();
  private onCrash?: (serviceName: string, code: number) => void;
  private onQuotaError?: () => void;
  private isShuttingDown = false;

  constructor(options?: {
    onCrash?: (serviceName: string, code: number) => void;
    onQuotaError?: () => void;
  }) {
    this.onCrash = options?.onCrash;
    this.onQuotaError = options?.onQuotaError;
  }

  /**
   * Start a service with output streaming
   */
  startService(config: ServiceConfig): ResultPromise {
    const proc = execa(config.command, config.args, {
      cwd: config.cwd,
      env: { ...process.env, ...config.env },
      stdio: 'pipe',
      detached: true,  // Survive parent death (e.g. Bash tool cleanup)
    });

    // Stream stdout with prefix and detect quota errors
    if (proc.stdout) {
      proc.stdout.on('data', (data: Buffer) => {
        const msg = data.toString();
        const lines = msg.split('\n');

        lines.forEach(line => {
          if (line.trim()) {
            console.log(`[${config.name}] ${line}`);

            // Detect quota exhaustion (can appear in stdout from worker errors)
            if (this.onQuotaError &&
                (line.includes('429') ||
                 line.includes('quota limit') ||
                 line.includes('rate limit'))) {
              this.onQuotaError();
            }
          }
        });
      });
    }

    // Stream stderr with prefix and detect quota errors
    if (proc.stderr) {
      proc.stderr.on('data', (data: Buffer) => {
        const msg = data.toString();
        const lines = msg.split('\n');

        lines.forEach(line => {
          if (line.trim()) {
            console.error(`[${config.name}] ${line}`);

            // Detect quota exhaustion
            if (this.onQuotaError &&
                (line.includes('429') ||
                 line.includes('quota') ||
                 line.includes('rate limit'))) {
              this.onQuotaError();
            }
          }
        });
      });
    }

    // Monitor crashes (but ignore exit events during shutdown)
    proc.on('exit', (code: number | null) => {
      if (code !== 0 && code !== null && this.onCrash && !this.isShuttingDown) {
        this.onCrash(config.name, code);
      }
    });

    this.processes.set(config.name, proc);
    return proc;
  }

  /**
   * Wait for GraphQL endpoint to be healthy
   * Pattern from E2E test (lines 84-102)
   */
  async waitForGraphql(config: HealthCheckConfig): Promise<void> {
    const start = Date.now();
    let lastErr: any = null;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const resp = await fetch(config.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: config.query }),
        });

        if (resp.ok) {
          const data = await resp.json();
          if (config.expectedResponse(data)) {
            return; // Success
          }
        }
        lastErr = new Error(`GraphQL HTTP ${resp.status}`);
      } catch (e: any) {
        lastErr = e;
      }

      if (Date.now() - start > config.timeoutMs) {
        throw lastErr || new Error(`Timed out waiting for ${config.url}`);
      }

      await new Promise(r => setTimeout(r, config.intervalMs));
    }
  }

  /**
   * Kill all processes gracefully
   */
  async killAll(): Promise<void> {
    this.isShuttingDown = true; // Set flag to prevent crash handler from triggering
    const killPromises: Promise<void>[] = [];

    Array.from(this.processes.entries()).forEach(([name, proc]) => {
      scriptLogger.info({ serviceName: name }, 'Stopping service');
      killPromises.push(
        new Promise<void>((resolve) => {
          try {
            // Kill the process group (negative PID) so grandchildren die too.
            // Detached processes run in their own group with pgid === pid.
            if (proc.pid) {
              process.kill(-proc.pid, 'SIGTERM');
            } else {
              proc.kill('SIGTERM');
            }
            // Force kill after timeout
            setTimeout(() => {
              try {
                if (proc.pid) {
                  process.kill(-proc.pid, 'SIGKILL');
                } else {
                  proc.kill('SIGKILL');
                }
              } catch (e) {
                // Already dead
              }
            }, 5000);
          } catch (e) {
            // Ignore errors
          }
          resolve();
        })
      );
    });

    await Promise.all(killPromises);
    this.processes.clear();
  }

  /**
   * Get process by name
   */
  getProcess(name: string): ResultPromise | undefined {
    return this.processes.get(name);
  }

  /**
   * Get all process PIDs
   */
  getPids(): Map<string, number> {
    const pids = new Map<string, number>();
    Array.from(this.processes.entries()).forEach(([name, proc]) => {
      if (proc.pid) {
        pids.set(name, proc.pid);
      }
    });
    return pids;
  }
}
