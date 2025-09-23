import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SafeExecutor } from "./SafeExecutor.js";

// Mock dependencies
vi.mock("./config.js", () => ({
  getWorkerConfig: vi.fn(() => ({
    WORKER_PRIVATE_KEY: "0x" + "1".repeat(64),
    CHAIN_ID: 8453,
    RPC_URL: "https://mainnet.base.org",
    SAFE_ADDRESS: "0x" + "2".repeat(40),
    WORKER_ID: "test-worker",
    WORKER_TX_CONFIRMATIONS: 3,
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-key",
  })),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn((url = "https://test.supabase.co", key = "test-key") => ({
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(),
          })),
        })),
      })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
    })),
  })),
}));

// Mock Safe SDK
vi.mock("@safe-global/protocol-kit", () => ({
  default: {
    create: vi.fn(),
  },
}));

vi.mock("ethers", () => ({
  ethers: {
    JsonRpcProvider: vi.fn().mockImplementation(() => ({
      getNetwork: vi.fn().mockResolvedValue({ chainId: 8453 }),
      getCode: vi.fn().mockResolvedValue("0x"),
      call: vi.fn(),
    })),
    Wallet: vi.fn().mockImplementation(() => ({
      address: "0x" + "3".repeat(40),
      connect: vi.fn().mockReturnThis(),
    })),
    Contract: vi.fn(),
    formatEther: vi.fn(),
    parseEther: vi.fn(),
  },
  JsonRpcProvider: vi.fn().mockImplementation(() => ({
    getNetwork: vi.fn().mockResolvedValue({ chainId: 8453 }),
    getCode: vi.fn().mockResolvedValue("0x"),
    call: vi.fn(),
  })),
  Wallet: vi.fn().mockImplementation(() => ({
    address: "0x" + "3".repeat(40),
    connect: vi.fn().mockReturnThis(),
  })),
}));

// Mock file system operations
vi.mock("fs", () => ({
  readFileSync: vi.fn(() =>
    JSON.stringify({
      chainId: 8453,
      ownerAddress: "0x" + "3".repeat(40),
      safeAddress: "0x" + "2".repeat(40),
    }),
  ),
  existsSync: vi.fn(() => true),
}));

// Mock path operations
vi.mock("path", () => ({
  resolve: vi.fn(),
  join: vi.fn(() => "/mock/path/wallet.json"),
}));

// Mock os operations
vi.mock("os", () => ({
  homedir: vi.fn(() => "/mock/home"),
}));

