# Context Summary: Ponder Native SSE Real-Time Implementation

## Current Status
We are 95% complete with refactoring the custom real-time server to use Ponder's native Server-Sent Events (SSE) functionality. There is ONE remaining bug to fix.

## What Has Been Completed

### 1. Backend Cleanup ✅
- ✅ Deleted old custom real-time server (`ponder/realtime-server.ts`)
- ✅ Deleted SQL triggers (`ponder/migrations/add_realtime_triggers.sql`)
- ✅ Deleted old documentation (`ponder/README-REALTIME.md`, `REALTIME-IMPLEMENTATION-SUMMARY.md`)
- ✅ Updated `railway.toml` to remove reference to old real-time server
- ✅ Removed unused dependencies (`express`, `cors`, etc.)
- ✅ Downgraded `yargs` and `vitest` to fix Node.js 22.11.0 compatibility on Railway

### 2. Frontend Implementation ✅ (with one bug)
- ✅ Added `@ponder/client@^0.6.0` dependency to `frontend/explorer/package.json`
- ✅ Created `frontend/explorer/src/lib/ponder-client.ts` (has bug - see below)
- ✅ Refactored `frontend/explorer/src/hooks/use-realtime-data.ts` to use `ponderClient.live()` with raw SQL queries
- ✅ Updated all consuming components to work with new hook signature
- ✅ Maintained polling fallback for when SSE is disconnected

### 3. Deployment ✅
- ✅ All changes pushed to branch `oak/job-and-workstream-frontend-improvements`
- ✅ Railway deployment succeeds (Ponder is running)
- ✅ GraphQL endpoint working: `https://jinn-gemini-production.up.railway.app/graphql`
- ✅ Ponder's native SSE endpoint available at: `https://jinn-gemini-production.up.railway.app/subscribe`

## The ONE Remaining Bug 🐛

**Location:** `frontend/explorer/src/lib/ponder-client.ts` (line 3-4)

**Error:** 
```
[ERROR] [useRealtimeData] Error setting up subscriptions: TypeError: Failed to construct 'URL': Invalid URL
```

**Root Cause:**
The Ponder client is being initialized with an invalid URL. Current code:

```typescript
const PONDER_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL?.replace('/graphql', '')
  || 'http://localhost:42069';

export const ponderClient = createClient({ url: PONDER_URL });
```

**Problem:** `@ponder/client@0.6.0` expects a different initialization signature than what we're using.

## Next Steps to Complete

### Fix the Ponder Client Initialization

**Task:** Check the `@ponder/client` v0.6.0 documentation and fix the client initialization in `frontend/explorer/src/lib/ponder-client.ts`.

**Reference the Context7 docs for `@ponder/client`:**
```bash
# Use this to get the correct API:
mcp_Context7_get-library-docs("/ponder-sh/ponder", "client createClient initialization")
```

**What to look for:**
1. Correct signature for `createClient()` in v0.6.0
2. May need to pass URL differently (e.g., as first positional arg vs options object)
3. May need to configure base URL vs subscribe URL separately

**Expected fix pattern (guess):**
```typescript
// Option 1: URL as first argument
export const ponderClient = createClient(PONDER_URL);

// Option 2: Different URL format needed
const PONDER_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL?.replace('/graphql', '/subscribe')
  || 'http://localhost:42069/subscribe';

// Option 3: May need base URL without /subscribe (Ponder adds it)
const PONDER_BASE_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL?.replace('/graphql', '')
  || 'http://localhost:42069';
```

### Test After Fix

1. **Local test:**
   ```bash
   cd frontend/explorer
   yarn dev:local
   # Open http://localhost:3000/workstreams/0x90835856819a3656736ee48f5426c48803b3e685c1916efcca3d9f1be4ea5677
   # Check browser console - should see NO errors
   # Status indicator should show "Connected" instead of "Polling"
   ```

2. **Production test:**
   - Push changes to `oak/job-and-workstream-frontend-improvements`
   - Wait for Railway deployment
   - Open production frontend
   - Verify SSE connection works

## Key Technical Context

### Ponder's SSE Architecture
- Ponder v0.11+ has built-in SSE support via `/subscribe` endpoint (POST)
- No backend configuration needed - it's automatic
- Frontend uses `@ponder/client` to subscribe to table changes
- Client sends POST request with SQL query, receives SSE stream of updates

### Frontend Hook Pattern
The `useRealtimeData` hook:
- Subscribes to 5 tables: `request`, `artifact`, `delivery`, `jobDefinition`, `message`
- Uses raw SQL queries (e.g., `sql\`SELECT * FROM "request" LIMIT 1\``)
- Triggers `onEvent()` callback when any change detected
- Falls back to polling if SSE connection fails

### Environment Variables
- Local: `http://localhost:42069` (default)
- Production: `NEXT_PUBLIC_SUBGRAPH_URL=https://jinn-gemini-production.up.railway.app/graphql`

## Files to Check

1. **Primary fix needed:**
   - `frontend/explorer/src/lib/ponder-client.ts` ⚠️ FIX THIS

2. **Related files (likely don't need changes):**
   - `frontend/explorer/src/hooks/use-realtime-data.ts` ✅
   - `frontend/explorer/package.json` ✅
   - `ponder/ponder.config.ts` ✅

## Success Criteria

✅ Browser console shows NO "Invalid URL" errors  
✅ Real-time status indicator shows "Connected" (green)  
✅ Console shows: `[useRealtimeData] Connected to Ponder SSE`  
✅ Live updates work (new jobs appear without page refresh)  
✅ Polling fallback still works if SSE fails  

## Additional Resources

- **Ponder SSE docs:** Use Context7 MCP to query `/ponder-sh/ponder` for "client createClient"
- **Original plan:** `.cursor/plans/real-time-9684020d.plan.md`
- **Agent README:** `AGENT_README_TEST.md` (has real-time section)
- **Railway deployment:** Use Railway MCP to check logs and deployment status

---

## Prompt for Next AI Agent

Please complete the Ponder native SSE implementation by fixing the Ponder client initialization bug.

**The issue:** The `ponderClient` in `frontend/explorer/src/lib/ponder-client.ts` is being created with an invalid URL format, causing "Failed to construct 'URL': Invalid URL" errors in the browser console.

**Steps:**
1. Use Context7 MCP to query the correct `createClient()` API for `@ponder/client` v0.6.0
2. Fix the initialization in `frontend/explorer/src/lib/ponder-client.ts`
3. Test locally at `http://localhost:3000/workstreams/0x90835856819a3656736ee48f5426c48803b3e685c1916efcca3d9f1be4ea5677`
4. Verify no console errors and status shows "Connected"
5. Push to `oak/job-and-workstream-frontend-improvements` and verify on Railway

Everything else is working - this is the final 5% to complete the refactor!

