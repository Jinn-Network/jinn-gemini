/**
 * Tests for StakingManagerFactory - minimal tests for critical paths
 * Refactored for JINN-180: Test OlasOperateWrapper-based implementation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StakingManagerFactory } from "./StakingManagerFactory.js";
import { OlasStakingManager } from "./OlasStakingManager.js";
import { OlasOperateWrapper } from "./OlasOperateWrapper.js";
import { OlasServiceManager } from "./OlasServiceManager.js";

// Mock dependencies
vi.mock("./OlasOperateWrapper.js", () => ({
  OlasOperateWrapper: {
    create: vi.fn(),
  },
}));

vi.mock("./OlasStakingManager.js", () => ({
  OlasStakingManager: vi
    .fn()
    .mockImplementation((operateWrapper) => ({
      operateWrapper,
    })),
}));

vi.mock("./OlasServiceManager.js", () => ({
  OlasServiceManager: {
    createDefault: vi.fn().mockResolvedValue({}),
  },
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
  const mockOperateWrapperInstance = { 
    executeCommand: vi.fn(),
    checkHealth: vi.fn().mockResolvedValue(true),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    (OlasOperateWrapper.create as any).mockResolvedValue(mockOperateWrapperInstance);
  });

  describe("createStakingManager", () => {
    it("should create staking manager successfully", async () => {
      const result = await StakingManagerFactory.createStakingManager();

      expect(result).toBeDefined();
      expect(OlasOperateWrapper.create).toHaveBeenCalledTimes(1);
      expect(OlasStakingManager).toHaveBeenCalledTimes(1);
      expect(OlasStakingManager).toHaveBeenCalledWith(mockOperateWrapperInstance);
    });

    it("should return null if initialization fails", async () => {
      // Mock OlasOperateWrapper.create to throw an error
      (OlasOperateWrapper.create as any).mockRejectedValueOnce(new Error("Initialization failed"));

      const result = await StakingManagerFactory.createStakingManager();

      expect(result).toBeNull();
    });
  });
});
