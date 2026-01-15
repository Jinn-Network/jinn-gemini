/**
 * Invariant utilities for app frontend.
 *
 * Re-exports shared utilities from @jinn/shared-ui and provides
 * app-specific functions for matching invariants with measurements.
 */

import type { Artifact } from '@jinn/shared-ui';

// Re-export shared types and utilities
export {
  // Types
  type Invariant,
  type FloorInvariant,
  type CeilingInvariant,
  type RangeInvariant,
  type BooleanInvariant,
  type LegacyInvariant,
  type InvariantType,
  type InvariantMeasurement,
  type StructuredMeasurement,
  type HealthStatus,
  type InvariantWithMeasurement,

  // Type guards
  isFloorInvariant,
  isCeilingInvariant,
  isRangeInvariant,
  isBooleanInvariant,
  isNewInvariant,
  isLegacyInvariant,

  // Parsing utilities
  parseInvariants,
  hasInvariants,
  parseMeasurement as parseStructuredMeasurement,
  toInvariantMeasurement,

  // Display utilities
  getInvariantDisplayText,
  getLegacyInvariantText,
  renderInvariantAsProse,

  // Health status utilities
  determineHealthStatus,
  countByStatus,

  // Badge colors
  invariantTypeBadgeColors,
  healthStatusColors,
  getInvariantTypeBadgeColor,
  getHealthStatusColor,
} from '@jinn/shared-ui';

import type {
  Invariant,
  LegacyInvariant,
  InvariantMeasurement,
  HealthStatus,
} from '@jinn/shared-ui';

import {
  getInvariantDisplayText,
  determineHealthStatus,
  parseMeasurement as sharedParseMeasurement,
  toInvariantMeasurement,
} from '@jinn/shared-ui';

// Alias for backwards compatibility
export type InvariantItem = Invariant | LegacyInvariant;

// Alias for backwards compatibility
export { getInvariantDisplayText as getInvariantText };

/**
 * Combined invariant with its latest measurement (app-specific format)
 */
export interface AppInvariantWithMeasurement {
  id: string;
  invariant: Invariant | LegacyInvariant;
  text: string;
  measurement?: InvariantMeasurement;
  latestScore?: number | boolean;
  latestContext?: string;
  lastMeasuredAt?: string;
  status: HealthStatus;
}

/**
 * Parse measurement from artifact contentPreview JSON.
 * Uses shared parseMeasurement and converts to InvariantMeasurement format.
 */
export function parseMeasurement(artifact: Artifact): InvariantMeasurement | null {
  const structured = sharedParseMeasurement(artifact);
  if (!structured) return null;
  return toInvariantMeasurement(structured);
}

/**
 * Match invariants with their latest measurements from artifacts.
 * Returns app-specific format with combined data.
 */
export function matchInvariantsWithMeasurements(
  invariants: (Invariant | LegacyInvariant)[],
  artifacts: Artifact[]
): AppInvariantWithMeasurement[] {
  // Parse all measurements from artifacts
  const measurements = new Map<string, InvariantMeasurement>();
  for (const artifact of artifacts) {
    const measurement = parseMeasurement(artifact);
    if (measurement) {
      // Keep the latest measurement (artifacts are sorted desc by timestamp)
      if (!measurements.has(measurement.invariantId)) {
        measurements.set(measurement.invariantId, measurement);
      }
    }
  }

  // Match each invariant with its measurement
  return invariants.map(inv => {
    const measurement = measurements.get(inv.id);
    const status = determineHealthStatus(inv, measurement);
    return {
      id: inv.id,
      invariant: inv,
      text: getInvariantDisplayText(inv),
      measurement,
      latestScore: measurement?.score,
      latestContext: measurement?.context,
      lastMeasuredAt: measurement?.timestamp,
      status
    };
  });
}

/**
 * Count invariants by status (app-specific format).
 */
export function countAppInvariantsByStatus(
  invariants: AppInvariantWithMeasurement[]
): Record<HealthStatus, number> {
  const counts: Record<HealthStatus, number> = {
    healthy: 0,
    warning: 0,
    critical: 0,
    unknown: 0
  };

  for (const inv of invariants) {
    counts[inv.status]++;
  }

  return counts;
}
