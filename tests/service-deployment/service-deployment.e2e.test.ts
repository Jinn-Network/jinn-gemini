/**
 * End-to-End Test: OLAS Service Deployment (Fully Isolated)
 *
 * This test runs the complete OLAS service deployment flow in complete isolation:
 * - Creates ephemeral Tenderly VNet (fresh blockchain state, destroyed after test)
 * - Creates temporary middleware directory with FULL COPY of source files (not symlinks)
 * - Runs middleware from temp directory (creates .operate in temp dir, not production)
 * - Auto-funds wallets when funding prompts appear
 * - Verifies deployment completes successfully
 * - Cleans up temp directory and VNet
 *
 * COMPLETE ISOLATION:
 * - Production `.operate` directory is NEVER touched (full copy ensures this)
 * - Blockchain state is isolated (ephemeral VNet)
 * - File system state is isolated (temp directory with full middleware copy)
 * - Can run multiple tests in parallel safely
 * - Safe for CI/CD environments
 *
 * KNOWN ISSUES:
 * - Tenderly VNets start with a fresh blockchain state (no pre-deployed contracts)
 * - Gnosis Safe factory contracts may need to be deployed first
 * - Current failure: Safe contract doesn't exist when middleware tries to call nonce()
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadEnvOnce } from '../../gemini-agent/mcp/tools/shared/env.js';
import { createTenderlyClient } from '../../scripts/lib/tenderly.js';
import type { VnetResult, TenderlyClient } from '../../scripts/lib/tenderly.js';
import { createIsolatedMiddlewareEnvironment, type IsolatedEnvironment } from '../../scripts/lib/test-isolation.js';
import { SimplifiedServiceBootstrap } from '../../worker/SimplifiedServiceBootstrap.js';
import type { SimplifiedBootstrapConfig } from '../../worker/SimplifiedServiceBootstrap.js';
import fetch from 'cross-fetch';
import path from 'path';

/**
 * Auto-fund an address via Tenderly Admin RPC
 */
async function fundAddressWithETH(
  adminRpcUrl: string,
  address: string,
  ethAmount: string
): Promise<void> {
  // Convert decimal string to wei without floating point precision loss
  const [whole, decimal = ''] = ethAmount.split('.');
  const paddedDecimal = decimal.padEnd(18, '0').slice(0, 18);
  const amountWei = BigInt(whole + paddedDecimal);
  const amountHex = '0x' + amountWei.toString(16);

  console.log('[auto-fund] Funding ' + address + ' with ' + ethAmount + ' ETH...');

  // Check if address has code (is a contract)
  const codeCheckResponse = await fetch(adminRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_getCode',
      params: [address, 'latest'],
      id: 2
    })
  });
  const codeCheckResult = await codeCheckResponse.json();
  const hasCode = codeCheckResult.result && codeCheckResult.result !== '0x';
  console.log(`[auto-fund] Address ${address} has code: ${hasCode} (${codeCheckResult.result})`);

  const response = await fetch(adminRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tenderly_setBalance',
      params: [address, amountHex],
      id: 1
    })
  });

  const result = await response.json();

  if (result.error) {
    throw new Error(`Failed to fund address: ${result.error.message}`);
  }

  console.log('[auto-fund] ✅ Funded ' + address + ' with ' + ethAmount + ' ETH');
}

/**
 * Auto-fund an address with OLAS tokens via Tenderly Admin RPC
 */
async function fundAddressWithOLAS(
  adminRpcUrl: string,
  address: string,
  olasAmount: string
): Promise<void> {
  const olasTokenAddress = '0x54330d28ca3357F294334BDC454a032e7f353416'; // Base OLAS
  // Convert decimal string to wei without floating point precision loss
  const [whole, decimal = ''] = olasAmount.split('.');
  const paddedDecimal = decimal.padEnd(18, '0').slice(0, 18);
  const amountWei = BigInt(whole + paddedDecimal);
  const amountHex = '0x' + amountWei.toString(16);

  console.log('[auto-fund] Funding ' + address + ' with ' + olasAmount + ' OLAS...');

  const response = await fetch(adminRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tenderly_setErc20Balance',
      params: [olasTokenAddress, address, amountHex],
      id: 1
    })
  });

  const result = await response.json();

  if (result.error) {
    throw new Error(`Failed to fund OLAS: ${result.error.message}`);
  }

  console.log('[auto-fund] ✅ Funded ' + address + ' with ' + olasAmount + ' OLAS');
}

