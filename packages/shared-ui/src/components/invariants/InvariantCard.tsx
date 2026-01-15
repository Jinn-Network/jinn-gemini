'use client';

import type { Invariant, LegacyInvariant, InvariantMeasurement, HealthStatus } from '../../lib/invariant-types';
import {
  isFloorInvariant,
  isCeilingInvariant,
  isRangeInvariant,
  isBooleanInvariant,
  isNewInvariant,
} from '../../lib/invariant-types';
import { determineHealthStatus } from '../../lib/invariant-utils';

import { FloorInvariantCard } from './FloorInvariantCard';
import { CeilingInvariantCard } from './CeilingInvariantCard';
import { RangeInvariantCard } from './RangeInvariantCard';
import { BooleanInvariantCard } from './BooleanInvariantCard';
import { LegacyInvariantCard } from './LegacyInvariantCard';

export interface InvariantCardProps {
  invariant: Invariant | LegacyInvariant;
  measurement?: InvariantMeasurement;
  status?: HealthStatus;
  compact?: boolean;
  className?: string;
}

/**
 * Dispatcher component that renders the appropriate card type
 * based on the invariant's type field.
 */
export function InvariantCard({
  invariant,
  measurement,
  status,
  compact = false,
  className,
}: InvariantCardProps) {
  // Calculate status if not provided
  const resolvedStatus = status ?? determineHealthStatus(invariant, measurement);

  // Dispatch to the appropriate type-specific component
  if (isNewInvariant(invariant)) {
    if (isFloorInvariant(invariant)) {
      return (
        <FloorInvariantCard
          invariant={invariant}
          measurement={measurement}
          status={resolvedStatus}
          compact={compact}
          className={className}
        />
      );
    }

    if (isCeilingInvariant(invariant)) {
      return (
        <CeilingInvariantCard
          invariant={invariant}
          measurement={measurement}
          status={resolvedStatus}
          compact={compact}
          className={className}
        />
      );
    }

    if (isRangeInvariant(invariant)) {
      return (
        <RangeInvariantCard
          invariant={invariant}
          measurement={measurement}
          status={resolvedStatus}
          compact={compact}
          className={className}
        />
      );
    }

    if (isBooleanInvariant(invariant)) {
      return (
        <BooleanInvariantCard
          invariant={invariant}
          measurement={measurement}
          status={resolvedStatus}
          compact={compact}
          className={className}
        />
      );
    }
  }

  // Fall back to legacy card
  return (
    <LegacyInvariantCard
      invariant={invariant as LegacyInvariant}
      measurement={measurement}
      status={resolvedStatus}
      compact={compact}
      className={className}
    />
  );
}
