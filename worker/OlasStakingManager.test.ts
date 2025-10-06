/**
 * Tests for OlasStakingManager - minimal tests for critical paths
 * Refactored for JINN-180: Test OlasOperateWrapper-based implementation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OlasStakingManager } from "./OlasStakingManager.js";
import { OlasOperateWrapper } from "./OlasOperateWrapper.js";
import { OlasServiceManager, ServiceLifecycleTransition } from "./OlasServiceManager.js";

// Mock OlasOperateWrapper
vi.mock("./OlasOperateWrapper.js", () => ({
  OlasOperateWrapper: vi.fn().mockImplementation(() => ({
    executeCommand: vi.fn(),
    checkHealth: vi.fn().mockResolvedValue(true),
  })),
}));

// Mock OlasServiceManager
vi.mock("./OlasServiceManager.js", () => ({
  OlasServiceManager: {
    createDefault: vi.fn(),
  },
  ServiceLifecycleTransition: {
    NoActionNeeded: "NO_ACTION_NEEDED",
    ServiceDeployed: "SERVICE_DEPLOYED",
    ServiceStaked: "SERVICE_STAKED",
    ServiceStopped: "SERVICE_STOPPED",
    ServiceTerminated: "SERVICE_TERMINATED",
    RewardsClaimed: "REWARDS_CLAIMED",
  },
}));

// Mock logger
vi.mock("./logger.js", () => ({
  logger: {
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

describe("OlasStakingManager", () => {
  let operateWrapper: OlasOperateWrapper;

  beforeEach(() => {
    operateWrapper = new OlasOperateWrapper();
  });

  describe("constructor", () => {
    it("should initialize with valid operate wrapper", () => {
      expect(() => {
        new OlasStakingManager(operateWrapper);
      }).not.toThrow();
    });

    it("should throw error if operate wrapper is missing", () => {
      expect(() => {
        new OlasStakingManager(null as any);
      }).toThrow(
        "OlasStakingManager requires OlasOperateWrapper instance",
      );
    });
  });

  describe("stakeOlas", () => {
    it("should execute staking operation without error", async () => {
      const mockServiceManager = {
        deployAndStakeService: vi.fn().mockResolvedValue({
          serviceName: 'test-service',
          configPath: '/test/path',
          isRunning: true,
          isStaked: true,
        })
      };

      (OlasServiceManager.createDefault as any).mockResolvedValue(mockServiceManager);

      const manager = new OlasStakingManager(operateWrapper);

      await expect(manager.stakeOlas()).resolves.toBeUndefined();
      expect(OlasServiceManager.createDefault).toHaveBeenCalledWith({
        operateWrapper: operateWrapper,
      });
      expect(mockServiceManager.deployAndStakeService).toHaveBeenCalled();
    });

    it("should handle service manager creation failure gracefully", async () => {
      (OlasServiceManager.createDefault as any).mockRejectedValue(new Error("Service manager creation failed"));

      const manager = new OlasStakingManager(operateWrapper);

      await expect(manager.stakeOlas()).rejects.toThrow("Service manager creation failed");
    });
  });

  describe("claimIncentives", () => {
    it("should execute incentive claiming operation without error", async () => {
      const mockServiceManager = {
        claimRewards: vi.fn().mockResolvedValue({
          serviceName: 'test-service',
          configPath: '/test/path',
          isRunning: true,
          isStaked: true,
        })
      };

      (OlasServiceManager.createDefault as any).mockResolvedValue(mockServiceManager);

      const manager = new OlasStakingManager(operateWrapper);

      await expect(manager.claimIncentives()).resolves.toBeUndefined();
      expect(mockServiceManager.claimRewards).toHaveBeenCalled();
    });
  });
});
