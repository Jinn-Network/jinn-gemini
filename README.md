# Gemini CLI Jinn

A sophisticated worker system that integrates with Gemini CLI to process jobs through a Model Context Protocol (MCP) server, providing comprehensive telemetry and job management capabilities.

## Overview

This project consists of several key components:

- **Worker System**: A Node.js worker that polls for jobs and executes them
- **OLAS Integration**: Automated service lifecycle management and staking via olas-operate-middleware
- **MCP Server**: A Model Context Protocol server that provides tools for database operations
- **Frontend Explorer**: A Next.js web interface for exploring data and job reports
- **Telemetry Collection**: OpenTelemetry integration for monitoring and observability
- **Job Management**: Database-driven job queue with comprehensive reporting

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Job Board     │    │     Worker      │    │   MCP Server    │
│   (Database)    │◄──►│   (Node.js)     │◄──►│   (Metacog)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Job Reports    │    │  OpenTelemetry  │    │   Supabase      │
│  (Database)     │    │   Collector     │    │   Database      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │
         │
         ▼
┌─────────────────┐
│  Frontend       │
│  Explorer       │
│  (Next.js)      │
└─────────────────┘
```

## Features

- **Job Processing**: Automated job execution with status tracking
- **Database Integration**: Full CRUD operations through MCP tools
- **Frontend Interface**: Web-based data explorer and job monitoring
- **Telemetry**: Comprehensive monitoring and observability
- **Security**: Sensitive file protection and pre-commit hooks
- **Development Tools**: Hot reloading and development scripts

## Quick Start

### Prerequisites

**System Requirements**:
- Node.js v18+ (v20+ recommended)
- Python **3.11.0-3.11.6** (⚠️ NOT 3.12+, middleware incompatible)
- Poetry 1.5+ ([installation](https://python-poetry.org/docs/#installation))
- Yarn 1.22+ or later
- Git with submodule support

**Required Services**:
- Base RPC endpoint (e.g., [Base mainnet](https://mainnet.base.org) or testnet)
- (Optional) Supabase project for Control API
- (Optional) Gemini API key for AI-powered job execution

**Required Accounts**:
- An EOA (Externally Owned Account) with private key for OLAS service operations
- Funded wallet for gas (Base ETH) and service staking (OLAS tokens)

### Setup

#### 1. Clone and Install

```bash
git clone <repository-url>
cd jinn-cli-agents
yarn setup:dev  # Initializes submodules, installs Node.js + Python dependencies
```

#### 2. Configure Environment

```bash
cp .env.template .env
```

**Edit `.env` with the following REQUIRED variables**:

```bash
# === Core Worker Configuration ===
WORKER_PRIVATE_KEY=0x...           # Your EOA private key
CHAIN_ID=8453                       # 8453 = Base mainnet, 84532 = Base Sepolia
RPC_URL=https://mainnet.base.org    # Base RPC endpoint

# === Ponder (On-chain Event Indexer) ===
PONDER_RPC_URL=https://mainnet.base.org
MECH_MARKETPLACE_ADDRESS_BASE=0x...  # MechMarketplace contract address

# === Control API (GraphQL Gateway) ===
CONTROL_API_URL=http://localhost:4001/graphql  # ⚠️ Must include /graphql path
SUPABASE_URL=https://<project>.supabase.co     # (Optional if using Supabase)
SUPABASE_SERVICE_ROLE_KEY=...                  # (Optional if using Supabase)

# === OLAS Middleware (Service Deployment) ===
OPERATE_PASSWORD=<password>         # Encrypts wallet keystore
OLAS_STAKING_CONTRACT_ADDRESS_BASE=0x...
OLAS_AGENT_REGISTRY_ADDRESS_BASE=0x...
OLAS_SERVICE_REGISTRY_ADDRESS_BASE=0x...

# === IPFS Configuration ===
IPFS_GATEWAY_URL=https://gateway.autonolas.tech/ipfs/
IPFS_FETCH_TIMEOUT_MS=30000

