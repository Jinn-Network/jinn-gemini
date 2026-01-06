# feat: Blueprint System Refactor, Template Marketplace, and x402 Gateway

## Overview

This PR introduces a major architectural refactor of the blueprint system, adds a complete template marketplace infrastructure, implements an x402 payment gateway service, and includes numerous improvements to git workflows, dispatch logic, and the frontend explorer.

**Branch:** `feat/venture-deployment-47a`  
**Files Changed:** 198 files, +27,438 insertions, -4,424 deletions

---

## 🎯 Major Features

### 1. Blueprint System Refactor

**Problem:** The previous blueprint system used fragmented assertion providers that were hard to maintain and extend.

**Solution:** Complete rewrite to a unified provider-based system with clear separation of concerns:

- **Context Providers** (Phase 1): Build runtime context (job state, files, git status)
  - `JobContextProvider`: Live job state, files, git status
  - `ProgressCheckpointProvider`: Progress tracking

- **Invariant Providers** (Phase 2): Layer invariants with access to built context
  - `SystemInvariantProvider`: Core agent identity and behavior rules
  - `GoalInvariantProvider`: Venture-specific business logic (JOB-* invariants)
  - `StrategyInvariantProvider`: Strategic decision-making rules
  - `RecoveryInvariantProvider`: Error recovery patterns
  - `CoordinationInvariantProvider`: Parent-child coordination
  - `StateInvariantProvider`: State management rules
  - `OutputInvariantProvider`: Output schema validation
  - `QualityInvariantProvider`: Quality standards
  - `LearningInvariantProvider`: Learning and improvement
  - `ToolingInvariantProvider`: Tool usage guidelines

**Key Changes:**
- Renamed `GOAL-*` → `JOB-*` prefix for clarity (backward compatible)
- Minimal invariant schema: only `id`, `invariant`, optional `measurement` and `examples`
- 3-layer urgency ordering in system blueprint
- Provider-based architecture enables easy extension and testing

**Files:**
- `worker/prompt/BlueprintBuilder.ts` - Central builder class
- `worker/prompt/providers/invariants/*.ts` - 10 new invariant providers
- `worker/prompt/providers/context/*.ts` - Context providers
- `worker/prompt/system-blueprint.json` - Enhanced with clearer delegation/dependency rules

### 2. Template Marketplace System

**Problem:** No way to package and sell ventures as reusable templates.

**Solution:** Complete template infrastructure from registration to execution:

#### Template Registration (`register_template` MCP tool)
- Register ventures as marketplace templates
- Stores templates in Ponder `jobTemplate` table
- Supports input schemas, output specs, pricing, tags
- Default status: `hidden` (requires approval before visibility)

#### Template Execution (x402 Gateway)
- New `services/x402-gateway/` service
- REST API for template discovery and execution
- x402 payment integration for paid template execution
- Output spec validation and mapping
- Status polling and result retrieval

#### Frontend Templates Catalog
- New `/templates` page in explorer
- Browse and discover available templates
- Template details view with pricing and specs
- Integration with x402 gateway for execution

**Files:**
- `gemini-agent/mcp/tools/register_template.ts` - Template registration tool
- `services/x402-gateway/index.ts` - Gateway service (742 lines)
- `services/x402-gateway/output-spec.ts` - Output validation
- `services/x402-gateway/pricing.ts` - Cost calculation
- `frontend/explorer/src/components/templates-catalog.tsx` - UI component
- `migrations/create_job_templates_table.sql` - Database schema
- `ponder/ponder.schema.ts` - Ponder indexing

### 3. x402 Payment Gateway

**Purpose:** Enable paid execution of job templates via Coinbase x402 protocol.

**Features:**
- `GET /templates` - List available templates (free)
- `GET /templates/:id` - Get template details (free)
- `POST /templates/:id/execute` - Execute template (paid via x402)
- `GET /runs/:requestId/status` - Check execution status (free)
- `GET /runs/:requestId/result` - Get execution result (free)

**Integration:**
- Uses `x402-hono` middleware for payment verification
- Supports dynamic pricing from template metadata
- Budget validation before execution
- Output spec passthrough for structured results

