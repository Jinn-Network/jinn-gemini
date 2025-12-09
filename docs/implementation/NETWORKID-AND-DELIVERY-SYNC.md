# NetworkId Filtering & Global Jinn Explorer

**Date**: 2025-11-25 (Original), 2025-12-05 (Updated for Global Explorer), 2025-12-08 (Implemented)  
**Status**: ✅ Implemented (Global Jinn Explorer)  
**Related Design**: See `cursor-plan://2b1692c7-a844-4760-bcf3-6366e483dcfb/global.plan.md` for full global explorer specification

## Evolution: Single-Tenant → Global Jinn Explorer

### Original Problem (2025-11-25)
Workers repeatedly attempted to deliver requests already delivered by competing mechs, resulting in RevokeRequest events, wasted gas, and stale UI state.

### Original Solution
- NetworkId filtering to exclude non-Jinn traffic
- MarketplaceDelivery handler to track competing mech deliveries
- Single-mech focus: Ponder only indexed requests TO our mech

### Current Architecture (2025-12-05)
**Ponder is now a global Jinn marketplace explorer**, not a single-tenant indexer. It tracks ALL Jinn requests and deliveries across ALL mechs, enabling:
- Multi-mech visibility (your mech + colleague mechs)
- Marketplace-wide analytics
- Cross-mech delivery tracking
- Network boundary enforcement (Jinn vs non-Jinn tenants)

## Solution Architecture

### Part 1: Network ID Filtering (Jinn-Only Indexing - No Mech Filtering)

**Objective**: Index ALL Jinn marketplace requests, regardless of which mech is involved. Exclude non-Jinn tenants.

**Implementation**:
- Added `networkId: "jinn"` to all request metadata in dispatch tools
- Updated Ponder `MarketplaceRequest` handler with filtering logic:
  - `networkId === "jinn"` → INDEX (explicit Jinn marker)
  - `networkId === undefined` → INDEX (legacy Jinn, backward compatibility)
  - `networkId === other` → SKIP and mark as filtered (non-Jinn tenant)
- **NO mech-based filtering**: `priorityMech` from marketplace event is stored in `request.mech` for reference, but does NOT control whether request is indexed

**Result**: `request` table contains ALL Jinn requests across ALL mechs (global Jinn marketplace view)

**Files Modified**:
- `gemini-agent/mcp/tools/dispatch_new_job.ts` - Added `networkId` field to metadata
- `gemini-agent/mcp/tools/dispatch_existing_job.ts` - Added `networkId` field to metadata
- `ponder/src/index.ts` - Added networkId filtering WITHOUT mech filtering in MarketplaceRequest handler

### Part 2: Marketplace Delivery Sync (Global Jinn Explorer)

**Objective**: Track delivered status for ALL Jinn requests delivered by ANY mech.

**Implementation**:
- Added Ponder handler for `MechMarketplace:MarketplaceDelivery` events (batch structure)
- Handler updates `request.delivered = true` when ANY mech delivers a Jinn request
- Only processes deliveries for requests that exist in DB (Jinn requests indexed in Part 1)
- Added schema fields to track marketplace delivery metadata

**New Schema Fields**:

On `request` table:
- `deliveryMech: t.hex()` - Which mech delivered (from MarketplaceDelivery event)

On `delivery` table:
- `deliveryMech: t.hex()` - Which mech delivered (from MarketplaceDelivery event)

**Note**: Delivery transaction metadata (txHash, blockNumber, blockTimestamp) comes from OlasMech:Deliver event, stored in `delivery` table. MarketplaceDelivery provides the `deliveryMech` address only.

**Files Modified**:
- `ponder/ponder.schema.ts` - Added delivery tracking fields with index on `deliveryMech`
- `ponder/src/index.ts` - Added MarketplaceDelivery handler (batch event processing)

### Part 3: Responsibility Split (MarketplaceDelivery vs OlasMech:Deliver)

**Objective**: Clean separation between delivered status (marketplace) and artifact resolution (OlasMech).

