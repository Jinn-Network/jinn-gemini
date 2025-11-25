# NetworkId Filtering & Marketplace Delivery Sync

**Date**: 2025-11-25  
**Status**: ✅ Implemented  
**Related Issue**: RevokeRequest / Stale Pending Requests

## Problem Statement

Workers were repeatedly attempting to deliver requests that had already been delivered by competing mechs, resulting in:

1. **RevokeRequest Events**: Transactions confirmed but emitted `RevokeRequest` instead of `Deliver`
2. **Wasted Gas**: ~120k gas per failed delivery attempt
3. **Stale UI State**: Frontend showed requests as "pending" indefinitely
4. **Infinite Retry Loops**: Requests remained in worker queue across runs

### Root Causes

1. **Worker Preflight**: Only checked mech's local undelivered queue, missing marketplace state updates
2. **Ponder Indexing**: Only indexed deliveries from our mech, missing competing mech deliveries
3. **Global Marketplace Pollution**: Ponder indexed ALL marketplace requests, not just Jinn jobs

## Solution Architecture

### Part 1: Network ID Filtering (Jinn-Only Indexing)

**Objective**: Ensure Ponder only tracks Jinn jobs, not global marketplace traffic.

**Implementation**:
- Added `networkId: "jinn"` to all request metadata in dispatch tools
- Updated Ponder `MarketplaceRequest` handler with filtering logic:
  - `networkId === "jinn"` → INDEX (explicit Jinn marker)
  - `networkId === undefined` → INDEX (legacy Jinn, backward compatibility)
  - `networkId === other` → SKIP and delete pre-seeded row (non-Jinn tenant)

**Files Modified**:
- `gemini-agent/mcp/tools/dispatch_new_job.ts` - Added `networkId` field to metadata
- `gemini-agent/mcp/tools/dispatch_existing_job.ts` - Added `networkId` field to metadata
- `ponder/src/index.ts` - Added networkId filtering in MarketplaceRequest handler

### Part 2: Marketplace Delivery Sync

**Objective**: Make Ponder's `delivered` status converge with marketplace truth, regardless of which mech delivered.

**Implementation**:
- Added new Ponder handler for `MechMarketplace:MarketplaceDelivery` events
- Handler updates `request.delivered = true` when ANY mech delivers a Jinn request
- Added schema fields to track marketplace delivery metadata

**New Schema Fields**:
- `deliveryMech: p.hex().optional()` - Which mech delivered (from marketplace)
- `deliveryTxHash: p.string().optional()` - Marketplace delivery transaction hash
- `deliveryBlockNumber: p.bigint().optional()` - Block number of marketplace delivery
- `deliveryBlockTimestamp: p.bigint().optional()` - Timestamp of marketplace delivery

**Files Modified**:
- `ponder/ponder.schema.ts` - Added delivery tracking fields
- `ponder/src/index.ts` - Added MarketplaceDelivery handler

### Part 3: Colleague Mech Telemetry (Optional)

**Objective**: Index deliveries from competing mechs for richer telemetry.

**Implementation**:
- Added `OlasMechColleague` contract to Ponder config (`0xe535D7AcDEeD905dddcb5443f41980436833cA2B`)
- Duplicated `OlasMech:Deliver` handler for colleague's mech
- Indexes artifacts, job definitions, and SITUATION embeddings from colleague deliveries

**Files Modified**:
- `ponder/ponder.config.ts` - Added colleague mech contract
- `ponder/src/index.ts` - Added OlasMechColleague:Deliver handler

## Data Flow

### Before Fix

```
MarketplaceRequest → Ponder indexes ALL marketplace requests
                  ↓
              Creates request row (delivered: false)
                  ↓
OlasMech:Deliver → Ponder marks delivered: true ONLY for our mech
                  ↓
Colleague delivers → Ponder MISSES this (doesn't track colleague mech)
                  ↓
Worker queries Ponder → Sees delivered: false (stale)
                  ↓
Worker attempts delivery → RevokeRequest (already delivered by colleague)
```

### After Fix

```
MarketplaceRequest → Ponder fetches IPFS metadata
                  ↓
              Checks networkId field
                  ↓
        networkId === "jinn" or undefined?
          YES ↓              NO ↓
    Index request      Skip (non-Jinn)
                  ↓
MechMarketplace:MarketplaceDelivery → ANY mech delivers
                  ↓
        Ponder checks if request exists (Jinn job?)
          YES ↓              NO ↓
    Mark delivered: true   Skip (non-Jinn)
                  ↓
Worker queries Ponder → Sees delivered: true (synced with marketplace)
                  ↓
Worker skips request → No delivery attempt
```

