# Setup Guide for Gemini CLI Jinn

This guide will help you set up and initialize this repository while ensuring sensitive files are properly protected.

## Prerequisites

- Node.js (v18 or higher)
- Yarn

- A Supabase project
- Gemini CLI installed and authenticated

## Initial Setup

### 1. Clone and Install Dependencies

```bash
# Clone the repository
git clone <repository-url>
cd gemini_cli_jinn

# Install dependencies
yarn install
```

### 2. Environment Configuration

**IMPORTANT**: Never commit sensitive files to version control!

1. **Copy the environment template**:
   ```bash
   cp env.template .env
   ```

2. **Edit the `.env` file** with your actual values:
   ```bash
   # Required: Supabase Configuration
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
   
   # Optional: Additional configuration as needed
   NODE_ENV=development
   OTEL_LOG_LEVEL=error
   ```

3. **Verify `.env` is in `.gitignore`** (it should be already):
   ```bash
   grep -n "\.env" .gitignore
   ```

### 3. Gemini CLI Configuration

1. **Authenticate with Gemini CLI** on your host machine:
   ```bash
   gemini auth login
   ```

2. **Create Gemini settings** (if not already present):
   ```bash
   cp gemini-agent/settings.template.json .gemini/settings.json
   ```

3. **Edit `.gemini/settings.json`** to match your setup:
   ```json
   {
     "mcpServers": {
       "metacog": {
         "command": "node",
         "args": [
           "packages/metacog-mcp/dist/server.js"
         ],
         "trust": true
       }
     }
   }
   ```

### 4. Build the Project

```bash
# Build the main project
yarn build

# Build the MCP package
yarn workspace @jinn/metacog-mcp build
```

### 5. Database Setup

1. **Create your Supabase project** at [supabase.com](https://supabase.com)

2. **Run the database migrations**:
   ```bash
   # Apply migrations to your Supabase database
   # You'll need to run these SQL commands in your Supabase SQL editor
   cat migrations/create_job_reports_table.sql
   ```

3. **Verify database connection**:
   ```bash
   # Test the connection (you may need to create a test script)
yarn test:db
   ```

## Development Setup

### Running Locally

1. **Start the worker**:
   ```bash
   yarn dev
   ```

2. **Start the MCP server**:
   ```bash
   yarn workspace @jinn/metacog-mcp start
   ```



## Security Checklist

Before committing any changes, ensure:

- [ ] `.env` file is not tracked by git
- [ ] `.gemini/settings.json` is not tracked by git
- [ ] No API keys or secrets are in committed files
- [ ] No database credentials are exposed
- [ ] No personal information is in logs or configs

## Verification Commands

```bash
# Check what files are tracked by git
git status

# Check if sensitive files are ignored
git check-ignore .env
git check-ignore .gemini/settings.json

# List all files that would be committed
git ls-files

# Check for any potential secrets in tracked files
git grep -i "api_key\|password\|secret\|token" -- ':!*.md' ':!*.template'
```

## Troubleshooting

### Common Issues

1. **Environment variables not loading**:
   - Ensure `.env` file exists in the correct location
   - Check file permissions
   - Verify variable names match code expectations

2. **Database connection errors**:
   - Verify Supabase URL and key are correct
   - Check if your IP is allowed in Supabase dashboard
   - Ensure database is running and accessible

3. **Gemini CLI authentication issues**:
   - Re-authenticate: `gemini auth login`
   - Check `.gemini` directory permissions
   - Verify settings.json configuration

### Getting Help

- Check the logs in the `logs/` directory
- Review the documentation in the `docs/` folder
- Check Supabase dashboard for database issues
- Verify all environment variables are set correctly

## Next Steps

After setup, you can:

1. **Run tests**: `npm test`
2. **Start development**: `npm run dev`
3. **Start development**: `npm run dev`
4. **Explore the documentation**: Check the `docs/` folder

## Contributing

When contributing to this project:

1. Never commit sensitive files
2. Use template files for configuration examples
3. Update this setup guide if you add new configuration requirements
4. Test your changes thoroughly before submitting 

## On-chain Quickstart

### Prerequisites
- Base RPC reachable from your host
- Environment configured:
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
  - `MECH_PRIVATE_KEY` (preferred) or key file, and any Safe/mech settings used by your runtime

### 1) Start Ponder (Mech Marketplace indexer)
```bash
cd ponder && yarn dev
```
GraphQL will be live at `http://localhost:42069/graphql` once synced.

### 2) Run the on-chain mech worker
```bash
# From repository root
yarn dev:mech
```
This polls Ponder for new Requests, claims atomically, executes, stores reports/artifacts, and delivers on-chain via Safe.

### 3) Post a marketplace job (MCP)
Use your MCP client to call the tool `post_marketplace_job`:
```json
{
  "prompt": "Phase 2/3 quickstart test: echo this string.",
  "priorityMech": "0xab15f8d064b59447bd8e9e89dd3fa770abf5eeb7",
  "tools": ["manage_artifact"],
  "chainConfig": "base"
}
```
This creates an on-chain Request and returns the transaction hash and request IDs.

### 4) Verify via GraphQL (Ponder)
- Requests:
```bash
curl -s -X POST http://localhost:42069/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"query { requests { items { id mech sender blockTimestamp transactionHash } } }"}' | jq
```
- Deliveries:
```bash
curl -s -X POST http://localhost:42069/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"query { deliverys { items { id requestId mech blockTimestamp transactionHash } } }"}' | jq
```

If the worker is running, you should see:
- A new Request indexed by Ponder
- A Deliver event after the worker posts results on-chain 