describe("SafeExecutor", () => {
  let executor: SafeExecutor;
  let mockSupabaseClient: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up environment variables
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    process.env.WORKER_ID = "test-worker";
    process.env.CHAIN_ID = "8453";
    process.env.WORKER_TX_CONFIRMATIONS = "3";
    process.env.RPC_URL = "https://mainnet.base.org";
    process.env.WORKER_PRIVATE_KEY = "0x" + "1".repeat(64);

    executor = new SafeExecutor();
    mockSupabaseClient = require("@supabase/supabase-js").createClient("https://test.supabase.co", "test-key");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Payload Validation", () => {
    it("should validate required payload fields", () => {
      const invalidPayload = { to: "0x123" }; // missing data and value

      expect(() => executor.validatePayload(invalidPayload)).toThrow(
        "Invalid payload",
      );
    });

    it("should validate address format", () => {
      const invalidPayload = {
        to: "invalid-address",
        data: "0x1234",
        value: "0",
      };

      expect(() => executor.validatePayload(invalidPayload)).toThrow(
        "Invalid address format",
      );
    });

    it("should validate data hex format", () => {
      const invalidPayload = {
        to: "0x" + "1".repeat(40),
        data: "not-hex",
        value: "0",
      };

      expect(() => executor.validatePayload(invalidPayload)).toThrow(
        "Invalid data format",
      );
    });

    it("should accept valid payload", () => {
      const validPayload = {
        to: "0x777777751622c0d3258f214F9DF38E35BF45baF3",
        data: "0xa27a6dce" + "0".repeat(56),
        value: "0",
      };

      expect(() => executor.validatePayload(validPayload)).not.toThrow();
    });

    it("should reject non-zero value transactions", () => {
      const payloadWithValue = {
        to: "0x777777751622c0d3258f214F9DF38E35BF45baF3",
        data: "0xa27a6dce" + "0".repeat(56),
        value: "1000000000000000000", // 1 ETH
      };

      expect(() => executor.validatePayload(payloadWithValue)).toThrow(
        "Non-zero value transactions not allowed",
      );
    });
  });

  describe("Allowlist Enforcement", () => {
    it("should reject contracts not in allowlist", () => {
      const payload = {
        to: "0x" + "9".repeat(40), // Not in allowlist
        data: "0xa27a6dce" + "0".repeat(56),
        value: "0",
      };

      expect(() => executor.validateAllowlist(payload, 8453)).toThrow(
        "Contract not in allowlist",
      );
    });

    it("should reject function selectors not in allowlist", () => {
      const payload = {
        to: "0x777777751622c0d3258f214F9DF38E35BF45baF3",
        data: "0x12345678" + "0".repeat(56), // Invalid selector
        value: "0",
      };

      expect(() => executor.validateAllowlist(payload, 8453)).toThrow(
        "Function selector not allowed",
      );
    });

    it("should accept valid contract and selector combination", () => {
      const payload = {
        to: "0x777777751622c0d3258f214F9DF38E35BF45baF3",
        data: "0xa27a6dce" + "0".repeat(56), // deployCreatorCoin
        value: "0",
      };

      expect(() => executor.validateAllowlist(payload, 8453)).not.toThrow();
    });

    it("should handle chain mismatch", () => {
      const payload = {
        to: "0x777777751622c0d3258f214F9DF38E35BF45baF3",
        data: "0xa27a6dce" + "0".repeat(56),
        value: "0",
      };

      expect(() => executor.validateAllowlist(payload, 1)).toThrow(
        "Chain not supported",
      );
    });
  });

  describe("Idempotency", () => {
    it("should generate consistent hash for same payload", () => {
      const payload = {
        to: "0x777777751622c0d3258f214F9DF38E35BF45baF3",
        data: "0xa27a6dce" + "0".repeat(56),
        value: "0",
      };

      const hash1 = executor.calculatePayloadHash(payload);
      const hash2 = executor.calculatePayloadHash(payload);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // 64 character hex string
    });

    it("should generate different hashes for different payloads", () => {
      const payload1 = {
        to: "0x777777751622c0d3258f214F9DF38E35BF45baF3",
        data: "0xa27a6dce" + "0".repeat(56),
        value: "0",
      };

      const payload2 = {
        to: "0x777777751622c0d3258f214F9DF38E35BF45baF3",
        data: "0xa423ada1" + "0".repeat(56), // Different function
        value: "0",
      };

      const hash1 = executor.calculatePayloadHash(payload1);
      const hash2 = executor.calculatePayloadHash(payload2);

      expect(hash1).not.toBe(hash2);
    });

    it("should handle payload canonicalization", () => {
      const payload1 = { to: "0xAAA", data: "0xBBB", value: "0" };
      const payload2 = { value: "0", data: "0xBBB", to: "0xAAA" }; // Different order

      const hash1 = executor.calculatePayloadHash(payload1);
      const hash2 = executor.calculatePayloadHash(payload2);

      expect(hash1).toBe(hash2); // Should be same due to canonicalization
    });

    it("should handle database constraint violation for duplicate hash", async () => {
      const payload = {
        to: "0x777777751622c0d3258f214F9DF38E35BF45baF3",
        data: "0xa27a6dce" + "0".repeat(56),
        value: "0",
      };

      // Mock database error for duplicate hash
      mockSupabaseClient
        .from()
        .update()
        .eq()
        .eq()
        .single.mockResolvedValue({
          data: null,
          error: {
            code: "23505",
            message: "duplicate key value violates unique constraint",
          },
        });

      const result = await executor.executeTransaction("test-request-id");

      expect(result.status).toBe("FAILED");
      expect(result.errorCode).toBe("INVALID_PAYLOAD");
      expect(result.errorMessage).toContain("duplicate");
    });
  });

  describe("Error Code Consistency", () => {
    const errorCodeTests = [
      {
        name: "ALLOWLIST_VIOLATION for invalid contract",
        setup: () => {
          // Mock a request with invalid contract
          mockSupabaseClient
            .from()
            .select()
            .eq()
            .single.mockResolvedValue({
              data: {
                payload: {
                  to: "0x" + "9".repeat(40),
                  data: "0xa27a6dce" + "0".repeat(56),
                  value: "0",
                },
                chain_id: 8453,
              },
              error: null,
            });
        },
        expectedErrorCode: "ALLOWLIST_VIOLATION",
      },
      {
        name: "CHAIN_MISMATCH for wrong chain",
        setup: () => {
          mockSupabaseClient
            .from()
            .select()
            .eq()
            .single.mockResolvedValue({
              data: {
                payload: {
                  to: "0x777777751622c0d3258f214F9DF38E35BF45baF3",
                  data: "0xa27a6dce" + "0".repeat(56),
                  value: "0",
                },
                chain_id: 1, // Ethereum mainnet, not Base
              },
              error: null,
            });
        },
        expectedErrorCode: "CHAIN_MISMATCH",
      },
    ];

    errorCodeTests.forEach(({ name, setup, expectedErrorCode }) => {
      it(`should return ${expectedErrorCode} for ${name}`, async () => {
        setup();

        const result = await executor.executeTransaction("test-request-id");

        expect(result.status).toBe("FAILED");
        expect(result.errorCode).toBe(expectedErrorCode);
      });
    });
  });
});