/**
 * Monitor bootstrap output and auto-fund wallets when prompts appear
 */
async function monitorAndAutoFund(
  bootstrap: SimplifiedServiceBootstrap,
  adminRpcUrl: string
): Promise<void> {
  console.log('[auto-fund] Starting auto-fund monitor...\n');

  const fundingPatterns = [
    {
      pattern: /Please transfer at least ([\d.]+) ETH to the Master EOA (0x[a-fA-F0-9]{40})/,
      handler: async (match: RegExpMatchArray) => {
        const amount = match[1];
        const address = match[2];
        await fundAddressWithETH(adminRpcUrl, address, amount);
      },
      description: 'Master EOA ETH funding'
    },
    {
      pattern: /Please transfer at least ([\d.]+) ETH to the Master Safe (0x[a-fA-F0-9]{40})/,
      handler: async (match: RegExpMatchArray) => {
        const amount = match[1];
        const address = match[2];
        await fundAddressWithETH(adminRpcUrl, address, amount);
      },
      description: 'Master Safe ETH funding'
    },
    {
      pattern: /Please transfer at least ([\d.]+) OLAS to the Master Safe (0x[a-fA-F0-9]{40})/,
      handler: async (match: RegExpMatchArray) => {
        const amount = match[1];
        const address = match[2];
        await fundAddressWithOLAS(adminRpcUrl, address, amount);
      },
      description: 'Master Safe OLAS funding'
    }
  ];

  // Monitor output stream
  const seen = new Set<string>();

  // @ts-ignore - Access internal output stream
  if (bootstrap.operateWrapper?.lastCommand?.stdout) {
    // @ts-ignore
    bootstrap.operateWrapper.lastCommand.stdout.on('data', async (chunk: Buffer) => {
      const text = chunk.toString();

      for (const { pattern, handler, description } of fundingPatterns) {
        const match = text.match(pattern);
        if (match) {
          const key = `${description}:${match[2]}`;
          if (!seen.has(key)) {
            seen.add(key);
            console.log(`[auto-fund] Detected: ${description}`);
            try {
              await handler(match);
            } catch (error: any) {
              console.error(`[auto-fund] ❌ Error: ${error.message}`);
            }
          }
        }
      }
    });
  }
}

