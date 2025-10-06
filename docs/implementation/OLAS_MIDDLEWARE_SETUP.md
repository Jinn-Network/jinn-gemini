# OLAS Operate Middleware Setup Guide

## Overview

This guide provides setup instructions for the OLAS Operate Middleware, which is integrated as a Git submodule in the `olas-operate-middleware/` directory.

## Prerequisites

- Python 3.9, 3.10, or 3.11 (3.12+ not supported)
- Poetry package manager
- Git (for submodule management)

## Quick Setup

### 1. Initialize Git Submodule

```bash
git submodule update --init --recursive
```

### 2. Install Poetry (if not already installed)

```bash
curl -sSL https://install.python-poetry.org | python3 -
```

### 3. Install Dependencies

```bash
cd olas-operate-middleware
poetry install
```

### 4. Verify Installation

```bash
poetry run python -m operate.cli --help
```

## Environment Configuration

The middleware uses these environment variables:

- `BASE_RPC`: Base network RPC URL (default: https://mainnet.base.org)
- `CUSTOM_CHAIN_ID`: Custom chain ID if needed

## Integration with OlasOperateWrapper

The TypeScript wrapper handles:
- Python process spawning and management
- Command argument passing and validation
- Error handling and timeout management
- JSON output parsing

### Usage Example

```typescript
import { OlasOperateWrapper } from './OlasOperateWrapper.js';

const wrapper = new OlasOperateWrapper();

// Validate environment before use
const validation = await wrapper.validateEnvironment();
if (!validation.isValid) {
  console.error('Setup issues:', validation.issues);
  return;
}

// Execute commands
const result = await wrapper.executeServiceCommand('create', ['--service-id', '123']);
```

## Troubleshooting

### Common Issues

1. **"No module named 'aea'"**
   ```bash
   cd olas-operate-middleware && poetry install
   ```

2. **Python version conflicts**
   ```bash
   python3 --version  # Should be 3.9-3.11
   poetry env info
   ```

3. **CLI timeout errors**
   - Check network connectivity
   - Verify RPC endpoints are accessible

### Development Mode

```bash
cd olas-operate-middleware
poetry shell
python -m operate.cli --version
```

## Testing

Run the integration tests to verify setup:

```bash
npx vitest run worker/OlasOperateWrapper.test.ts
```

All 13 tests should pass, with proper error detection for missing dependencies.
