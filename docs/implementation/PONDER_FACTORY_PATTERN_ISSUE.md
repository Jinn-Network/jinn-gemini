# Ponder Factory Pattern Configuration Issue

## Status: RESOLVED (2025-12-05)

**Root Cause:** Block range configuration conflict - `startBlock`/`endBlock` defined inside `factory()` AND missing at top-level contract config.

**Solution:** Move `startBlock`/`endBlock` from factory config to top-level contract config. The parent contract's block range automatically applies to factory event scanning.

**Fix Applied:** `ponder/ponder.config.ts` lines 144-154

---

## Original Issue Context

We are attempting to configure Ponder v0.15.12 to index multiple `OlasMech` contracts dynamically using the factory pattern. The factory contract is `MechMarketplace` which emits `CreateMech` events containing the addresses of newly created Mech contracts.

## Goal

Index all Mech contracts participating in the marketplace (not just a single hardcoded address) by:
1. Listening to `MechMarketplace.CreateMech` events
2. Dynamically registering each new Mech address for event indexing
3. Starting indexing from block 38187727 (November 15, 2025)

## Current Configuration

**File:** `ponder/ponder.config.ts`

```typescript
import { createConfig, factory } from "ponder";
import MechMarketplaceAbi from './abis/MechMarketplace.json';
import AgentMechAbi from '@jinn-network/mech-client-ts/dist/abis/AgentMech.json';

const UNIVERSAL_START_BLOCK = 38187727; // November 15, 2025

export default createConfig({
  database: databaseConfig,
  chains: {
    base: {
      id: 8453,
      rpc: getRpcUrl(),
      pollingInterval: 6_000,
      maxRequestsPerSecond: 2,
      finalityBlockCount: getFinalityBlockCount(),
    },
  },
  contracts: {
    MechMarketplace: {
      chain: "base",
      address: "0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020",
      abi: MechMarketplaceAbi,
      startBlock: UNIVERSAL_START_BLOCK,
      endBlock,
    },
    OlasMech: {
      chain: "base",
      abi: (AgentMechAbi as any)?.abi || (AgentMechAbi as any),
      address: factory({
        address: "0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020",
        event: MechMarketplaceAbi.find((item: any) => item.type === 'event' && item.name === 'CreateMech'),
        parameter: "mech",
        startBlock: UNIVERSAL_START_BLOCK,
        endBlock,
      }),
    },
  },
});
```

**CreateMech Event ABI:**
```json
{
  "anonymous": false,
  "inputs": [
    {
      "indexed": true,
      "internalType": "address",
      "name": "mech",
      "type": "address"
    },
    {
      "indexed": true,
      "internalType": "uint256",
      "name": "serviceId",
      "type": "uint256"
    },
    {
      "indexed": true,
      "internalType": "address",
      "name": "mechFactory",
      "type": "address"
    }
  ],
  "name": "CreateMech",
  "type": "event"
}
```

## Error

```
10:52:46.750 ERROR Build failed stage=indexing
BuildError: Validation failed: Start block for 'OlasMech' is before start block of factory address (38187727 > undefined).
```

## Analysis

The error indicates that Ponder's validation is comparing:
- `startBlock` for the child contract (`OlasMech`): `38187727`
- `startBlock` for the factory address: `undefined`

Despite explicitly setting `startBlock: UNIVERSAL_START_BLOCK` in multiple places:
1. In the `MechMarketplace` contract definition
2. In the factory configuration passed to the `OlasMech.address` field

The validation still reports the factory address startBlock as `undefined`.

## Attempts Made

1. **Initial approach**: Used nested object syntax without `factory()` helper
   ```typescript
   address: {
     address: "0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020",
     event: ...,
     parameter: "mech",
     startBlock: UNIVERSAL_START_BLOCK,
   }
   ```

2. **Using `factory()` helper**: Wrapped the configuration with the `factory()` helper function (current state)

3. **Explicit constant**: Used `UNIVERSAL_START_BLOCK` constant instead of variable

All attempts result in the same validation error.

## Factory Type Definition

From `node_modules/ponder/dist/types/config/address.d.ts`:

```typescript
export type Factory<event extends AbiEvent = AbiEvent> = {
    /** Address of the factory contract that creates this contract. */
    address?: `0x${string}` | readonly `0x${string}`[];
    /** ABI event that announces the creation of a new instance of this contract. */
    event: event;
    /** Name of the factory event parameter that contains the new child contract address. */
    parameter: Exclude<ParameterNames<event["inputs"][number]>, undefined>;
    /** From block */
    startBlock?: number | "latest";
    /** To block */
    endBlock?: number | "latest";
};
```

## Questions for Investigation

1. **Is the factory pattern properly supported in Ponder v0.15.12?**
   - Has the API changed in recent versions?
   - Are there known issues with factory validation?

2. **Should the factory contract have a separate contract definition?**
   - Does having `MechMarketplace` as both a standalone contract AND a factory address cause conflicts?
   - Should we remove the `MechMarketplace` contract definition and only use it as a factory?

3. **Is the validation logic correct?**
   - Why is the factory address startBlock reported as `undefined` when explicitly set?
   - Could there be a bug in Ponder's validation code?

4. **Alternative approaches?**
   - Should we use a different pattern (e.g., event-based dynamic registration)?
   - Is there a programmatic API for registering child contracts?

## Resolution Details

**Documentation Reference:**
Ponder factory pattern (via Context7 `/llmstxt/ponder_sh_llms-full_txt`):

```typescript
// ✅ Correct: startBlock at top-level
export default createConfig({
  contracts: {
    SudoswapPool: {
      abi: SudoswapPoolAbi,
      chain: "mainnet",
      address: factory({
        address: "0xb16c1342E617A5B6E4b631EB114483FDB289c0A4",
        event: parseAbiItem("event NewPair(address poolAddress)"),
        parameter: "poolAddress",
      }),
      startBlock: 14645816, // <-- Top-level, not inside factory()
    },
  },
});
```

**Block Range Semantics:**
- **Top-level `startBlock`**: When to start scanning factory events AND when to start indexing child contract events
- **Factory `startBlock`** (optional): Only needed if you want different ranges (e.g., scan historical factory events but index children from "latest")

**Our Case:**
We want uniform behavior (index all Mech events from block 38187727), so only top-level `startBlock` is needed.

## Environment

- **Ponder version**: 0.15.12
- **Node version**: 22.15.0
- **Chain**: Base Mainnet (chain ID 8453)
- **Factory contract**: `0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020`
- **Start block**: 38187727

## Related Files

- Configuration: `ponder/ponder.config.ts`
- Event handlers: `ponder/src/index.ts`
- ABIs: 
  - `ponder/abis/MechMarketplace.json`
  - `@jinn-network/mech-client-ts/dist/abis/AgentMech.json`

