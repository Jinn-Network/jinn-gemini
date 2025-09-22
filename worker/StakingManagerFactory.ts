/**
 * Factory for creating and initializing OLAS staking manager
 */

import { OlasStakingManager } from "./OlasStakingManager.js";
import { SafeExecutor } from "./SafeExecutor.js";
import { logger } from "./logger.js";

const stakingLogger = logger.child({ component: "STAKING-FACTORY" });

export class StakingManagerFactory {
  /**
   * Creates and initializes an OLAS staking manager with proper error handling
   * @returns OlasStakingManager instance or null if initialization fails
   */
  static async createStakingManager(): Promise<OlasStakingManager | null> {
    try {
      // Create Base SafeExecutor (current configuration)
      const baseExecutor = new SafeExecutor();

      // Create Mainnet SafeExecutor (would need separate configuration for mainnet)
      // For now, using the same executor as placeholder - should be configured for mainnet
      const mainnetExecutor = new SafeExecutor();

      // Initialize OlasStakingManager
      const stakingManager = new OlasStakingManager(
        baseExecutor,
        mainnetExecutor,
      );
      stakingLogger.info("OLAS staking manager initialized successfully");

      return stakingManager;
    } catch (error) {
      stakingLogger.warn(
        { error },
        "Failed to initialize OLAS staking manager - staking operations will be disabled",
      );
      return null;
    }
  }
}
