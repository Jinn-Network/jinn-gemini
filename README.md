# Gemini CLI Jinn

A sophisticated worker system that integrates with Gemini CLI to process jobs through a Model Context Protocol (MCP) server, providing comprehensive telemetry and job management capabilities.

## Overview

This project consists of several key components:

- **Worker System**: A Node.js worker that polls for jobs and executes them
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

- Node.js (v18 or higher)
- Yarn
- A Supabase project
- Gemini CLI installed and authenticated
- An existing EOA (Externally Owned Account) with a private key. The worker uses this EOA to deploy and control its on-chain identity (Gnosis Safe). The system does **not** create an EOA for you.

### Setup

1. **Clone and setup**:
   ```bash
   git clone <repository-url>
   cd gemini_cli_jinn
   ./scripts/setup.sh
   ```

2. **Configure environment**:
   ```bash
   cp .env.template .env
   # Edit .env with your configuration (see Configuration section below)
   ```

3. **Authenticate with Gemini**:
   ```bash
   gemini auth login
   ```

4. **Build all packages**:
   ```bash
   yarn build:all
   ```

5. **Start development**:
   ```bash
   yarn dev:all
   ```

For detailed setup instructions, see [SETUP.md](SETUP.md).

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