/**
 * Validation Module Tests
 *
 * Tests for the transaction validation system, including:
 * - Legacy string-based allowlist format
 * - New object-based allowlist format with execution strategy constraints
 * - All acceptance criteria from the dual-rail execution spec
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateTransaction, resetAllowlistCache } from "./validation.js";
import { TransactionRequest, ExecutionStrategy } from "./types.js";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { URL } from "url";

// Test allowlist configurations
const testAllowlistLegacy = {
  "8453": {
    name: "Base Mainnet",
    contracts: {
      "0x777777751622c0d3258f214f9df38e35bf45baf3": {
        name: "Zora Factory",
        allowedSelectors: [
          "0xa423ada1", // Legacy string format - allows both EOA and SAFE
          "0xa27a6dce", // Legacy string format - allows both EOA and SAFE
          "0x14352ebc", // Legacy string format - allows both EOA and SAFE
        ],
      },
    },
  },
};

const testAllowlistNew = {
  "8453": {
    name: "Base Mainnet",
    contracts: {
      "0x777777751622c0d3258f214f9df38e35bf45baf3": {
        name: "Zora Factory",
        allowedSelectors: [
          "0xa423ada1", // Legacy string - allows both
          {
            selector: "0xa27a6dce",
            allowed_executors: ["SAFE"],
            notes: "createCoin() only via Safe",
          },
          {
            selector: "0x14352ebc",
            allowed_executors: ["EOA"],
            notes: "approve() only via EOA",
          },
          {
            selector: "0x095ea7b3",
            allowed_executors: ["SAFE"],
            notes: "approve() only via Safe",
          },
        ],
      },
    },
  },
  "84532": {
    name: "Base Sepolia",
    contracts: {
      "0x777777751622c0d3258f214f9df38e35bf45baf3": {
        name: "Zora Factory",
        allowedSelectors: [
          {
            selector: "0xa27a6dce",
            allowed_executors: ["EOA"],
            notes: "createCoin() via EOA for testing",
          },
        ],
      },
    },
  },
};

// Helper to create test transaction request
function createTestRequest(
  selector: string = "0xa423ada1",
  chainId: number = 8453,
  executionStrategy: ExecutionStrategy = "EOA",
  to: string = "0x777777751622c0d3258f214f9df38e35bf45baf3",
): TransactionRequest {
  return {
    id: "test-id",
    payload: {
      to,
      data:
        selector +
        "0000000000000000000000000000000000000000000000000000000000000001", // selector + dummy data
      value: "0",
    },
    chain_id: chainId,
    execution_strategy: executionStrategy,
    status: "PENDING",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe("Transaction Validation", () => {
  const currentDir = new URL(".", import.meta.url).pathname;
  const testConfigPath = resolve(currentDir, "config/allowlists.json");
  let originalConfig: string | null = null;

  beforeEach(() => {
    // Reset cache before each test
    resetAllowlistCache();

    // Backup original config if it exists
    try {
      originalConfig = readFileSync(testConfigPath, "utf8");
    } catch {
      originalConfig = null;
    }

    // Ensure config directory exists
    mkdirSync(resolve(currentDir, "config"), { recursive: true });
  });

  afterEach(() => {
    // Restore original config or clean up
    if (originalConfig) {
      writeFileSync(testConfigPath, originalConfig);
    }
    resetAllowlistCache();
  });

  describe("Legacy String Format Support", () => {
    beforeEach(() => {
      writeFileSync(
        testConfigPath,
        JSON.stringify(testAllowlistLegacy, null, 2),
      );
    });

    it("should allow EOA execution for legacy string selectors", () => {
      const request = createTestRequest("0xa423ada1", 8453, "EOA");
      const context = {
        workerChainId: 8453,
        executionStrategy: "EOA" as ExecutionStrategy,
      };

      const result = validateTransaction(request, context);

      expect(result.valid).toBe(true);
    });

    it("should allow SAFE execution for legacy string selectors", () => {
      const request = createTestRequest("0xa27a6dce", 8453, "SAFE");
      const context = {
        workerChainId: 8453,
        executionStrategy: "SAFE" as ExecutionStrategy,
      };

      const result = validateTransaction(request, context);

      expect(result.valid).toBe(true);
    });

    it("should allow both execution strategies for all legacy selectors", () => {
      const selectors = ["0xa423ada1", "0xa27a6dce", "0x14352ebc"];
      const strategies: ExecutionStrategy[] = ["EOA", "SAFE"];

      selectors.forEach((selector) => {
        strategies.forEach((strategy) => {
          const request = createTestRequest(selector, 8453, strategy);
          const context = { workerChainId: 8453, executionStrategy: strategy };

          const result = validateTransaction(request, context);

          expect(result.valid).toBe(true);
        });
      });
    });
  });

  describe("New Object Format with Execution Strategy Constraints", () => {
    beforeEach(() => {
      writeFileSync(testConfigPath, JSON.stringify(testAllowlistNew, null, 2));
    });

    it("should allow EOA for selector restricted to EOA only", () => {
      const request = createTestRequest("0x14352ebc", 8453, "EOA");
      const context = {
        workerChainId: 8453,
        executionStrategy: "EOA" as ExecutionStrategy,
      };

      const result = validateTransaction(request, context);

      expect(result.valid).toBe(true);
    });

    it("should reject SAFE for selector restricted to EOA only", () => {
      const request = createTestRequest("0x14352ebc", 8453, "SAFE");
      const context = {
        workerChainId: 8453,
        executionStrategy: "SAFE" as ExecutionStrategy,
      };

      const result = validateTransaction(request, context);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("EXECUTION_STRATEGY_VIOLATION");
      expect(result.errorMessage).toContain(
        "not allowed for execution strategy SAFE",
      );
      expect(result.errorMessage).toContain("Allowed strategies: EOA");
    });

    it("should allow SAFE for selector restricted to SAFE only", () => {
      const request = createTestRequest("0xa27a6dce", 8453, "SAFE");
      const context = {
        workerChainId: 8453,
        executionStrategy: "SAFE" as ExecutionStrategy,
      };

      const result = validateTransaction(request, context);

      expect(result.valid).toBe(true);
    });

    it("should reject EOA for selector restricted to SAFE only", () => {
      const request = createTestRequest("0xa27a6dce", 8453, "EOA");
      const context = {
        workerChainId: 8453,
        executionStrategy: "EOA" as ExecutionStrategy,
      };

      const result = validateTransaction(request, context);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("EXECUTION_STRATEGY_VIOLATION");
      expect(result.errorMessage).toContain(
        "not allowed for execution strategy EOA",
      );
      expect(result.errorMessage).toContain("Allowed strategies: SAFE");
    });

    it("should allow both strategies for mixed legacy string selectors", () => {
      const request1 = createTestRequest("0xa423ada1", 8453, "EOA");
      const context1 = {
        workerChainId: 8453,
        executionStrategy: "EOA" as ExecutionStrategy,
      };

      const request2 = createTestRequest("0xa423ada1", 8453, "SAFE");
      const context2 = {
        workerChainId: 8453,
        executionStrategy: "SAFE" as ExecutionStrategy,
      };

      const result1 = validateTransaction(request1, context1);
      const result2 = validateTransaction(request2, context2);

      expect(result1.valid).toBe(true);
      expect(result2.valid).toBe(true);
    });
  });

  describe("Acceptance Criteria Validation", () => {
    beforeEach(() => {
      writeFileSync(testConfigPath, JSON.stringify(testAllowlistNew, null, 2));
    });

    it("AC4a: should reject EOA for selector restricted to SAFE only", () => {
      const request = createTestRequest("0x095ea7b3", 8453, "EOA");
      const context = {
        workerChainId: 8453,
        executionStrategy: "EOA" as ExecutionStrategy,
      };

      const result = validateTransaction(request, context);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("EXECUTION_STRATEGY_VIOLATION");
    });

    it("AC4b: should allow both strategies for legacy string selector", () => {
      const eoaRequest = createTestRequest("0xa423ada1", 8453, "EOA");
      const eoaContext = {
        workerChainId: 8453,
        executionStrategy: "EOA" as ExecutionStrategy,
      };

      const safeRequest = createTestRequest("0xa423ada1", 8453, "SAFE");
      const safeContext = {
        workerChainId: 8453,
        executionStrategy: "SAFE" as ExecutionStrategy,
      };

      const eoaResult = validateTransaction(eoaRequest, eoaContext);
      const safeResult = validateTransaction(safeRequest, safeContext);

      expect(eoaResult.valid).toBe(true);
      expect(safeResult.valid).toBe(true);
    });
  });

  describe("Error Handling and Edge Cases", () => {
    beforeEach(() => {
      writeFileSync(testConfigPath, JSON.stringify(testAllowlistNew, null, 2));
    });

    it("should reject unsupported chain ID", () => {
      const request = createTestRequest("0xa423ada1", 999999, "EOA");
      const context = {
        workerChainId: 999999,
        executionStrategy: "EOA" as ExecutionStrategy,
      };

      const result = validateTransaction(request, context);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("CHAIN_NOT_SUPPORTED");
    });

    it("should reject chain mismatch between worker and request", () => {
      const request = createTestRequest("0xa423ada1", 8453, "EOA");
      const context = {
        workerChainId: 84532,
        executionStrategy: "EOA" as ExecutionStrategy,
      };

      const result = validateTransaction(request, context);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("CHAIN_MISMATCH");
    });

    it("should reject contract not in allowlist", () => {
      const request = createTestRequest(
        "0xa423ada1",
        8453,
        "EOA",
        "0x1234567890123456789012345678901234567890",
      );
      const context = {
        workerChainId: 8453,
        executionStrategy: "EOA" as ExecutionStrategy,
      };

      const result = validateTransaction(request, context);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("ALLOWLIST_VIOLATION");
      expect(result.errorMessage).toContain("not in allowlist");
    });

    it("should reject function selector not in allowlist", () => {
      const request = createTestRequest("0x12345678", 8453, "EOA");
      const context = {
        workerChainId: 8453,
        executionStrategy: "EOA" as ExecutionStrategy,
      };

      const result = validateTransaction(request, context);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("ALLOWLIST_VIOLATION");
      expect(result.errorMessage).toContain("not allowed for contract");
    });

    it("should reject transaction data too short for selector", () => {
      const request = createTestRequest("", 8453, "EOA");
      request.payload.data = "0x123"; // Too short
      const context = {
        workerChainId: 8453,
        executionStrategy: "EOA" as ExecutionStrategy,
      };

      const result = validateTransaction(request, context);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("INVALID_PAYLOAD");
      expect(result.errorMessage).toContain(
        "too short to contain function selector",
      );
    });

    it("should reject execution strategy mismatch", () => {
      const request = createTestRequest("0xa423ada1", 8453, "EOA");
      const context = {
        workerChainId: 8453,
        executionStrategy: "SAFE" as ExecutionStrategy,
      };

      const result = validateTransaction(request, context);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("EXECUTION_STRATEGY_MISMATCH");
    });

    it("should reject non-zero value transactions", () => {
      const request = createTestRequest("0xa423ada1", 8453, "EOA");
      request.payload.value = "1000000000000000000"; // 1 ETH
      const context = {
        workerChainId: 8453,
        executionStrategy: "EOA" as ExecutionStrategy,
      };

      const result = validateTransaction(request, context);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("INVALID_PAYLOAD");
      expect(result.errorMessage).toContain(
        "Non-zero value transactions not supported",
      );
    });
  });

  describe("Cross-Chain Validation", () => {
    beforeEach(() => {
      writeFileSync(testConfigPath, JSON.stringify(testAllowlistNew, null, 2));
    });

    it("should validate different execution strategy constraints per chain", () => {
      // Base Mainnet: 0xa27a6dce restricted to SAFE
      const mainnetRequest = createTestRequest("0xa27a6dce", 8453, "SAFE");
      const mainnetContext = {
        workerChainId: 8453,
        executionStrategy: "SAFE" as ExecutionStrategy,
      };

      // Base Sepolia: 0xa27a6dce restricted to EOA
      const sepoliaRequest = createTestRequest("0xa27a6dce", 84532, "EOA");
      const sepoliaContext = {
        workerChainId: 84532,
        executionStrategy: "EOA" as ExecutionStrategy,
      };

      const mainnetResult = validateTransaction(mainnetRequest, mainnetContext);
      const sepoliaResult = validateTransaction(sepoliaRequest, sepoliaContext);

      expect(mainnetResult.valid).toBe(true);
      expect(sepoliaResult.valid).toBe(true);
    });

    it("should reject cross-chain strategy violations", () => {
      // Base Mainnet: Try EOA for SAFE-only selector
      const mainnetRequest = createTestRequest("0xa27a6dce", 8453, "EOA");
      const mainnetContext = {
        workerChainId: 8453,
        executionStrategy: "EOA" as ExecutionStrategy,
      };

      // Base Sepolia: Try SAFE for EOA-only selector
      const sepoliaRequest = createTestRequest("0xa27a6dce", 84532, "SAFE");
      const sepoliaContext = {
        workerChainId: 84532,
        executionStrategy: "SAFE" as ExecutionStrategy,
      };

      const mainnetResult = validateTransaction(mainnetRequest, mainnetContext);
      const sepoliaResult = validateTransaction(sepoliaRequest, sepoliaContext);

      expect(mainnetResult.valid).toBe(false);
      expect(mainnetResult.errorCode).toBe("EXECUTION_STRATEGY_VIOLATION");

      expect(sepoliaResult.valid).toBe(false);
      expect(sepoliaResult.errorCode).toBe("EXECUTION_STRATEGY_VIOLATION");
    });
  });

  describe("Normalization and Case-Insensitive Handling", () => {
    beforeEach(() => {
      writeFileSync(testConfigPath, JSON.stringify(testAllowlistNew, null, 2));
    });

    it("should handle mixed-case addresses in allowlist lookup", () => {
      // Test with uppercase address
      const request = createTestRequest(
        "0xa423ada1",
        8453,
        "EOA",
        "0x777777751622C0D3258F214F9DF38E35BF45BAF3",
      );
      const context = {
        workerChainId: 8453,
        executionStrategy: "EOA" as ExecutionStrategy,
      };

      const result = validateTransaction(request, context);

      expect(result.valid).toBe(true);
    });

    it("should handle mixed-case selectors", () => {
      // Test with uppercase selector
      const request = createTestRequest("0xA423ADA1", 8453, "EOA");
      const context = {
        workerChainId: 8453,
        executionStrategy: "EOA" as ExecutionStrategy,
      };

      const result = validateTransaction(request, context);

      expect(result.valid).toBe(true);
    });

    it("should handle various zero-value formats", () => {
      const zeroFormats = ["0", "0x0", "0x00"];

      zeroFormats.forEach((zeroValue) => {
        const request = createTestRequest("0xa423ada1", 8453, "EOA");
        request.payload.value = zeroValue;
        const context = {
          workerChainId: 8453,
          executionStrategy: "EOA" as ExecutionStrategy,
        };

        const result = validateTransaction(request, context);

        expect(result.valid).toBe(true);
      });
    });

    it("should reject invalid hex data", () => {
      const request = createTestRequest("", 8453, "EOA");
      request.payload.data = "0xGGGGGGGG0000"; // Invalid hex characters
      const context = {
        workerChainId: 8453,
        executionStrategy: "EOA" as ExecutionStrategy,
      };

      const result = validateTransaction(request, context);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("INVALID_PAYLOAD");
    });

    it("should reject data without 0x prefix", () => {
      const request = createTestRequest("", 8453, "EOA");
      request.payload.data = "a423ada10000"; // Missing 0x prefix
      const context = {
        workerChainId: 8453,
        executionStrategy: "EOA" as ExecutionStrategy,
      };

      const result = validateTransaction(request, context);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("INVALID_PAYLOAD");
    });

    it("should reject invalid value format", () => {
      const request = createTestRequest("0xa423ada1", 8453, "EOA");
      request.payload.value = "invalid"; // Invalid value format
      const context = {
        workerChainId: 8453,
        executionStrategy: "EOA" as ExecutionStrategy,
      };

      const result = validateTransaction(request, context);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("INVALID_PAYLOAD");
      expect(result.errorMessage).toContain("Invalid transaction value format");
    });
  });

  describe("Schema Validation", () => {
    beforeEach(() => {
      // Clean up any existing config
      resetAllowlistCache();
    });

    it("should reject malformed allowlist configuration", () => {
      const malformedConfig = {
        "8453": {
          name: "Base Mainnet",
          contracts: {
            "invalid-address": {
              // Invalid address format
              name: "Test Contract",
              allowedSelectors: ["0xa423ada1"],
            },
          },
        },
      };

      writeFileSync(testConfigPath, JSON.stringify(malformedConfig, null, 2));

      const request = createTestRequest("0xa423ada1", 8453, "EOA");
      const context = {
        workerChainId: 8453,
        executionStrategy: "EOA" as ExecutionStrategy,
      };

      const result = validateTransaction(request, context);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("VALIDATION_ERROR");
      expect(result.errorMessage).toContain("Invalid allowlist configuration");
    });

    it("should reject invalid selector format in configuration", () => {
      const invalidSelectorConfig = {
        "8453": {
          name: "Base Mainnet",
          contracts: {
            "0x777777751622c0d3258f214f9df38e35bf45baf3": {
              name: "Test Contract",
              allowedSelectors: ["invalid-selector"], // Invalid selector format
            },
          },
        },
      };

      writeFileSync(
        testConfigPath,
        JSON.stringify(invalidSelectorConfig, null, 2),
      );

      const request = createTestRequest("0xa423ada1", 8453, "EOA");
      const context = {
        workerChainId: 8453,
        executionStrategy: "EOA" as ExecutionStrategy,
      };

      const result = validateTransaction(request, context);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("VALIDATION_ERROR");
      expect(result.errorMessage).toContain("Invalid allowlist configuration");
    });
  });

  describe("Environment Variable Configuration", () => {
    const tempConfigPath = resolve(process.cwd(), "temp-allowlist.json");

    afterEach(() => {
      // Clean up environment variable
      delete process.env.ALLOWLIST_CONFIG_PATH;
      resetAllowlistCache();

      // Clean up temp file
      try {
        require("fs").unlinkSync(tempConfigPath);
      } catch {}
    });

    it("should use environment variable path when provided", () => {
      // Create temp config file
      writeFileSync(tempConfigPath, JSON.stringify(testAllowlistNew, null, 2));

      // Set environment variable
      process.env.ALLOWLIST_CONFIG_PATH = tempConfigPath;

      const request = createTestRequest("0xa423ada1", 8453, "EOA");
      const context = {
        workerChainId: 8453,
        executionStrategy: "EOA" as ExecutionStrategy,
      };

      const result = validateTransaction(request, context);

      expect(result.valid).toBe(true);
    });

    it("should fall back to default paths when env var points to non-existent file", () => {
      // Set environment variable to non-existent file
      process.env.ALLOWLIST_CONFIG_PATH = "/non/existent/path.json";

      // Ensure default config exists
      writeFileSync(testConfigPath, JSON.stringify(testAllowlistNew, null, 2));

      const request = createTestRequest("0xa423ada1", 8453, "EOA");
      const context = {
        workerChainId: 8453,
        executionStrategy: "EOA" as ExecutionStrategy,
      };

      const result = validateTransaction(request, context);

      expect(result.valid).toBe(true);
    });
  });

  describe("Backward Compatibility", () => {
    it("should handle mixed legacy and new format in same allowlist", () => {
      const mixedConfig = {
        "8453": {
          name: "Base Mainnet",
          contracts: {
            "0x777777751622c0d3258f214f9df38e35bf45baf3": {
              name: "Zora Factory",
              allowedSelectors: [
                "0xa423ada1", // Legacy string
                {
                  selector: "0xa27a6dce",
                  allowed_executors: ["SAFE"],
                },
                "0x14352ebc", // Another legacy string
                {
                  selector: "0x095ea7b3",
                  allowed_executors: ["EOA", "SAFE"], // Explicit both
                },
              ],
            },
          },
        },
      };

      writeFileSync(testConfigPath, JSON.stringify(mixedConfig, null, 2));
      resetAllowlistCache();

      // Test legacy string allows both
      const legacyEoa = validateTransaction(
        createTestRequest("0xa423ada1", 8453, "EOA"),
        { workerChainId: 8453, executionStrategy: "EOA" },
      );
      const legacySafe = validateTransaction(
        createTestRequest("0xa423ada1", 8453, "SAFE"),
        { workerChainId: 8453, executionStrategy: "SAFE" },
      );

      // Test constrained selector
      const constrainedValid = validateTransaction(
        createTestRequest("0xa27a6dce", 8453, "SAFE"),
        { workerChainId: 8453, executionStrategy: "SAFE" },
      );
      const constrainedInvalid = validateTransaction(
        createTestRequest("0xa27a6dce", 8453, "EOA"),
        { workerChainId: 8453, executionStrategy: "EOA" },
      );

      // Test explicit both
      const explicitEoa = validateTransaction(
        createTestRequest("0x095ea7b3", 8453, "EOA"),
        { workerChainId: 8453, executionStrategy: "EOA" },
      );
      const explicitSafe = validateTransaction(
        createTestRequest("0x095ea7b3", 8453, "SAFE"),
        { workerChainId: 8453, executionStrategy: "SAFE" },
      );

      expect(legacyEoa.valid).toBe(true);
      expect(legacySafe.valid).toBe(true);
      expect(constrainedValid.valid).toBe(true);
      expect(constrainedInvalid.valid).toBe(false);
      expect(explicitEoa.valid).toBe(true);
      expect(explicitSafe.valid).toBe(true);
    });
  });
});
