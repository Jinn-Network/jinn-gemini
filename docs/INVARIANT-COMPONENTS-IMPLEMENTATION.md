# Shared Invariant Display Components Implementation

## Overview

This document summarizes the implementation of shared invariant display components for the 4-type invariant schema (FLOOR, CEILING, RANGE, BOOLEAN) in `packages/shared-ui`, with integration into both `frontend/explorer` and `frontend/app`.

## New Invariant Schema

The system now supports four invariant types with distinct semantics:

```typescript
// FLOOR: Minimum threshold constraint
interface FloorInvariant {
  id: string;
  type: 'FLOOR';
  metric: string;      // What is being measured
  min: number;         // Minimum acceptable value
  assessment: string;  // How to evaluate
  examples?: { do: string[]; dont: string[] };
}

// CEILING: Maximum threshold constraint
interface CeilingInvariant {
  id: string;
  type: 'CEILING';
  metric: string;
  max: number;         // Maximum acceptable value
  assessment: string;
  examples?: { do: string[]; dont: string[] };
}

// RANGE: Min-max bounded constraint
interface RangeInvariant {
  id: string;
  type: 'RANGE';
  metric: string;
  min: number;
  max: number;
  assessment: string;
  examples?: { do: string[]; dont: string[] };
}

// BOOLEAN: Pass/fail condition
interface BooleanInvariant {
  id: string;
  type: 'BOOLEAN';
  condition: string;   // The condition to evaluate
  assessment: string;
  examples?: { do: string[]; dont: string[] };
}
```

## Architecture

```
packages/shared-ui/src/
├── lib/
│   ├── invariant-types.ts    # Type definitions & type guards
│   └── invariant-utils.ts    # Parsing, rendering, health status
├── components/
│   └── invariants/
│       ├── index.ts              # Barrel exports
│       ├── FloorInvariantCard.tsx
│       ├── CeilingInvariantCard.tsx
│       ├── RangeInvariantCard.tsx
│       ├── BooleanInvariantCard.tsx
│       ├── LegacyInvariantCard.tsx
│       ├── InvariantCard.tsx     # Dispatcher component
│       └── InvariantList.tsx     # List with health summary
└── index.ts                      # Package exports
```

## Type Badge Colors

| Type | Color | CSS Class |
|------|-------|-----------|
| FLOOR | Purple | `bg-purple-500/10 text-purple-500 border-purple-500/20` |
| CEILING | Orange | `bg-orange-500/10 text-orange-500 border-orange-500/20` |
| RANGE | Blue | `bg-blue-500/10 text-blue-500 border-blue-500/20` |
| BOOLEAN | Green | `bg-green-500/10 text-green-500 border-green-500/20` |

## Health Status Colors

| Status | Color | Meaning |
|--------|-------|---------|
| healthy | Green | Invariant passing |
| warning | Yellow | Near threshold |
| critical | Red | Invariant failing |
| unknown | Gray | No measurement data |

## Files Created

### Shared UI Package

| File | Description |
|------|-------------|
| `packages/shared-ui/src/lib/invariant-types.ts` | Type definitions for all invariant types, type guards, measurement types |
| `packages/shared-ui/src/lib/invariant-utils.ts` | `parseInvariants()`, `getInvariantDisplayText()`, `renderInvariantAsProse()`, `determineHealthStatus()`, `countByStatus()` |
| `packages/shared-ui/src/components/invariants/FloorInvariantCard.tsx` | Card for FLOOR type invariants |
| `packages/shared-ui/src/components/invariants/CeilingInvariantCard.tsx` | Card for CEILING type invariants |
| `packages/shared-ui/src/components/invariants/RangeInvariantCard.tsx` | Card for RANGE type invariants |
| `packages/shared-ui/src/components/invariants/BooleanInvariantCard.tsx` | Card for BOOLEAN type invariants |
| `packages/shared-ui/src/components/invariants/LegacyInvariantCard.tsx` | Card for legacy invariants (backward compatibility) |
| `packages/shared-ui/src/components/invariants/InvariantCard.tsx` | Dispatcher that routes to appropriate type-specific card |
| `packages/shared-ui/src/components/invariants/InvariantList.tsx` | Renders list of invariants with health summary |
| `packages/shared-ui/src/components/invariants/index.ts` | Barrel exports for all invariant components |

