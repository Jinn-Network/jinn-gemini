/**
 * Tests for StakingManagerFactory - minimal tests for critical paths
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StakingManagerFactory } from "./StakingManagerFactory.js";
import { OlasStakingManager } from "./OlasStakingManager.js";
import { SafeExecutor } from "./SafeExecutor.js";

// Mock dependencies
vi.mock("./SafeExecutor.js", () => ({
  SafeExecutor: vi.fn().mockImplementation(() => ({
    // Mock implementation
  })),
}));

vi.mock("./OlasStakingManager.js", () => ({
  OlasStakingManager: vi
    .fn()
    .mockImplementation((baseExecutor, mainnetExecutor) => ({
      baseExecutor,
      mainnetExecutor,
    })),
}));

vi.mock("./logger.js", () => ({
  logger: {
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

describe("StakingManagerFactory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createStakingManager", () => {
    it("should create staking manager successfully", async () => {
      const result = await StakingManagerFactory.createStakingManager();

      expect(result).toBeDefined();
      expect(SafeExecutor).toHaveBeenCalledTimes(2);
      expect(OlasStakingManager).toHaveBeenCalledTimes(1);
    });

    it("should return null if initialization fails", async () => {
      // Mock SafeExecutor to throw an error
      (SafeExecutor as jest.Mock).mockImplementationOnce(() => {
        throw new Error("Initialization failed");
      });

      const result = await StakingManagerFactory.createStakingManager();

      expect(result).toBeNull();
    });
  });
});