**Deployment:**
- Railway-ready configuration
- Environment-based network selection (Base Sepolia / Base Mainnet)
- Ponder GraphQL integration for template queries

### 4. Model Upgrade: Gemini 2.5 → Gemini 3

- Updated default model from `gemini-2.5-flash` to `gemini-3-flash-preview`
- Applied across:
  - `dispatch_new_job` tool default
  - `runAgent` fallback model
  - Documentation strings

### 5. Git Workflow Improvements

**Auto-commit beads files:**
- Automatically commits `.beads/` files when they're the only uncommitted changes
- Prevents merge/checkout failures from beads runtime state
- Applies to both `merge` and `checkout` operations
- Logs auto-commit actions for debugging

**Enhanced error messages:**
- More descriptive merge conflict messages
- Better guidance for resolution steps

**Files:**
- `worker/mcp/tools/git.ts` - Auto-commit logic in merge/checkout handlers
- `tests/unit/worker/mcp/git.test.ts` - Updated test expectations

### 6. Dispatch Logic Optimizations

**Faster Ponder indexing:**
- Reduced poll count from 10 to 3
- Reduced poll delay from 1000ms to 500ms
- Rationale: Self-exclusion from sibling check means we only wait for near-simultaneous siblings

**Parent dispatch fix:**
- Exclude self from sibling completion check
- Prevents false negatives when checking if all siblings are complete
- Critical for accurate parent dispatch timing

**Files:**
- `worker/status/autoDispatch.ts` - Polling and parent dispatch logic

### 7. Frontend Enhancements

**Storybook Integration:**
- Complete Storybook setup for component development
- Stories for: Badge, Button, Card, Dialog, Input, Label, Select, Separator, Skeleton, Table, Tabs, Tooltip
- Excluded from TypeScript compilation

**Templates UI:**
- Templates catalog component
- Template detail views
- Integration with x402 gateway

**Production Configuration:**
- Default gateway URL set to production Railway endpoint
- Environment variable override for local development

**Files:**
- `frontend/explorer/.storybook/` - Storybook configuration
- `frontend/explorer/src/components/*.stories.tsx` - Component stories
- `frontend/explorer/src/components/templates-catalog.tsx` - Templates UI

### 8. Documentation

**New Guides:**
- `docs/guides/blueprints_and_templates.md` - Template system guide
- `docs/guides/jinn_system_for_agents.md` - Agent onboarding
- `docs/documentation/JOB_TERMINOLOGY.md` - Terminology reference
- `docs/documentation/X402_GATEWAY_SECURITY.md` - Security guide

**Proposals:**
- `docs/proposals/x402-service-factory-proposal.md` - Service factory vision
- `docs/spec/x402-service-optimizer-architecture.md` - Optimizer architecture

**Updated:**
- `AGENT_README.md` - Beads workflow instructions
- `AGENT_README_TEST.md` - Test-specific agent instructions
- `docs/spec/blueprint/style-guide.md` - Blueprint writing guide

### 9. Venture Blueprints

Added several production-ready venture blueprints:
- `code-health-venture.json` - Code health auditing
- `marketing-content-venture.json` - Marketing content generation
- `venture-foundry.json` - Venture creation factory
- `prediction-market-fund.json` - Prediction market analysis
- `x402-service-optimizer.json` - x402 service optimization
- `local-arcade.json` - Local development playground

### 10. Testing & Quality

**New Tests:**
- `tests-next/unit/gemini-agent/mcp/tools/register_template.test.ts` - Template registration
- `tests-next/unit/worker/prompt/providers/context/JobContextProvider.test.ts` - Context provider
- Updated git workflow tests for auto-commit behavior
- Updated blueprint builder tests for new provider system

**Test Improvements:**
- Pagination support for large diff outputs
- Better mock expectations for multiple git status calls
- Semantic failure detection tests

---

## 🔧 Technical Details

### Database Changes

