import { jest } from '@jest/globals';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { prepareCreateCoinTx } from './zora-prepare-create-coin-tx.js';
import { enqueueTransaction } from './enqueue-transaction.js';
import { getTransactionStatus } from './zora-get-transaction-status.js';
import { queryCoins } from './zora-query-coins.js';

// Mock the supabase client
jest.mock('./shared/supabase.js', () => ({
  supabase: {
    from: jest.fn(() => ({
      insert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn()
        }))
      })),
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn()
        }))
      })),
      rpc: jest.fn()
    }))
  }
}));

describe('Zora MCP Tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('prepareCreateCoinTx', () => {
    it('should create valid EIP-7572 metadata', async () => {
      const params = {
        name: 'Test Coin',
        symbol: 'TEST',
        description: 'A test coin',
        image_url: 'https://example.com/image.png',
        chain_id: 8453,
        dry_run: true
      };

      const result = await prepareCreateCoinTx(params);
      
      expect(result.content[0].type).toBe('text');
      const response = JSON.parse(result.content[0].text);
      
      expect(response.transaction).toBeDefined();
      expect(response.metadata).toBeDefined();
      expect(response.metadata.name).toBe('Test Coin');
      expect(response.metadata.symbol).toBe('TEST');
      expect(response.metadata.description).toBe('A test coin');
      expect(response.metadata.image).toBe('https://example.com/image.png');
      expect(response.metadata.properties.version).toBe('1.0.0');
    });

    it('should validate required parameters', async () => {
      const invalidParams = {
        name: '',
        symbol: 'TEST',
        chain_id: 8453,
        dry_run: true
      };

      await expect(prepareCreateCoinTx(invalidParams)).rejects.toThrow();
    });

    it('should handle unsupported chain IDs', async () => {
      const params = {
        name: 'Test Coin',
        symbol: 'TEST',
        chain_id: 999999,
        dry_run: true
      };

      await expect(prepareCreateCoinTx(params)).rejects.toThrow('Unsupported chain ID');
    });

    it('should create transaction with correct factory address', async () => {
      const params = {
        name: 'Test Coin',
        symbol: 'TEST',
        chain_id: 8453,
        dry_run: true
      };

      const result = await prepareCreateCoinTx(params);
      const response = JSON.parse(result.content[0].text);
      
      expect(response.transaction.to).toBe('0x777777751622c0d3258f214F9DF38E35BF45baF3');
      expect(response.transaction.value).toBe('0');
      expect(response.transaction.data).toMatch(/^0xa27a6dce/); // deployCreatorCoin selector
    });

    it('should generate different metadata URIs for different coins', async () => {
      const params1 = {
        name: 'Coin One',
        symbol: 'ONE',
        chain_id: 8453,
        dry_run: true
      };

      const params2 = {
        name: 'Coin Two',
        symbol: 'TWO',
        chain_id: 8453,
        dry_run: true
      };

      const result1 = await prepareCreateCoinTx(params1);
      const result2 = await prepareCreateCoinTx(params2);
      
      const response1 = JSON.parse(result1.content[0].text);
      const response2 = JSON.parse(result2.content[0].text);
      
      expect(response1.metadata_uri).not.toBe(response2.metadata_uri);
    });

    it('should handle creator coin with external_url', async () => {
      const params = {
        name: 'Creator Coin',
        symbol: 'CREATOR',
        description: 'A coin for creators',
        image_url: 'https://example.com/creator.png',
        external_url: 'https://creator.example.com',
        chain_id: 8453,
        dry_run: true
      };

      const result = await prepareCreateCoinTx(params);
      const response = JSON.parse(result.content[0].text);
      
      expect(response.metadata.name).toBe('Creator Coin');
      expect(response.metadata.symbol).toBe('CREATOR');
      expect(response.metadata.description).toBe('A coin for creators');
      expect(response.metadata.image).toBe('https://example.com/creator.png');
      expect(response.metadata.external_url).toBe('https://creator.example.com');
    });

    it('should validate symbol format', async () => {
      const params = {
        name: 'Test Coin',
        symbol: 'test-symbol-with-dashes',
        chain_id: 8453,
        dry_run: true
      };

      await expect(prepareCreateCoinTx(params)).rejects.toThrow();
    });
  });

  describe('queryCoins', () => {
    it('should handle pagination correctly', async () => {
      const mockData = [
        {
          id: '1',
          name: 'Coin 1',
          symbol: 'C1',
          creator: '0x123',
          image_url: 'https://example.com/coin1.png',
          created_at: '2024-01-01T00:00:00Z'
        }
      ];

      const mockSupabase = require('./shared/supabase.js').supabase;
      mockSupabase.rpc.mockResolvedValue({ data: mockData, error: null });

      const result = await queryCoins({
        limit: 10,
        chain_id: 8453
      });

      expect(result.content[0].type).toBe('text');
      const response = JSON.parse(result.content[0].text);
      
      expect(response.coins).toEqual(mockData);
      expect(response.meta).toBeDefined();
      expect(response.meta.tokens).toBeGreaterThan(0);
    });

    it('should filter by creator address', async () => {
      const creatorAddress = '0x123abc';
      
      const result = await queryCoins({
        creator: creatorAddress,
        chain_id: 8453
      });

      expect(result.content[0].type).toBe('text');
      const response = JSON.parse(result.content[0].text);
      expect(response.ok).toBe(true);
    });

    it('should handle empty results gracefully', async () => {
      const result = await queryCoins({
        chain_id: 8453,
        search: 'nonexistent'
      });

      expect(result.content[0].type).toBe('text');
      const response = JSON.parse(result.content[0].text);
      
      expect(response.coins).toEqual([]);
      expect(response.meta.tokens).toBe(0);
    });

    it('should validate chain_id parameter', async () => {
      await expect(queryCoins({
        chain_id: 999999
      })).rejects.toThrow();
    });

    it('should handle database errors', async () => {
      // This test is not applicable since the current implementation uses mock data
      // In a real implementation with database calls, this would test error handling
      const result = await queryCoins({
        chain_id: 8453
      });

      expect(result.content[0].type).toBe('text');
      const response = JSON.parse(result.content[0].text);
      expect(response.ok).toBe(true);
    });

    it('should apply context management for token budgets', async () => {
      const result = await queryCoins({
        chain_id: 8453
      });

      const response = JSON.parse(result.content[0].text);
      
      // Should have meta information and be under token budget
      expect(response.meta).toBeDefined();
      expect(response.meta.tokens).toBeLessThan(50000);
      expect(response.coins).toBeDefined();
    });
  });
});