## Files Modified

### Explorer Frontend

| File | Changes |
|------|---------|
| `frontend/explorer/src/lib/invariant-utils.ts` | Replaced with re-exports from `@jinn/shared-ui`, added backward compatibility aliases |
| `frontend/explorer/src/components/invariant-display.tsx` | Updated to use shared `InvariantCard` component |
| `frontend/explorer/src/components/job-definition-sections/blueprint-tools.tsx` | Updated to use shared `InvariantCard` component |
| `frontend/explorer/src/components/job-definition-sections/overview.tsx` | Updated to use `getInvariantDisplayText()` |
| `frontend/explorer/src/components/job-phases/job-detail-layout.tsx` | Replaced inline rendering with shared `InvariantCard` |

### App Frontend

| File | Changes |
|------|---------|
| `frontend/app/src/lib/invariant-utils.ts` | Re-exports from shared-ui, keeps app-specific `matchInvariantsWithMeasurements()` and `parseMeasurement()` |
| `frontend/app/src/components/dashboard/InvariantList.tsx` | Updated to use shared `InvariantCard` with compact mode |
| `frontend/app/src/components/dashboard/HealthSummary.tsx` | Updated to use shared `HealthStatus` type |

## Usage Examples

### Basic InvariantCard

```tsx
import { InvariantCard } from '@jinn/shared-ui';

// Simple usage - just pass the invariant
<InvariantCard invariant={invariant} />

// With measurement and status
<InvariantCard
  invariant={invariant}
  measurement={measurement}
  status="healthy"
/>

// Compact mode for lists
<InvariantCard
  invariant={invariant}
  compact={true}
/>
```

### InvariantList with Health Summary

```tsx
import { InvariantList } from '@jinn/shared-ui';

// With measurements map
const measurements = new Map<string, InvariantMeasurement>();
measurements.set('INV-001', { invariantId: 'INV-001', score: 85, timestamp: '...' });

<InvariantList
  invariants={invariants}
  measurements={measurements}
  showSummary={true}
/>
```

### Parsing Invariants from Blueprint

```tsx
import { parseInvariants, getInvariantDisplayText } from '@jinn/shared-ui';

const blueprint = JSON.parse(blueprintJson);
const invariants = parseInvariants(blueprint);

for (const inv of invariants) {
  console.log(getInvariantDisplayText(inv));
}
```

### Type Guards

```tsx
import {
  isFloorInvariant,
  isCeilingInvariant,
  isRangeInvariant,
  isBooleanInvariant,
  isNewInvariant,
  isLegacyInvariant,
} from '@jinn/shared-ui';

if (isFloorInvariant(inv)) {
  console.log(`Minimum: ${inv.min}`);
} else if (isRangeInvariant(inv)) {
  console.log(`Range: ${inv.min} - ${inv.max}`);
}
```

### Health Status Determination

```tsx
import { determineHealthStatus } from '@jinn/shared-ui';

const status = determineHealthStatus(invariant, measurement);
// Returns: 'healthy' | 'warning' | 'critical' | 'unknown'
```

## Backward Compatibility

The implementation maintains backward compatibility with the legacy invariant schema:

```typescript
interface LegacyInvariant {
  id: string;
  invariant?: string;   // Legacy field
  assertion?: string;   // Older legacy field
  measurement?: string;
  description?: string;
  commentary?: string;
  examples?: { do?: string[]; dont?: string[] };
}
```

The `InvariantCard` dispatcher automatically routes legacy invariants to `LegacyInvariantCard`.

## Build Verification

Both frontends build successfully:

```bash
# Explorer frontend
cd frontend/explorer && yarn build
# ✓ Compiled successfully

# App frontend
cd frontend/app && yarn build
# ✓ Compiled successfully
```

## Branch

Implementation on branch: `feature/olas-jin-staking-contract` (based on `feat/invariant-redesign`)