## Backward Compatibility

**Legacy Requests**: Requests without `networkId` are treated as Jinn jobs for backward compatibility.

**Schema Migration**: New fields are optional, so existing rows are valid. Ponder will reindex and populate fields for new deliveries.

**Worker Behavior**: No changes needed in worker code. Worker continues to query `requests(delivered: false)`, but Ponder now keeps `delivered` synced with marketplace.

## Testing

### Validation Script

Run the validation script to verify:
```bash
yarn tsx scripts/test-networkid-and-delivery-sync.ts
```

Tests verify:
1. Schema includes new delivery tracking fields
2. Delivered requests have `deliveryMech` populated
3. Request filtering by `networkId` (indirect check)
4. Colleague mech deliveries indexed (if any)

### Manual Verification

**Check specific request**:
```graphql
query CheckRequest($id: String!) {
  request(id: $id) {
    id
    delivered
    deliveryMech
    deliveryTxHash
    deliveryBlockNumber
    mech
  }
}
```

**Find requests delivered by colleague**:
```graphql
query ColleagueDeliveries {
  requests(
    where: { deliveryMech: "0xe535D7AcDEeD905dddcb5443f41980436833cA2B" }
    limit: 10
  ) {
    items {
      id
      deliveryMech
      deliveryTxHash
      mech
    }
  }
}
```

## Deployment Notes

### Ponder Reindexing Required

Schema changes require Ponder to reindex:

1. **Railway Deployment**: 
   - Push changes to GitHub
   - Railway auto-deploys and reindexes (~5-10 minutes)
   - Verify via Railway logs: "Indexed MarketplaceDelivery", "Marked Jinn request as delivered"

2. **Local Development**:
   - Delete `.ponder` directory or PostgreSQL database
   - Restart Ponder: `cd ponder && yarn dev`
   - Watch logs for "Processing MarketplaceDelivery event"

### Worker Changes

No worker restart needed. Worker continues to query Ponder as before, but Ponder now maintains accurate `delivered` status.

### Expected Behavior After Deployment

**Immediate**:
- New requests include `networkId: "jinn"` in IPFS metadata
- Ponder filters non-Jinn requests at indexing time

**After First Marketplace Delivery**:
- Ponder marks request as `delivered: true` via MarketplaceDelivery handler
- Worker stops selecting the request (no longer appears in `delivered: false` query)

**Long Term**:
- No more RevokeRequest events from late delivery attempts
- Frontend shows accurate delivered status for all Jinn jobs
- Ponder database stays clean (Jinn-only, no global marketplace pollution)

## Acceptance Criteria

✅ **Marketplace-delivered by another mech stops re-processing**
- Request `0x91c887...` delivered by colleague mech `0xe535D7...`
- Ponder marks `delivered: true`, `deliveryMech: 0xe535D7...`
- Worker no longer selects request in `delivered: false` queries

✅ **New Jinn requests indexed; non-Jinn ignored**
- New requests include `networkId: "jinn"` in metadata
- Ponder indexes Jinn requests, skips non-Jinn
- Database contains only Jinn jobs

✅ **Delivery sync correctness**
- After successful `MarketplaceDelivery`, Ponder updates `delivered: true`
- True regardless of which mech delivered
- Syncs within Ponder indexing delay (~30 seconds)

✅ **Backward compatibility**
- Existing requests without `networkId` still indexed
- Existing deliveries marked via MarketplaceDelivery handler
- No regression in existing functionality

✅ **Observability**
- Ponder logs "Marked Jinn request as delivered via MarketplaceDelivery"
- Worker logs show requests no longer selected once delivered

## Related Documentation

- `AGENT_README.md` - Updated gotchas section with fix details
- `scripts/test-networkid-and-delivery-sync.ts` - Validation script
- `ponder/ponder.schema.ts` - Schema documentation with new fields

## Future Improvements

1. **Frontend UI**: Add `deliveryMech` display to request detail pages
2. **Analytics**: Query by `deliveryMech` to track which mechs deliver most Jinn jobs
3. **Reorg Protection**: Add reorg handling for marketplace delivery events (low priority, Base has fast finality)
4. **Rate Limiting**: Add rate limiting to MarketplaceDelivery handler if marketplace traffic grows significantly

