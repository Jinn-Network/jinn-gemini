# Legacy vs Onchain Tools Analysis

## 🔴 LEGACY TOOLS (Should be removed)

### Job Management (Legacy Supabase)
- `create_job` - Creates jobs in legacy `jobs` table
- `create_job_batch` - Creates multiple jobs in legacy `jobs` table  
- `update_job` - Updates jobs in legacy `jobs` table

### Artifact Management (Legacy Supabase)
- `manage_artifact` - Manages artifacts in legacy `artifacts` table
- `civitai_generate_image` - Creates artifacts in legacy `artifacts` table

### Memory Management (Legacy Supabase)
- `create_memory` - Creates memories in legacy `memories` table
- `search_memories` - Searches legacy `memories` table

### Project Management (Legacy Supabase)
- `plan_project` - Creates projects in legacy `project_definitions` table
- `get_project_summary` - Reads from legacy project tables

### Communication (Legacy Supabase)
- `send_message` - Sends messages to legacy `messages` table

### Search & Discovery (Legacy Supabase)
- `search_jobs` - Searches legacy `jobs` table
- `search_artifacts` - Searches legacy `artifacts` table

### Context & Details (Legacy Supabase)
- `get_context_snapshot` - Reads from legacy tables
- `get_details` - Reads from legacy tables

### Civitai Integration (External API)
- `civitai_publish_post` - External API integration
- `civitai_search_models` - External API integration  
- `civitai_get_model_details` - External API integration
- `civitai_search_images` - External API integration

### Transaction Management (Legacy Supabase)
- `enqueue_transaction` - Writes to legacy `transaction_requests` table
- `get_transaction_status` - Reads from legacy `transaction_requests` table

### Zora Integration (External API)
- `zora_prepare_create_coin_tx` - External API integration
- `zora_query_coins` - External API integration

## ✅ ONCHAIN TOOLS (Keep these)

### Onchain Job Management
- `post_marketplace_job` - Posts jobs to Mech Marketplace (onchain)

### Onchain Data Management  
- `create_artifact` - Creates artifacts via Control API (onchain)
- `create_message` - Creates messages via Control API (onchain)

### Database Operations (Hybrid - routes onchain to Control API)
- `get_schema` - Read-only, works with both legacy and onchain tables
- `create_record` - Routes onchain tables to Control API
- `read_records` - Read-only, works with both legacy and onchain tables  
- `update_records` - Routes onchain tables to Control API
- `delete_records` - Delete operations (legacy tables only)

### Utility
- `list_tools` - Lists available tools

## Summary
**Legacy tools to remove: 25 tools**
**Onchain tools to keep: 8 tools**

The onchain migration focuses on the core job lifecycle (post → claim → execute → report → deliver) while removing the legacy Supabase-based job management system.

