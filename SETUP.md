# Setup Guide for Gemini CLI Jinn

This guide will help you set up and initialize this repository while ensuring sensitive files are properly protected.

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn

- A Supabase project
- Gemini CLI installed and authenticated

## Initial Setup

### 1. Clone and Install Dependencies

```bash
# Clone the repository
git clone <repository-url>
cd gemini_cli_jinn

# Install dependencies
npm install
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
npm run build

# Build the MCP package
cd packages/metacog-mcp
npm run build
cd ../..
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
   npm run test:db
   ```

## Development Setup

### Running Locally

1. **Start the worker**:
   ```bash
   npm run dev
   ```

2. **Start the MCP server**:
   ```bash
   cd packages/metacog-mcp
   npm run start
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