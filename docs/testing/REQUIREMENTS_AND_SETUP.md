# Memory System Testing - Requirements and Setup

## System Requirements

### Services Required

1. **Supabase** - Database for utility scores
2. **Ponder** - Blockchain indexer with GraphQL API
3. **Control API** - GraphQL server for mutations
4. **Worker** - Mech worker for job execution

### Environment Variables

Required in `.env`:
```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Ponder
PONDER_GRAPHQL_URL=http://localhost:42069/graphql
PONDER_PORT=42069

# Control API
CONTROL_API_URL=http://localhost:3042/graphql

# Worker/Mech
MECH_ADDRESS=your-mech-address
RPC_URL=your-rpc-url

# IPFS
IPFS_GATEWAY_URL=https://gateway.autonolas.tech/ipfs/

# Memory System Flags
DISABLE_MEMORY_INJECTION=false  # Set to 'true' for baseline benchmarks
```

## Setup Procedure

### Step 1: Apply Database Migration

The Supabase migration creates the `utility_scores` table for tracking memory ratings.

```bash
# Apply migration
supabase db push
```

**Migration file**: `supabase/migrations/20251014175611_create_utility_scores.sql`

**What it creates**:
- Table: `utility_scores`
- Columns: `id`, `artifact_id`, `score`, `access_count`, `created_at`, `updated_at`
- Indexes: On `artifact_id` and `score`

### Step 2: Start Services

Start each service in a separate terminal:

#### Terminal 1: Ponder (Blockchain Indexer)
```bash
yarn ponder
```

**Purpose**: Indexes artifacts from blockchain events, provides GraphQL API for memory search.

**Health Check**:
```bash
curl -X POST http://localhost:42069/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ artifacts(limit: 1) { items { id } } }"}'
```

#### Terminal 2: Control API (Mutations Server)
```bash
yarn control-api
```

**Purpose**: Provides GraphQL mutations for rating memories and other operations.

**Health Check**:
```bash
curl -X POST http://localhost:3042/graphql \
  -H "Content-Type: application/json" \
  -H "x-worker-address: test" \
  -d '{"query": "{ _health }"}'
```

#### Terminal 3: Mech Worker (Job Processor)
```bash
yarn mech
```

**Purpose**: Processes jobs with memory injection and reflection steps.

**Expected Logs**:
- "Mech worker starting"
- "Fetching requests from Ponder"
- For jobs: "Searching for relevant memories", "Starting reflection step"

### Step 3: Verify Setup

Run the verification script:

```bash
npx tsx scripts/test-memory-search.ts
```

**Expected Output** (initially):
```
Found 0 memory artifact(s):
⚠️  No MEMORY artifacts found yet.
```

This is correct - no memories exist until jobs run with reflection.

## Service Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Service Stack                            │
└─────────────────────────────────────────────────────────────┘

┌──────────────┐
│  Blockchain  │  Events (MarketplaceRequest, Deliver)
└──────┬───────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ Ponder (Port 42069)                                         │
│  - Indexes events                                            │
│  - Stores artifacts with type, tags, etc.                   │
│  - Provides GraphQL read API                                │
└──────┬──────────────────────────────────────────────────────┘
       │
       │ GraphQL Query
       ▼
┌─────────────────────────────────────────────────────────────┐
│ Worker (Mech)                                               │
│  1. Fetch jobs from Ponder                                  │
│  2. Search memories (search_memories → Ponder GraphQL)      │
│  3. Inject memories into prompt                             │
│  4. Execute agent                                            │
│  5. Reflection step (create_artifact type='MEMORY')         │
└──────┬──────────────────────────────────────────────────────┘
       │
       │ Rate memory
       ▼
┌─────────────────────────────────────────────────────────────┐
│ Control API (Port 3042)                                     │
│  - Provides write mutations                                  │
│  - Updates utility_scores in Supabase                       │
└──────┬──────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ Supabase                                                     │
│  - utility_scores table                                      │
│  - Mutable rating data                                       │
└─────────────────────────────────────────────────────────────┘
```

## Package.json Scripts

The following scripts should be available:

```json
{
  "scripts": {
    "ponder": "cd ponder && ponder start",
    "control-api": "tsx control-api/server.ts",
    "mech": "tsx worker/mech_worker.ts"
  }
}
```

## Troubleshooting

### Ponder Not Starting
- Check blockchain RPC URL is accessible
- Verify contracts are deployed on target chain
- Check `ponder.config.ts` for correct network/contract addresses

### Control API Connection Failed
- Ensure port 3042 is not in use
- Check Supabase credentials in `.env`
- Verify `x-worker-address` header is provided

### Worker Not Finding Memories
- Confirm Ponder is running and synchronized
- Check `PONDER_GRAPHQL_URL` environment variable
- Verify job has `jobName` field (required for search)

### Migration Fails
- Ensure Supabase CLI is installed: `supabase --version`
- Check Supabase project is linked: `supabase link`
- Verify credentials: `supabase status`

## Testing Checklist

Before running tests, verify:

- [ ] Supabase migration applied (`supabase db push`)
- [ ] Ponder running on port 42069
- [ ] Control API running on port 3042
- [ ] Worker running and processing jobs
- [ ] All environment variables set in `.env`
- [ ] Test scripts execute without import errors

## Next Steps

Once all services are running:

1. Run functional tests (see `MEMORY_SYSTEM_TEST_EXECUTION_GUIDE.md`)
2. Execute baseline benchmark
3. Execute with-memory benchmark
4. Compare results and document findings