# === AI Model API Keys (Optional) ===
GEMINI_API_KEY=...
OPENAI_API_KEY=...
```

**See [Configuration](#configuration) section below for detailed descriptions.**

#### 3. Create and Deploy Service

**Before running the worker, you MUST create and deploy an OLAS service**:

```bash
tsx scripts/interactive-service-setup.ts
```

This will:
- Create a master wallet and Safe
- Generate agent keys
- Deploy a service Safe on-chain
- Register your mech in the marketplace
- Store service configuration in `olas-operate-middleware/.operate/`

**⚠️ CRITICAL**: The `.operate/` directory contains your keys and wallets. It is automatically git-ignored. Back up this directory to `~/Documents/olas-service-backups` or similar.

#### 4. Build Packages

```bash
yarn build:all  # Builds worker, mech-client-ts, and all packages
```

#### 5. Start Development Stack

```bash
# Start Ponder (indexer), Control API, and Mech Worker
yarn dev:stack
```

This starts:
- **Ponder** (http://localhost:42069) - Indexes MechMarketplace events
- **Control API** (http://localhost:4001/graphql) - GraphQL write gateway
- **Mech Worker** (continuous mode) - Polls for jobs and delivers results

#### 6. Submit a Test Job

In a **separate terminal**:

```bash
yarn post:job
```

This submits a test request to the on-chain MechMarketplace. The worker will:
1. Detect the new request via Ponder
2. Claim it via Control API
3. Execute the prompt
4. Deliver the result via Safe transaction

**Verify the full loop** by checking worker logs for:
```
[WORKER] Found 1 unclaimed requests
[WORKER] Claimed request <id>
[WORKER] Executing job...
[WORKER] Result delivered successfully
```

### Testing with Tenderly Virtual TestNet (Optional)

For cost-free testing without using real funds, you can use Tenderly's Virtual TestNet:

```bash
# Copy the Tenderly configuration template
cp env.tenderly.template env.tenderly

# Edit env.tenderly with your Tenderly credentials
# Get credentials from: https://dashboard.tenderly.co/account/authorization
```

**Key benefits**:
- Unlimited ETH (no real funds needed)
- Instant transaction confirmation
- Fork of Base mainnet with all contracts
- Full transaction debugging in Tenderly dashboard

**To use Tenderly instead of mainnet**:
```bash
# Load Tenderly config instead of .env
source env.tenderly
yarn dev:stack
```

See `env.tenderly.template` for detailed configuration instructions.

### Common Setup Issues

| Issue | Solution |
|-------|----------|
| `Python.h not found` | Install Python 3.11 (not 3.12+) and development headers |
| `ModuleNotFoundError: operate` | Run `yarn setup:dev` to install middleware dependencies |
| `No service configuration found` | Run `tsx scripts/interactive-service-setup.ts` first |
| `HTTP 404` from Control API | Ensure `CONTROL_API_URL` includes `/graphql` path |
| `IPFS fetch timeout` | Increase `IPFS_FETCH_TIMEOUT_MS` or use faster gateway |
| `Safe Transaction Service rate limit` | Use testnet, or wait 1-2 minutes between requests |

For comprehensive troubleshooting, see [OLAS_ARCHITECTURE_GUIDE.md](OLAS_ARCHITECTURE_GUIDE.md).

## Project Structure

```
gemini_cli_jinn/
├── docs/                    # Documentation
├── frontend/               # Frontend explorer application
│   └── explorer/          # Next.js data explorer
├── gemini-agent/           # Gemini CLI agent configuration
├── migrations/             # Database migration scripts
├── packages/
│   └── metacog-mcp/       # MCP server package
├── scripts/               # Setup and utility scripts
├── worker/                # Main worker implementation
└── package.json          # Project dependencies
```

## Development

### Available Scripts

#### Build Commands
```bash
# Build root worker only
yarn build

# Build all packages (worker + MCP + frontend)
yarn build:all

# Clean build artifacts
yarn clean
```

#### Development Commands
```bash
# Start worker only
yarn dev

# Start frontend only
yarn frontend:dev

# Start both worker and frontend (recommended for development)
yarn dev:all
```

#### Production Commands
```bash
# Start worker only
yarn start

# Start frontend only
yarn frontend:start

# Start both worker and frontend
yarn start:all
```

#### Frontend Commands
```bash
# Build frontend for production
yarn frontend:build

# Start frontend development server
yarn frontend:dev

# Start frontend production server
yarn frontend:start
```

### Running Services Locally

```bash
# Start both worker and frontend (recommended)
yarn dev:all

# Or start services individually:
yarn dev                    # Worker only
yarn frontend:dev          # Frontend only