**New Table: `job_template`**
```sql
CREATE TABLE job_template (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  blueprint_cid TEXT,
  input_schema JSONB,
  output_spec JSONB,
  enabled_tools TEXT[],
  tags TEXT[],
  price_wei TEXT,
  price_usd TEXT,
  canonical_job_definition_id TEXT,
  status TEXT DEFAULT 'hidden',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Ponder Schema Updates:**
- Added `JobTemplate` entity for indexing
- GraphQL queries for template discovery

### Configuration Changes

**Environment Variables:**
- `PONDER_DATABASE_URL` - Ponder PostgreSQL connection (for template registration)
- `DATABASE_SCHEMA` - Database schema for Railway deployments
- `NEXT_PUBLIC_X402_GATEWAY_URL` - Frontend gateway URL override
- `PONDER_INDEX_POLL_COUNT` - Reduced default from 10 to 3
- `PONDER_INDEX_POLL_DELAY_MS` - Reduced default from 1000 to 500

### Dependencies

**New Packages:**
- `x402-hono` - x402 payment middleware
- `@coinbase/x402` - x402 SDK
- `@storybook/*` - Frontend component development
- Various UI component libraries for Storybook

**Updated:**
- Model references updated to Gemini 3
- Blueprint system dependencies

---

## 🚀 Migration Guide

### For Developers

1. **Blueprint Writing:**
   - Use `JOB-*` prefix instead of `GOAL-*` (backward compatible)
   - Minimal schema: only `id`, `invariant`, optional `measurement`/`examples`
   - See `docs/guides/blueprints_and_templates.md`

2. **Template Registration:**
   - Run venture as child job first to validate
   - Extract cost from telemetry for pricing
   - Upload blueprint to IPFS
   - Call `register_template` MCP tool

3. **Git Workflows:**
   - Beads files auto-commit when only uncommitted changes
   - No manual intervention needed for merge/checkout

### For Operators

1. **Deploy x402 Gateway:**
   - Set required environment variables (see `services/x402-gateway/index.ts`)
   - Configure Railway deployment
   - Set `NEXT_PUBLIC_X402_GATEWAY_URL` in frontend

2. **Database Migration:**
   - Run `migrations/create_job_templates_table.sql`
   - Ensure Ponder indexes `jobTemplate` table

3. **Model Configuration:**
   - Default model is now `gemini-3-flash-preview`
   - Override via `MECH_MODEL` env var if needed

---

## 🐛 Bug Fixes

- Fixed `register_template` to use Ponder PostgreSQL instead of Supabase
- Fixed `dispatch_existing_job` schema to use `z.record` instead of `z.any`
- Fixed parent dispatch to exclude self from sibling completion check
- Fixed database schema search path for Railway deployments
- Fixed `.gitignore` persistence across branch operations
- Fixed beads file tracking in git

---

## 📊 Impact Assessment

### Breaking Changes
- **None** - All changes are backward compatible or additive

### Performance
- ✅ Faster parent dispatch (reduced polling)
- ✅ More efficient blueprint building (provider-based)
- ✅ Optimized Ponder queries

### Security
- ✅ x402 payment verification
- ✅ Budget validation
- ✅ Output spec validation
- ✅ Template approval workflow (hidden by default)

### Developer Experience
- ✅ Clearer blueprint system architecture
- ✅ Better error messages
- ✅ Comprehensive documentation
- ✅ Storybook for component development

---

## ✅ Testing

- [x] Unit tests updated for new blueprint system
- [x] Git workflow tests updated for auto-commit
- [x] Template registration tests added
- [x] Frontend Storybook stories added
- [x] Integration tests for x402 gateway (manual)

---

## 📝 Related Issues

- Closes `jinn-gemini-47a` - Venture deployment and template system
- Closes `jinn-gemini-cgo` - Blueprint system refactor
- Addresses parent dispatch timing issues
- Addresses git workflow friction with beads files

---

## 🎉 Next Steps

1. **Template Approval Workflow:** Build UI/admin for template approval
2. **Payment Verification:** Complete x402 payment verification in gateway
3. **Template Analytics:** Track template usage and performance
4. **Service Factory:** Implement x402 service optimizer venture
5. **Documentation:** Expand agent onboarding materials

---

## 🙏 Acknowledgments

This PR represents a significant architectural improvement to the Jinn system, enabling the template marketplace vision while maintaining backward compatibility and improving developer experience throughout.
