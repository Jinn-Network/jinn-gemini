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

### Gateway (services/x402-gateway)
Required for $provision to work on deployed gateway:
```
GITHUB_TOKEN=ghp_...
RAILWAY_API_TOKEN=...
BLOG_RAILWAY_PROJECT_ID=...    # Note: NOT RAILWAY_PROJECT_ID (Railway overrides that)
UMAMI_HOST=https://...
UMAMI_USERNAME=admin
UMAMI_PASSWORD=...
```

### Local Development
Same variables in `.env` file at repo root.

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
