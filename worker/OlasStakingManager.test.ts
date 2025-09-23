/**
 * Tests for OlasStakingManager - minimal tests for critical paths
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OlasStakingManager } from "./OlasStakingManager.js";
import { SafeExecutor } from "./SafeExecutor.js";

// Mock SafeExecutor
vi.mock("./SafeExecutor.js", () => ({
  SafeExecutor: vi.fn().mockImplementation(() => ({
    // Mock implementation
  })),
}));

// Mock logger
vi.mock("./logger.js", () => ({
  logger: {
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

describe("OlasStakingManager", () => {
  let baseExecutor: SafeExecutor;
  let mainnetExecutor: SafeExecutor;

  beforeEach(() => {
    baseExecutor = new SafeExecutor();
    mainnetExecutor = new SafeExecutor();
  });

  describe("constructor", () => {
    it("should initialize with valid executors", () => {
      expect(() => {
        new OlasStakingManager(baseExecutor, mainnetExecutor);
      }).not.toThrow();
    });

    it("should throw error if base executor is missing", () => {
      expect(() => {
        new OlasStakingManager(null as any, mainnetExecutor);
      }).toThrow(
        "OlasStakingManager requires both Base and Mainnet SafeExecutor instances",
      );
    });

    it("should throw error if mainnet executor is missing", () => {
      expect(() => {
        new OlasStakingManager(baseExecutor, null as any);
      }).toThrow(
        "OlasStakingManager requires both Base and Mainnet SafeExecutor instances",
      );
    });
  });

  describe("stakeOlas", () => {
    it("should execute staking operation without error", async () => {
      const manager = new OlasStakingManager(baseExecutor, mainnetExecutor);

      await expect(manager.stakeOlas()).resolves.toBeUndefined();
    });
  });

  describe("claimIncentives", () => {
    it("should execute incentive claiming operation without error", async () => {
      const manager = new OlasStakingManager(baseExecutor, mainnetExecutor);

      await expect(manager.claimIncentives()).resolves.toBeUndefined();
    });
  });
});
