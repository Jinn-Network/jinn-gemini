# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2024-12-27

### Added

- **Complete Phase 4 Implementation**: Full idempotency and real Safe deployment functionality
- **Unified On-Chain Verification**: Blockchain as single source of truth for Safe state detection
- **Smart Race Condition Handling**: Graceful handling of concurrent deployment attempts
- **Dynamic Gas Estimation**: Live RPC-based gas estimation replacing hardcoded values
- **Enhanced Error Handling**: Specific error codes for configuration mismatches and service failures
- **Safe Transaction Service Integration**: Advisory checks with on-chain confirmation
- **Comprehensive Test Suite**: Integration tests covering all idempotency scenarios

### Changed

- **BREAKING**: Removed `SafeDeploymentConfig` type export (now imported from Safe Protocol Kit)
- **BREAKING**: Updated to Safe Protocol Kit v6.1.0 with new API (`Safe.init()`)
- **Enhanced Bootstrap Flow**: Prioritizes on-chain verification over off-chain services
- **Improved Error Messages**: More specific and actionable error reporting
- **Better Deployment Verification**: Full on-chain validation before identity persistence

### Fixed

- **Critical Idempotency Issues**: Bootstrap now correctly handles pre-existing Safes
- **Gas Estimation Accuracy**: Dynamic estimation based on actual deployment transactions
- **Race Condition Safety**: Multiple concurrent bootstrap calls now handle gracefully
- **Configuration Validation**: Proper validation of Safe owner/threshold configuration
- **Service Fallbacks**: Graceful handling when Safe Transaction Service is unavailable

### Technical Improvements

- **On-Chain State Detection**: New `getOnChainSafeState()` function with three states
- **Deployment Race Handling**: Automatic detection and adoption of Safes deployed by other processes
- **Enhanced Type Safety**: Improved TypeScript types and error handling
- **Better Logging**: Comprehensive logging for debugging and monitoring
- **Performance Optimizations**: Reduced redundant API calls and improved error recovery

### Dependencies

- Updated `@safe-global/protocol-kit` to `6.1.0`
- Added `@safe-global/types-kit` for type compatibility
- Added `@safe-global/safe-core-sdk-types` for legacy compatibility

## [1.0.0] - 2024-12-26

### Added

- Initial implementation with Phase 1-3 functionality
- Basic Safe wallet bootstrapping and identity management
- File-based storage with atomic operations and concurrency control
- Support for Base mainnet and Base Sepolia networks
- Comprehensive security measures for private key handling
- Type-safe implementation with strict TypeScript compliance

### Features

- Deterministic Safe address generation
- Local identity persistence with secure file permissions
- File-based locking for concurrent operation safety
- Configuration validation and chain support verification
- Basic gas estimation and funding requirement calculation
