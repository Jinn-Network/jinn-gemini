# Blog Growth Product

Autonomous blog management with content creation, analytics, and infrastructure provisioning.

## Overview

The Blog Growth product enables users to launch and grow autonomous blogs. The system handles:
- Infrastructure provisioning (GitHub repo, Railway deployment, Umami analytics)
- Content creation and publishing via MCP tools
- Analytics tracking and performance insights
- Multi-agent orchestration for content, distribution, and site management

## File Map

```
blueprints/
├── blog-growth-template.json       # Main template with invariants
└── blog-growth-orchestrator.json   # Orchestration variant

gemini-agent/mcp/tools/
├── blog-analytics.ts               # Umami analytics (stats, top pages, referrers)
└── blog-publish.ts                 # Blog post CRUD operations

services/x402-gateway/provisioning/
├── index.ts                        # Orchestrator - detects $provision, runs pipeline
├── github.ts                       # Creates repo from jinn-blog template
├── railway.ts                      # Creates Railway service with domain
├── umami.ts                        # Creates Umami analytics website
└── customers.ts                    # Customer registry I/O (data/customers.json)

scripts/product/
├── provision-blog.ts               # Manual provisioning script
└── lib/
    ├── github.ts                   # GitHub API helpers
    ├── railway.ts                  # Railway GraphQL helpers
    ├── umami.ts                    # Umami REST helpers
    └── x402.ts                     # Gateway API helpers

scripts/templates/
└── seed-blog-growth-template.ts    # Seeds template into ponder database

frontend/explorer/src/components/
├── template-execution-form.tsx     # Dynamic form for template execution
└── templates-catalog.tsx           # Template listing with execution dialog
```

## Architecture

### $provision Sentinel

Templates can define fields with `"default": "$provision"` in their inputSchema. When users execute a template without providing values for these fields, the gateway automatically provisions the resources.

**Provisioning Pipeline** (order matters due to dependencies):
1. **GitHub** → Creates repo from `Jinn-Network/jinn-blog` template
2. **Railway** → Creates service linked to repo, generates domain
3. **Umami** → Creates analytics website for the domain

### MCP Tools

**blog-publish.ts**
- `blog_create_post` - Create MDX blog post with frontmatter
- `blog_list_posts` - List existing posts
- `blog_get_post` - Get post content
- `blog_delete_post` - Delete a post

**blog-analytics.ts**
- `blog_get_stats` - Overall website statistics
- `blog_get_top_pages` - Top performing pages by views
- `blog_get_referrers` - Traffic sources
- `blog_get_metrics` - Metrics by type (browser, device, country, etc.)
- `blog_get_pageviews` - Time series data
- `blog_get_performance_summary` - Combined summary for AI analysis

### Blueprint envVar Mapping

Templates can map input fields to environment variables using the `envVar` property in `inputSchema`:

```json
"umamiWebsiteId": {
  "type": "string",
  "description": "Umami analytics website ID",
  "default": "$provision",
  "envVar": "UMAMI_WEBSITE_ID"
}
```

When a user provides `umamiWebsiteId` (or it's auto-provisioned), `launch_workstream.ts` automatically:
1. Extracts the value
2. Maps it to `UMAMI_WEBSITE_ID`
3. Passes via `additionalContextOverrides.env` to the job

This allows analytics tools in child jobs to access the website ID without manual configuration. Child jobs inherit these env vars via `JINN_INHERITED_ENV`.

### Template Invariants

The blog-growth-template defines goals that agents work toward:
- **GOAL-CONTENT** - Produce high-quality content
- **GOAL-DISTRIBUTION** - Distribute content across channels
- **GOAL-ANALYTICS** - Track and analyze performance
- **GOAL-GROWTH** - Grow audience over time
- **GOAL-SITE** - Brand and customize the blog
- **DELEGATE-001** - CEO delegates to managers
- **REVIEW-001** - Gate content via branch review
- **CYCLE-001** - End-of-cycle retrospective

## User Flows

### 1. Template Execution (via Explorer UI)

```
User provides:                  System provisions:              Result:
─────────────────────────────   ────────────────────────────   ──────────────────────
blogName: "Acme Blog"           → GitHub repo created          Full blog setup
blogTopic: "AI"                 → Railway deployed             Workstream launched
targetAudience: "developers"    → Umami configured             Customer record saved
```

1. User opens Explorer → Templates
2. Clicks on "Blog Growth Template"
3. Fills required fields (blogName, blogTopic, targetAudience)
4. Leaves $provision fields blank
5. Clicks Execute
6. Gateway provisions infrastructure, starts workstream

### 2. Manual Provisioning (via script)

```bash
yarn tsx scripts/product/provision-blog.ts \
  --name "My Blog" \
  --topic "AI and Machine Learning" \
  --audience "developers"
```

## Environment Variables

### Gateway Provisioning (services/x402-gateway)

Required for `$provision` to auto-create blog infrastructure:

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub PAT for repo creation |
| `RAILWAY_API_TOKEN` | Railway API token |
| `BLOG_RAILWAY_PROJECT_ID` | Railway project ID (NOT `RAILWAY_PROJECT_ID` - Railway overrides that) |
| `UMAMI_HOST` | Umami server URL (e.g., `https://analytics.jinn.network`) |
| `UMAMI_USERNAME` | Umami login username |
| `UMAMI_PASSWORD` | Umami login password |

### Provisioned Blog Service (Railway)

These are **automatically set** on the Railway blog service during provisioning:

| Variable | Source | Purpose |
|----------|--------|---------|
| `NEXT_PUBLIC_UMAMI_ID` | `provisioned.umami.websiteId` | Website ID for client-side tracking |
| `NEXT_PUBLIC_UMAMI_SRC` | `https://${UMAMI_HOST}/script.js` | Umami script URL for client-side |

### Analytics Tools (MCP)

Required for blog analytics tools (`blog_get_stats`, `blog_get_top_pages`, etc.):

| Variable | Source |
|----------|--------|
| `UMAMI_HOST` | From `.env` |
| `UMAMI_USERNAME` | From `.env` |
| `UMAMI_PASSWORD` | From `.env` |
| `UMAMI_WEBSITE_ID` | From template input via `envVar` mapping (NOT from `.env`) |

**Note:** Publishing tools (`blog_create_post`, etc.) only require `CODE_METADATA_REPO_ROOT`.

### Local Development

Same variables in `.env` file at repo root. See `.env.template` for the full list.

## Customer Registry

Provisioned customers are stored in `data/customers.json`:
```json
{
  "acme-blog": {
    "displayName": "Acme Blog",
    "repo": "Jinn-Network/blog-acme-blog",
    "sshUrl": "git@github.com:Jinn-Network/blog-acme-blog.git",
    "railwayServiceId": "...",
    "domain": "blog-acme-blog-production.up.railway.app",
    "umamiWebsiteId": "...",
    "status": "active",
    "createdAt": "2026-01-12T..."
  }
}
```

This enables idempotent provisioning - running the same template again reuses existing resources.

## Related Documentation

- [Blueprints and Templates Guide](../guides/blueprints_and_templates.md)
- [Git Workflow](../documentation/GIT_WORKFLOW.md)
