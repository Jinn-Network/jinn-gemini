# GitHub MCP Server Integration

This document explains how the official GitHub MCP server is integrated into the Jinn agent system.

## Overview

Instead of custom GitHub tool implementations, we use the **official GitHub MCP server** maintained by GitHub: https://github.com/github/github-mcp-server

The server runs in a Docker container and provides comprehensive GitHub API access through standardized MCP tools.

## Architecture

```
┌─────────────────────┐
│  Gemini Agent       │
│  (gemini-agent/)    │
└──────────┬──────────┘
           │
           ├─────────────────────┐
           │                     │
           ▼                     ▼
┌──────────────────┐  ┌─────────────────────┐
│  Metacog MCP     │  │  GitHub MCP Server  │
│  (Custom Tools)  │  │  (Docker Container) │
│  - dispatch_job  │  │  - get_file_contents│
│  - create_artifact│  │  - search_code      │
│  - finalize_job  │  │  - list_commits     │
│  - etc.          │  │  - etc.             │
└──────────────────┘  └─────────────────────┘
```

## Available GitHub Tools

The GitHub MCP server provides these tools (among others):

### File Operations
- `get_file_contents` - Read file or directory contents
- `create_or_update_file` - Create/update single files
- `push_files` - Push multiple files in single commit

### Search
- `search_code` - Search code across repositories
- `search_repositories` - Find repositories
- `search_issues` - Find issues and PRs

### Repository Management
- `list_commits` - View commit history
- `create_repository` - Create new repositories
- `get_issue` - Get issue details
- `create_issue` - Create new issues
- `fork_repository` - Fork repositories

For full list, see: https://github.com/github/github-mcp-server#tools

## Configuration

### Settings Templates

The GitHub MCP server is configured in the settings templates:

**`gemini-agent/settings.template.dev.json`** (Development):
```json
{
  "mcpServers": {
    "metacog": { ... },
    "github": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN"],
      "image": "ghcr.io/github/github-mcp-server",
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

**`gemini-agent/settings.template.json`** (Production):
Same configuration, used when building for production.

### Environment Variables

Add to `.env`:
```bash
# GitHub Personal Access Token for MCP server
GITHUB_TOKEN=ghp_your_token_here
```

**Required Scopes:**
- `repo` - Full repository access (for private repos)
- OR `public_repo` - Public repository access only

Get token from: https://github.com/settings/tokens/new

## Docker Setup

### Prerequisites

1. Install Docker: https://www.docker.com/get-started
2. Ensure Docker is running
3. The `ghcr.io/github/github-mcp-server` image is public (no authentication needed)

### Verification

Test that Docker can pull and run the image:

```bash
# Pull the image
docker pull ghcr.io/github/github-mcp-server

# Test run (will start server in interactive mode)
export GITHUB_PERSONAL_ACCESS_TOKEN=ghp_your_token_here
docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server
```

Press Ctrl+C to exit the test.

## Usage in Job Definitions

When posting jobs that need GitHub access, include GitHub tools in `enabledTools`:

```typescript
await dispatchNewJob({
  objective: 'Analyze repository code',
  context: `
    Repository: gcdco/jinn-cli-agents
    Use GitHub tools to read files and search code.
  `,
  enabledTools: [
    'get_file_contents',  // Read files
    'search_code',        // Search patterns
    'list_commits',       // View history
  ],
  // ...
});
```

### Tool Selection

The agent system automatically:
1. Reads the `enabledTools` list from the job
2. Generates `settings.json` with only those tools included
3. Starts both `metacog` and `github` MCP servers
4. Agent can use any tool from either server

## Spec Verification Job

The `scripts/post-spec-verification-job.ts` uses GitHub tools:

```typescript
enabledTools: [
  'web_fetch',           // Read published spec
  'google_web_search',   // Search docs
  'get_file_contents',   // Read repo files
  'search_code',         // Find code patterns
  'list_commits',        // Track changes
]
```

The agent can:
- Read spec from `jinn.network/code-spec`
- Read any file from `gcdco/jinn-cli-agents` repo
- Search for code patterns
- View recent commits to understand changes

## Troubleshooting

### Docker not running
```
Error: Cannot connect to Docker daemon
```
**Fix:** Start Docker Desktop

### Token expired/invalid
```
Error: 401 Unauthorized
```
**Fix:** Generate new token at https://github.com/settings/tokens/new

### Image pull failed
```
Error: manifest unknown
```
**Fix:** Ensure Docker is not logged into ghcr.io with expired credentials:
```bash
docker logout ghcr.io
docker pull ghcr.io/github/github-mcp-server
```

### Agent can't find GitHub tools
**Check:**
1. Tool names match official names (see [GitHub MCP Server docs](https://github.com/github/github-mcp-server))
2. `settings.json` was regenerated (happens automatically on job claim)
3. Docker is running

## References

- **Official GitHub MCP Server**: https://github.com/github/github-mcp-server
- **Docker Image**: `ghcr.io/github/github-mcp-server`
- **MCP Protocol**: https://modelcontextprotocol.io/
- **GitHub PAT Scopes**: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens

## Migration from Custom Implementation

Previously, we had custom GitHub tool wrappers in `gemini-agent/mcp/tools/github.ts`. These have been removed in favor of the official server because:

1. **Maintained by GitHub**: Official support and updates
2. **Comprehensive**: 20+ tools vs our 3 custom ones
3. **Standardized**: Follows MCP conventions
4. **Reliable**: Used by VS Code, Cursor, Claude, etc.

Old tool names → New tool names:
- `github_list_files` → `get_file_contents` (with directory path)
- `github_read_file` → `get_file_contents` (with file path)
- `github_search_code` → `search_code`