**MarketplaceDelivery Handler (tracks which mech delivered)**:
- Stores `deliveryMech` on both `request` and `delivery` tables
- Only updates Jinn requests (requests that passed networkId filter in Part 1)
- Does NOT update `delivered` status (delegated to OlasMech:Deliver handler for consistency with existing architecture)

**OlasMech:Deliver Handler (IPFS artifact resolution + delivered status)**:
- Marks `request.delivered = true` (source of truth for delivered status)
- Stores `deliveryIpfsHash` (IPFS digest for artifact resolution)
- Resolves artifacts, telemetry, and SITUATION embeddings from IPFS
- Factory-based: listens to ALL OlasMech instances discovered via `MechMarketplace.CreateMech`

**Result**: 
- Worker queries `delivered` status from Ponder and gets marketplace truth
- Frontend can filter by `mech` (requested mech) or `deliveryMech` (actual deliverer)
- No duplicate request entries - one entry per Jinn request, with delivery info from whichever mech delivered

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

### After Fix (Global Jinn Explorer)

```
MarketplaceRequest → Ponder fetches IPFS metadata
                  ↓
              Checks networkId field
                  ↓
        networkId === "jinn" or undefined?
          YES ↓              NO ↓
    Index request (ALL mechs)   Skip (non-Jinn)
                  ↓
MechMarketplace:MarketplaceDelivery → ANY mech delivers (batch event)
                  ↓
        Ponder checks if request exists (Jinn job?)
          YES ↓              NO ↓
    Mark delivered: true   Skip (non-Jinn)
    Store deliveryMech
                  ↓
OlasMech:Deliver → ANY mech's IPFS artifact
                  ↓
        Store deliveryIpfsHash (artifact resolution)
        Resolve artifacts, telemetry, SITUATION embeddings
                  ↓
Worker queries Ponder → Sees delivered: true (synced with marketplace)
                  ↓
Worker skips request → No delivery attempt
                  ↓
Frontend → Can filter by mech (requested) OR deliveryMech (actual deliverer)
        → Shows ALL Jinn requests across ALL mechs
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
    mech
  }
}
```

**Find requests delivered by specific mech**:
```graphql
query MechDeliveries {
  requests(
    where: { deliveryMech: "0xb55fadf1f0bb1de99c13301397c7b67fde44f6b1" }
    limit: 10
  ) {
    items {
      id
      deliveryMech
      mech
      delivered
    }
  }
}
```

**Find all requests FOR a specific mech (global Jinn view)**:
```graphql
query RequestsForMech {
  requests(
    where: { mech: "0x8c083dfe9bee719a05ba3c75a9b16be4ba52c299" }
    limit: 10
  ) {
    items {
      id
      mech
      deliveryMech
      delivered
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

## Global Explorer Capabilities (2025-12-05)

**Frontend Features**:
- ✅ `deliveryMech` field displayed in request and delivery detail pages
- ✅ Filter requests by `mech` (priority mech) or `deliveryMech` (actual deliverer)
- ✅ GraphQL queries support filtering by any mech in Jinn marketplace
- ✅ New schema fields: `deliveryMech` on both `request` and `delivery` tables

**Analytics Enabled**:
- Query requests by `deliveryMech` to track which mechs deliver most Jinn jobs
- Compare `request.mech` vs `deliveryMech` to see request routing patterns
- Measure cross-mech activity in Jinn marketplace

**Network Boundary Enforcement**:
- `networkId === "jinn"` or undefined → INDEX (global Jinn marketplace)
- `networkId !== "jinn"` → SKIP (non-Jinn tenants completely excluded)
- No mixing of Jinn and non-Jinn traffic in database

## Future Improvements

1. **Frontend Mech Selector**: Add dropdown to filter UI by specific mech address
2. **Marketplace Analytics Dashboard**: Visualize request distribution and delivery patterns across mechs
3. **Reorg Protection**: Add reorg handling for marketplace delivery events (low priority, Base has fast finality)
4. **Rate Limiting**: Add rate limiting to MarketplaceDelivery handler if marketplace traffic grows significantly

