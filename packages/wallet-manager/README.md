# Jinn Wallet Manager

A production-ready TypeScript library for Gnosis Safe wallet bootstrapping and identity management for autonomous agents in the Olas ecosystem.

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/example/jinn-cli-agents)
[![Version](https://img.shields.io/badge/version-2.0.0-blue)](https://github.com/example/jinn-cli-agents)
[![License](https://img.shields.io/badge/license-MIT-green)](https://opensource.org/licenses/MIT)

## Overview

The Jinn Wallet Manager provides a secure, deterministic, and idempotent way to provision 1-of-1 Gnosis Safe wallets for worker agents. Each agent gets a unique smart contract wallet controlled by a single EOA, enabling participation in the Olas Marketplace, Staking, and Governance protocols.

## Key Features

- **Production Ready**: Fully implemented with comprehensive testing and hardening.
- **Deterministic Wallet Creation**: Generates the same Safe address for a given EOA and chain ID.
- **Idempotent Bootstrap Process**: Safe for concurrent execution with file-based locking.
- **Comprehensive Pre-flight Checks**: Validates funding, chain compatibility, and configuration.
- **Secure Identity Storage**: Persists only public data with atomic write operations.
- **Robust Error Recovery**: Handles common failure scenarios with clear, typed error codes.
- **Type-Safe API**: Fully typed with JSDoc for a great developer experience.

## Installation

```bash
yarn add @jinn/wallet-manager
```

## Quick Start

```typescript
import { WalletManager } from '@jinn/wallet-manager';

async function initializeWorkerWallet() {
  const walletManager = new WalletManager({
    workerPrivateKey: process.env.WORKER_PRIVATE_KEY as `0x${string}`,
    chainId: 8453, // Base mainnet
    rpcUrl: 'https://mainnet.base.org'
  });

  const result = await walletManager.bootstrap();

  switch (result.status) {
    case 'exists':
      console.log('✅ Safe already exists:', result.identity.safeAddress);
      break;
    case 'created':
      console.log('🚀 New Safe deployed:', result.identity.safeAddress);
      console.log('Tx hash:', result.metrics.txHash);
      console.log('Gas used:', result.metrics.gasUsed);
      break;
    case 'needs_funding':
      console.warn(`💰 Please fund address: ${result.address}`);
      console.warn(`Required amount (wei): ${result.required.minRecommendedWei}`);
      // Application should implement logic to wait for funding and retry
      break;
    case 'failed':
      console.error('❌ Bootstrap failed:', result.error);
      if (result.code) {
        console.error('Error code:', result.code);
      }
      break;
  }
}

initializeWorkerWallet();
```

## Configuration

The `WalletManager` is initialized with a configuration object.

### `WalletManagerConfig`

| Property | Type | Description |
|----------|------|-------------|
| `workerPrivateKey` | `0x${string}` | **Required**. Private key of the EOA that will own the Safe. |
| `chainId` | `number` | **Required**. Chain ID where the Safe should be deployed. |
| `rpcUrl` | `string` | **Required**. RPC URL for blockchain interaction. |
| `options.storageBasePath` | `string?` | Optional. Override default storage path (`~/.jinn/wallets`). |
| `options.txServiceUrl` | `string?` | Optional. Override Safe Transaction Service URL for the given chain. |

### Supported Networks

| Network | Chain ID | Status |
|---------|----------|--------|
| Base Mainnet | 8453 | ✅ Supported |
| Base Sepolia | 84532 | ✅ Supported |

## Bootstrap Process

The wallet bootstrap follows a comprehensive "find-or-create" process:

1. **Local Identity Check**: Looks for existing wallet identity file.
2. **On-chain Verification**: Validates existing Safe configuration (if found).
3. **Deterministic Generation**: Creates salt nonce from EOA + chain ID.
4. **Pre-existence Check**: Queries Safe Transaction Service for existing deployments.
5. **Funding Validation**: Checks if EOA has sufficient funds for deployment.
6. **Safe Deployment**: Deploys a new 1-of-1 Gnosis Safe (if needed).
7. **Identity Persistence**: Saves wallet details to secure local storage.

### Bootstrap Results

The `bootstrap()` method returns a discriminated union type for safe and easy handling of all possible outcomes.

#### Success Cases

- **`exists`**: Safe already deployed and properly configured.
- **`created`**: New Safe successfully deployed on-chain.

#### Action Required

- **`needs_funding`**: EOA requires funding before deployment can proceed.

#### Error Cases

- **`failed`**: Bootstrap failed with detailed error information and a typed error code.

## Identity Storage

Wallet identities are stored locally in JSON files with a secure and deterministic structure.

```json
{
  "ownerAddress": "0x...",
  "safeAddress": "0x...", 
  "chainId": 8453,
  "createdAt": "2025-08-25T12:34:56Z",
  "saltNonce": "0x..."
}
```

**Security Notes:**
- **No Private Keys**: Only public information is ever stored on disk.
- **Secure Permissions**: Files are created with `0600` (owner read/write) and directories with `0700` (owner access only).
- **Atomic Operations**: Atomic write operations prevent file corruption.
- **Concurrency Safe**: File-based locking prevents race conditions in multi-process environments.

## Implementation Status: ✅ Production Ready

The library has completed all planned development phases and is considered stable and production-ready.

- **Phase 1: Scaffolding**: ✅ Complete
- **Phase 2: Storage Layer**: ✅ Complete
- **Phase 3: Core Logic**: ✅ Complete
- **Phase 4: Idempotency & Verification**: ✅ Complete
- **Phase 5: Finalization & API**: ✅ Complete

## Error Handling

The library provides standardized `BootstrapError` codes for programmatic handling:

| Error Code | Description |
|------------|-------------|
| `unfunded` | EOA has insufficient funds for deployment. |
| `unsupported_chain` | The configured `chainId` is not supported. |
| `safe_config_mismatch`| An existing Safe was found but has the wrong configuration. |
| `tx_service_unavailable`| The Safe Transaction Service API is down or unreachable. |
| `rpc_error` | The RPC endpoint returned an error or is unreachable. |
| `deployment_failed` | The Safe deployment transaction failed on-chain. |

## Development

### Building

```bash
yarn build
```

### Testing

```bash
yarn test
```

### Type Checking

```bash
yarn type-check
```

## Security Considerations

- **Private Key Management**: The library never persists private keys to disk. The consuming application is responsible for securely managing the key.
- **File Permissions**: Identity files and directories use restrictive permissions.
- **Atomic Operations**: Storage operations use atomic writes to prevent corruption.
- **Concurrency Control**: File-based locking prevents race conditions.
- **Input Validation**: All configuration parameters are validated at construction.
- **Safe Verification**: On-chain validation of Safe configuration before adoption.

## Contributing

This library is part of the Jinn project for autonomous AI agents. For contributing guidelines and development setup, see the main project repository.

## License

MIT