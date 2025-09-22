/**
 * Tests for StakingManagerFactory - minimal tests for critical paths
 */

import { StakingManagerFactory } from "./StakingManagerFactory.js";
import { OlasStakingManager } from "./OlasStakingManager.js";
import { SafeExecutor } from "./SafeExecutor.js";

// Mock dependencies
jest.mock("./SafeExecutor.js", () => ({
  SafeExecutor: jest.fn().mockImplementation(() => ({
    // Mock implementation
  })),
}));

jest.mock("./OlasStakingManager.js", () => ({
  OlasStakingManager: jest
    .fn()
    .mockImplementation((baseExecutor, mainnetExecutor) => ({
      baseExecutor,
      mainnetExecutor,
    })),
}));

jest.mock("./logger.js", () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

describe("StakingManagerFactory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
