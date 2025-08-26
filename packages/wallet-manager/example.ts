/**
 * Example usage of the Jinn Wallet Manager
 * 
 * This example demonstrates how to use the wallet manager library
 * to bootstrap a Gnosis Safe wallet for an autonomous agent.
 */

import { WalletManager } from './src/index.js';
import type { BootstrapResult } from './src/types.js';

// Example configuration - in production, use environment variables
const exampleConfig = {
  workerPrivateKey: '0x' + '1'.repeat(64) as `0x${string}`, // Replace with actual private key
  chainId: 84532, // Base Sepolia testnet
  rpcUrl: 'https://sepolia.base.org',
  options: {
    storageBasePath: './example-wallets' // Custom storage path for demo
  }
};

async function demonstrateWalletBootstrap() {
  console.log('🚀 Jinn Wallet Manager - Bootstrap Example\n');
  
  try {
    // Initialize the wallet manager
    const walletManager = new WalletManager(exampleConfig);
    
    console.log('📋 Configuration:');
    console.log(`   Chain ID: ${walletManager.getChainId()}`);
    console.log(`   RPC URL: ${walletManager.getRpcUrl()}`);
    console.log('');
    
    // Attempt to bootstrap the wallet
    console.log('🔄 Starting wallet bootstrap process...\n');
    const result: BootstrapResult = await walletManager.bootstrap();
    
    // Handle different result types
    switch (result.status) {
      case 'exists':
        console.log('✅ Safe wallet already exists!');
        console.log(`   Safe Address: ${result.identity.safeAddress}`);
        console.log(`   Owner Address: ${result.identity.ownerAddress}`);
        console.log(`   Created: ${new Date(result.identity.createdAt).toLocaleString()}`);
        if (result.metrics?.durationMs) {
          console.log(`   Verification Time: ${result.metrics.durationMs}ms`);
        }
        break;
        
      case 'created':
        console.log('🎉 New Safe wallet created successfully!');
        console.log(`   Safe Address: ${result.identity.safeAddress}`);
        console.log(`   Owner Address: ${result.identity.ownerAddress}`);
        console.log(`   Transaction Hash: ${result.metrics.txHash}`);
        console.log(`   Gas Used: ${result.metrics.gasUsed}`);
        console.log(`   Total Time: ${result.metrics.durationMs}ms`);
        break;
        
      case 'needs_funding':
        console.log('💰 Wallet needs funding before deployment');
        console.log(`   Address to fund: ${result.address}`);
        console.log(`   Required amount: ${result.required.minRecommendedWei} wei`);
        console.log(`   Gas limit: ${result.required.gasLimit}`);
        console.log(`   Max fee per gas: ${result.required.maxFeePerGas} wei`);
        console.log('');
        console.log('💡 Fund the address above and run the bootstrap again.');
        
        // Example of how to monitor funding and retry
        console.log('\n🔍 You can monitor funding status and retry like this:');
        console.log(`
async function waitForFundingAndRetry() {
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http('${exampleConfig.rpcUrl}')
  });
  
  console.log('Waiting for funding...');
  while (true) {
    const balance = await publicClient.getBalance({ address: '${result.address}' });
    if (balance >= ${result.required.minRecommendedWei}n) {
      console.log('Funding detected! Retrying bootstrap...');
      const retryResult = await walletManager.bootstrap();
      // Handle retry result...
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
  }
}`);
        break;
        
      case 'failed':
        console.log('❌ Bootstrap failed');
        console.log(`   Error: ${result.error}`);
        if (result.code) {
          console.log(`   Error Code: ${result.code}`);
        }
        
        // Provide suggestions based on error code
        switch (result.code) {
          case 'unsupported_chain':
            console.log('💡 Try using a supported chain ID (8453 for Base, 84532 for Base Sepolia)');
            break;
          case 'rpc_error':
            console.log('💡 Check your RPC URL and network connectivity');
            break;
          case 'unfunded':
            console.log('💡 Fund your EOA with sufficient ETH for gas fees');
            break;
          default:
            console.log('💡 Check the error message above for details');
        }
        break;
    }
    
  } catch (error: any) {
    console.log('💥 Unexpected error during bootstrap:');
    console.log(`   ${error.message}`);
    
    if (error.message.includes('workerPrivateKey')) {
      console.log('💡 Make sure to provide a valid 64-character hex private key with 0x prefix');
    }
  }
  
  console.log('\n📚 For more information, see the README.md file');
}

// Run the example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateWalletBootstrap().catch(console.error);
}

export { demonstrateWalletBootstrap };