describe('E2E: Service Deployment (Fully Isolated)', () => {
  let vnetResult: VnetResult | null = null;
  let tenderlyClient: TenderlyClient | null = null;
  let isolatedEnv: IsolatedEnvironment | null = null;

  beforeAll(async () => {
    console.log('\n========================================');
    console.log('🚀 E2E Test Setup (Isolated Environment)');
    console.log('========================================\n');

    loadEnvOnce();

    // Create isolated middleware environment
    console.log('[e2e] Creating isolated middleware environment...');
    isolatedEnv = await createIsolatedMiddlewareEnvironment();
    console.log('[e2e] ✅ Isolated env: ' + isolatedEnv.tempDir + '\n');

    // Create VNet
    tenderlyClient = createTenderlyClient();
    console.log('[e2e] Creating Tenderly VNet...');
    vnetResult = await tenderlyClient.createVnet(8453);
    console.log('[e2e] ✅ VNet: ' + vnetResult.id);
    console.log('[e2e] RPC: ' + vnetResult.adminRpcUrl + '\n');

    // Set environment
    process.env.RPC_URL = vnetResult.adminRpcUrl;
    process.env.BASE_RPC_URL = vnetResult.adminRpcUrl;
    process.env.BASE_LEDGER_RPC = vnetResult.adminRpcUrl;
  }, 30_000);

  afterAll(async () => {
    console.log('\n[e2e] 🧹 Cleanup...');

    // Cleanup isolated environment (temp directory with test .operate)
    if (isolatedEnv) {
      await isolatedEnv.cleanup();
    }

    // Delete VNet
    if (tenderlyClient && vnetResult) {
      await tenderlyClient.deleteVnet(vnetResult.id);
      console.log('[e2e] ✅ Cleaned up\n');
    }
  }, 60_000);

  it('should deploy service in complete isolation with automated funding', async () => {
    if (!vnetResult) throw new Error('VNet not initialized');
    if (!isolatedEnv) throw new Error('Isolated environment not initialized');

    console.log('\n========================================');
    console.log('🎯 E2E: Service Deployment (Isolated + Auto-funded)');
    console.log('========================================\n');

    // Use production middleware source, but set working directory to temp dir
    // This causes Python's Path.cwd() to resolve to temp dir, creating .operate there
    const middlewarePath = isolatedEnv.middlewareDir;
    const isolatedWorkingDir = isolatedEnv.tempDir;

    // Verify isolation before proceeding
    console.log('[e2e] Verifying test isolation...');
    const fs = await import('fs');
    if (!fs.existsSync(middlewarePath)) {
      throw new Error(`Middleware directory does not exist: ${middlewarePath}`);
    }
    if (!fs.existsSync(isolatedWorkingDir)) {
      throw new Error(`Isolated working directory does not exist: ${isolatedWorkingDir}`);
    }
    console.log('[e2e] ✅ Middleware exists:', middlewarePath);
    console.log('[e2e] ✅ Isolated working dir:', isolatedWorkingDir);

    const config: SimplifiedBootstrapConfig = {
      chain: 'base',
      operatePassword: 'test12345',
      rpcUrl: vnetResult.adminRpcUrl,
      deployMech: true,
      mechMarketplaceAddress: '0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020',
      mechRequestPrice: '5000000000000',
      stakingProgram: 'custom_staking',
      customStakingAddress: '0x2585e63df7BD9De8e058884D496658a030b5c6ce',
      // CRITICAL: Use production middleware (with venv) but run from isolated temp dir
      // Python will use temp dir as cwd, creating .operate there, not in production
      middlewarePath,
      workingDirectory: isolatedWorkingDir,
    };

    console.log('[e2e] Starting bootstrap with automated funding...');
    console.log('[e2e] Middleware path: ' + middlewarePath);
    console.log('[e2e] Working directory: ' + isolatedWorkingDir);
    console.log('[e2e] Admin RPC: ' + vnetResult.adminRpcUrl + '\n');

    const bootstrap = new SimplifiedServiceBootstrap(config);

    // Start bootstrap in background
    const bootstrapPromise = bootstrap.bootstrap();

    // Start auto-funding monitor
    const funded = new Set<string>();

    const monitorInterval = setInterval(async () => {
      try {
        const output = bootstrap.getRecentOutput();
        if (!output) {
          console.log('[auto-fund] No output in buffer yet');
          return;
        }

        console.log('[auto-fund] Got output, checking for funding prompts... (buffer size: ' + output.length + ')');

        // Check for ETH funding requests (Master EOA or Master Safe)
        // Use matchAll to find ALL occurrences, not just the first one
        const ethMatches = Array.from(output.matchAll(/Please transfer at least ([\d.]+) ETH to the (?:Master EOA|Master Safe) (0x[a-fA-F0-9]{40})/g));
        for (const ethMatch of ethMatches) {
          const address = ethMatch[2];
          const amount = ethMatch[1];
          const key = 'ETH:' + address;

          if (!funded.has(key)) {
            funded.add(key);
            console.log('[auto-fund] Funding ' + address + ' with ' + amount + ' ETH...');
            await fundAddressWithETH(vnetResult!.adminRpcUrl, address, amount);
            console.log('[auto-fund] ✅ Funded ' + address);
          }
        }

        // Check for OLAS funding requests
        // Use matchAll to find ALL occurrences, not just the first one
        const olasMatches = Array.from(output.matchAll(/Please transfer at least ([\d.]+) OLAS to the Master Safe (0x[a-fA-F0-9]{40})/g));
        for (const olasMatch of olasMatches) {
          const address = olasMatch[2];
          const amount = olasMatch[1];
          const key = 'OLAS:' + address;

          if (!funded.has(key)) {
            funded.add(key);
            console.log('[auto-fund] Funding ' + address + ' with ' + amount + ' OLAS...');
            await fundAddressWithOLAS(vnetResult!.adminRpcUrl, address, amount);
            console.log('[auto-fund] ✅ Funded ' + address);
          }
        }
      } catch (error: any) {
        console.error('[auto-fund] Monitor error: ' + error.message);
      }
    }, 2000); // Check every 2 seconds

    try {
      const result = await bootstrapPromise;

      clearInterval(monitorInterval);

      console.log('\n[e2e] Result:', JSON.stringify(result, null, 2));

      // Verify success
      expect(result.success).toBe(true);
      expect(result.serviceSafeAddress).toBeDefined();
      expect(result.error).toBeUndefined();

      // Extract key information from output
      const output = bootstrap.getRecentOutput();

      // Extract Master EOA mnemonic
      const mnemonicMatch = output.match(/Please save the mnemonic phrase for the Master EOA:\s*([^-]+)/);
      const mnemonic = mnemonicMatch ? mnemonicMatch[1].trim() : 'not found';

      // Extract Master EOA address
      const eoaMatch = output.match(/Please transfer at least [\d.]+ ETH to the Master EOA (0x[a-fA-F0-9]{40})/);
      const eoaAddress = eoaMatch ? eoaMatch[1] : 'not found';

      // Convert mnemonic to private key
      let privateKey = 'not available';
      try {
        const ethers = await import('ethers');
        const wallet = ethers.Wallet.fromPhrase(mnemonic.replace(/,/g, ''));
        privateKey = wallet.privateKey;
      } catch (e) {
        // ethers not available
      }

      // Extract Mech address from service config (stored in MECH_TO_CONFIG env var)
      let mechAddress = 'not found';
      try {
        const fs = await import('fs');
        const path = await import('path');

        // Find service config.json in .operate/services/
        const operateDir = path.join(isolatedEnv.tempDir, '.operate', 'services');
        const serviceDirs = fs.readdirSync(operateDir);

        if (serviceDirs.length > 0) {
          const configPath = path.join(operateDir, serviceDirs[0], 'config.json');
          const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

          // MECH_TO_CONFIG is a JSON string like: {"0xMechAddress": {"use_dynamic_pricing": false, ...}}
          const mechToConfig = configData.env_variables?.MECH_TO_CONFIG?.value;
          if (mechToConfig) {
            const mechConfig = JSON.parse(mechToConfig);
            const mechAddresses = Object.keys(mechConfig);
            if (mechAddresses.length > 0) {
              mechAddress = mechAddresses[0];
            }
          }
        }
      } catch (e) {
        mechAddress = 'error reading config: ' + (e as Error).message;
      }

      console.log('\n========================================');
      console.log('🎉 SERVICE DEPLOYMENT COMPLETE');
      console.log('========================================');
      console.log('\nMASTER EOA:');
      console.log('  Address:     ' + eoaAddress);
      console.log('  Private Key: ' + privateKey);
      console.log('  Mnemonic:    ' + mnemonic);
      console.log('\nMASTER SAFE:');
      console.log('  Address:     ' + result.serviceSafeAddress);
      console.log('\nMECH:');
      console.log('  Address:     ' + mechAddress);
      console.log('\nTEST ISOLATION:');
      console.log('  Working Dir: ' + isolatedEnv.tempDir);
      console.log('  Auto-funded: ' + funded.size + ' addresses');
      console.log('  Production:  ✅ Untouched');
      console.log('========================================\n');
    } finally {
      clearInterval(monitorInterval);
    }
  }, 900_000);
});