# Start the MCP server (if needed separately)
yarn workspace @jinn/metacog-mcp start
```

### Accessing the Application

- **Frontend Explorer**: http://localhost:3000
- **Worker**: Running in background, processing jobs from database
- **MCP Server**: Available to worker for tool access

## Configuration

### Environment Variables

To run the Jinn worker and its associated services, you'll need to configure several environment variables. Copy the `.env.template` file to `.env` and populate it with your credentials.

#### Required for Core Functionality

-   `WORKER_PRIVATE_KEY`: The private key of an Externally Owned Account (EOA). This is used to deterministically provision and control the agent's on-chain identity (a Gnosis Safe).
-   `CHAIN_ID`: The chain ID of the target blockchain (e.g., `8453` for Base mainnet).
-   `RPC_URL`: The URL of an RPC endpoint for the specified `CHAIN_ID`.
-   `SUPABASE_URL`: Your Supabase project URL.
-   `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key.
-   `GEMINI_API_KEY`: Your API key for the Gemini API.
-   `OPENAI_API_KEY`: Your API key for the OpenAI API.
-   `SNYK_TOKEN`: Your Snyk token for security scanning (get from [https://app.snyk.io/account](https://app.snyk.io/account)).

#### Required for OLAS Service Staking

-   `OPERATE_PASSWORD`: Password for the olas-operate-middleware (used for unattended operations).
-   `OLAS_STAKING_CONTRACT_ADDRESS_BASE`: The address of the OLAS staking contract on Base.
-   `OLAS_AGENT_REGISTRY_ADDRESS_BASE`: The address of the OLAS Agent Registry on Base.
-   `OLAS_SERVICE_REGISTRY_ADDRESS_BASE`: The address of the OLAS Service Registry on Base.
-   `MECH_MARKETPLACE_ADDRESS_BASE`: The address of the MechMarketplace contract on Base (required for mech deployment).

#### Required for E2E Testing

Running the end-to-end test suite requires additional variables to interact with Tenderly, which is used to create ephemeral test environments.

-   `TENDERLY_ACCESS_KEY`: Your Tenderly access key.
-   `TENDERLY_ACCOUNT_SLUG`: Your Tenderly account slug (the name of your organization).
-   `TENDERLY_PROJECT_SLUG`: The slug of your project within Tenderly.
-   `TEST_RPC_URL`: (Optional) An RPC URL to use specifically for testing, overriding the main `RPC_URL`.
-   `DISABLE_STS_CHECKS`: (Optional) Set to `true` to bypass Safe Transaction Service checks, which is often necessary in test environments.

### Gemini Configuration

The system uses Gemini CLI for job execution. Configuration is stored in `.gemini/settings.json` and includes:

- MCP server configuration
- Tool permissions
- Authentication settings

## Security

This project implements comprehensive security measures to protect against vulnerabilities and ensure safe development practices.

### Automated Security Scanning

The project uses **Snyk** for continuous security monitoring:

#### Security Scripts
```bash
# Run security scan (integrated into build process)
yarn security:check

# Set up continuous monitoring
yarn security:monitor

# Interactive vulnerability fixing
yarn security:fix

# Build with security check (automatic)
yarn build
```

#### CI/CD Integration
- **Automated scanning** on every push and pull request
- **Daily security scans** at 2 AM UTC
- **GitHub Code Scanning** integration for vulnerability tracking
- **High/Critical severity threshold** blocking builds

#### Setup Requirements
1. Copy `.env.template` to `.env`
2. Add your `SNYK_TOKEN` from [https://app.snyk.io/account](https://app.snyk.io/account)
3. For GitHub integration, add `SNYK_TOKEN` as a repository secret

### Security Features

- **Dependency Vulnerability Scanning**: Automated detection of known vulnerabilities
- **Sensitive File Protection**: `.env` and `.gemini/settings.json` are git-ignored
- **Pre-commit Hooks**: Automatic checks for sensitive data before commits
- **Template Files**: Example configurations without real credentials
- **Comprehensive .gitignore**: Prevents accidental commits of sensitive files
- **Regular Updates**: Automated dependency updates and security patches

### Current Security Status
✅ **No critical vulnerabilities detected**  
✅ **All dependencies scanned and secure**  
✅ **Continuous monitoring active**

## Database Schema

The system uses two main tables:

- `job_board`: Stores job definitions and status
- `job_reports`: Stores execution results and telemetry

See [docs/DATABASE_MAP.md](docs/DATABASE_MAP.md) for detailed schema information.

## API Reference

### MCP Tools

The Metacog MCP server provides the following tools:

- `get_schema`: Retrieve database schema information
- `get_context_snapshot`: Get current context snapshot
- `read_records`: Read records from database tables
- `create_record`: Create new records
- `update_records`: Update existing records
- `delete_records`: Delete records
- `list_tools`: List available tools

### Job Types

Supported job types include:

- Database operations
- File processing
- API integrations
- Custom workflows

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and ensure security checks pass
5. Submit a pull request

### Development Guidelines

- Never commit sensitive files
- Use template files for configuration examples
- Update documentation for new features
- Follow the existing code style
- Add tests for new functionality

## Troubleshooting

### Common Issues

1. **Environment variables not loading**:
   - Check `.env` file exists and has correct format
   - Verify variable names match code expectations

2. **Database connection errors**:
   - Verify Supabase credentials
   - Check IP allowlist in Supabase dashboard

3. **Gemini authentication issues**:
   - Re-authenticate: `gemini auth login`
   - Check `.gemini` directory permissions

### Getting Help

- Check the logs in the `logs/` directory
- Review the documentation in the `docs/` folder
- Check Supabase dashboard for database issues
- Verify all environment variables are set correctly

## License

[Add your license information here]

## Support

For support and questions:

- Check the documentation in the `docs/` folder
- Review the setup guide in [SETUP.md](SETUP.md)
- Open an issue for bugs or feature requests 