/**
 * Utility functions for handling delays in the worker loop
 */

import { logger } from "./logger.js";

const delayLogger = logger.child({ component: "DELAY" });

export class DelayUtils {
  /**
   * Sleep for specified milliseconds
   */
  static async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Handle idle delay when no work is available
   */
  static async handleIdleDelay(): Promise<void> {
    const delay = 5000; // 5 seconds
    delayLogger.debug(
      `No jobs, transactions, or staking operations found, waiting ${delay}ms.`,
    );
    await this.sleep(delay);
  }

  /**
   * Handle partial work delay when only jobs were processed
   */
  static async handlePartialWorkDelay(): Promise<void> {
    const delay = 2000; // 2 seconds
    await this.sleep(delay);
  }

  /**
   * Handle critical error delay
   */
  static async handleCriticalErrorDelay(error: unknown): Promise<void> {
    const delay = 30000; // 30 seconds
    console.error(
      "Critical error in main loop. Waiting 30 seconds before retrying.",
      error,
    );
    await this.sleep(delay);
  }
}
