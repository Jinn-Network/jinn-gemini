/**
 * Invariant Utilities
 *
 * Parsing, rendering, and health status functions for invariants.
 */

import type {
  Invariant,
  LegacyInvariant,
  InvariantType,
  InvariantMeasurement,
  StructuredMeasurement,
  HealthStatus,
  FloorInvariant,
  CeilingInvariant,
  RangeInvariant,
  BooleanInvariant,
} from './invariant-types';

import {
  isFloorInvariant,
  isCeilingInvariant,
  isRangeInvariant,
  isBooleanInvariant,
  isNewInvariant,
} from './invariant-types';

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse invariants from blueprint JSON.
 * Supports both new 4-type schema and legacy schema.
 */
export function parseInvariants(blueprintJson: unknown): (Invariant | LegacyInvariant)[] {
  if (!blueprintJson || typeof blueprintJson !== 'object') return [];

  const obj = blueprintJson as Record<string, unknown>;
  const items = obj.invariants || obj.assertions;

  if (Array.isArray(items)) {
    return items as (Invariant | LegacyInvariant)[];
  }
  return [];
}

/**
 * Check if blueprint has invariants.
 */
export function hasInvariants(blueprintJson: unknown): boolean {
  return parseInvariants(blueprintJson).length > 0;
}

// ============================================================================
// Display Text
// ============================================================================

/**
 * Get the primary display text for any invariant type.
 */
export function getInvariantDisplayText(inv: Invariant | LegacyInvariant): string {
  if (isNewInvariant(inv)) {
    if (isBooleanInvariant(inv)) {
      return inv.condition;
    }
    // For metric-based types, construct a readable description
    if (isFloorInvariant(inv)) {
      return `${inv.metric} must be at least ${inv.min}`;
    }
    if (isCeilingInvariant(inv)) {
      return `${inv.metric} must be at most ${inv.max}`;
    }
    if (isRangeInvariant(inv)) {
      return `${inv.metric} must be between ${inv.min} and ${inv.max}`;
    }
  }

  // Legacy invariant
  const legacy = inv as LegacyInvariant;
  return legacy.invariant || legacy.assertion || '';
}

/**
 * Get legacy invariant text (for backward compatibility).
 */
export function getLegacyInvariantText(inv: LegacyInvariant): string {
  return inv.invariant || inv.assertion || '';
}

// ============================================================================
// Prose Rendering
// ============================================================================

/**
 * Render an invariant as natural language prose for LLM consumption.
 */
export function renderInvariantAsProse(inv: Invariant | LegacyInvariant): string {
  if (!isNewInvariant(inv)) {
    const legacy = inv as LegacyInvariant;
    let prose = `[${legacy.id}] ${getLegacyInvariantText(legacy)}`;
    if (legacy.measurement) {
      prose += `\nMeasurement: ${legacy.measurement}`;
    }
    return prose;
  }

  const lines: string[] = [];

  if (isFloorInvariant(inv)) {
    lines.push(`[${inv.id}] FLOOR constraint: ${inv.metric} must be at least ${inv.min}.`);
    lines.push(`Assessment: ${inv.assessment}`);
  } else if (isCeilingInvariant(inv)) {
    lines.push(`[${inv.id}] CEILING constraint: ${inv.metric} must not exceed ${inv.max}.`);
    lines.push(`Assessment: ${inv.assessment}`);
  } else if (isRangeInvariant(inv)) {
    lines.push(`[${inv.id}] RANGE constraint: ${inv.metric} must be between ${inv.min} and ${inv.max}.`);
    lines.push(`Assessment: ${inv.assessment}`);
  } else if (isBooleanInvariant(inv)) {
    lines.push(`[${inv.id}] BOOLEAN constraint: ${inv.condition}`);
    lines.push(`Assessment: ${inv.assessment}`);
  }

  if (inv.examples) {
    if (inv.examples.do && inv.examples.do.length > 0) {
      lines.push(`Do: ${inv.examples.do.join('; ')}`);
    }
    if (inv.examples.dont && inv.examples.dont.length > 0) {
      lines.push(`Don't: ${inv.examples.dont.join('; ')}`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Health Status
// ============================================================================

/**
 * Determine health status based on invariant type and measurement.
 */
export function determineHealthStatus(
  inv: Invariant | LegacyInvariant,
  measurement?: InvariantMeasurement
): HealthStatus {
  if (!measurement) return 'unknown';

  const { score } = measurement;

  // Boolean score
  if (typeof score === 'boolean') {
    return score ? 'healthy' : 'critical';
  }

  // Numeric score with type-specific thresholds
  if (isNewInvariant(inv)) {
    if (isFloorInvariant(inv)) {
      if (score >= inv.min) return 'healthy';
      if (score >= inv.min * 0.8) return 'warning';
      return 'critical';
    }

    if (isCeilingInvariant(inv)) {
      if (score <= inv.max) return 'healthy';
      if (score <= inv.max * 1.2) return 'warning';
      return 'critical';
    }

    if (isRangeInvariant(inv)) {
      if (score >= inv.min && score <= inv.max) return 'healthy';
      const range = inv.max - inv.min;
      const buffer = range * 0.1;
      if (score >= inv.min - buffer && score <= inv.max + buffer) return 'warning';
      return 'critical';
    }

    // Boolean type but numeric score - treat as percentage
    if (isBooleanInvariant(inv)) {
      if (score >= 70) return 'healthy';
      if (score >= 40) return 'warning';
      return 'critical';
    }
  }

  // Legacy or unknown - use default thresholds
  if (score >= 70) return 'healthy';
  if (score >= 40) return 'warning';
  return 'critical';
}

/**
 * Count invariants by health status.
 */
export function countByStatus(
  items: Array<{ status: HealthStatus }>
): Record<HealthStatus, number> {
  const counts: Record<HealthStatus, number> = {
    healthy: 0,
    warning: 0,
    critical: 0,
    unknown: 0,
  };

  for (const item of items) {
    counts[item.status]++;
  }

  return counts;
}

// ============================================================================
// Type Badge Colors
// ============================================================================

export const invariantTypeBadgeColors: Record<InvariantType, string> = {
  FLOOR: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  CEILING: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  RANGE: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  BOOLEAN: 'bg-green-500/10 text-green-500 border-green-500/20',
};

export const healthStatusColors: Record<HealthStatus, string> = {
  healthy: 'bg-green-500/10 text-green-500 border-green-500/20',
  warning: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  critical: 'bg-red-500/10 text-red-500 border-red-500/20',
  unknown: 'bg-muted text-muted-foreground border-muted',
};

/**
 * Get badge color for invariant type.
 */
export function getInvariantTypeBadgeColor(type: InvariantType): string {
  return invariantTypeBadgeColors[type] || 'bg-muted text-muted-foreground';
}

/**
 * Get badge color for health status.
 */
export function getHealthStatusColor(status: HealthStatus): string {
  return healthStatusColors[status];
}

// ============================================================================
// Measurement Parsing
// ============================================================================

/**
 * Minimal artifact shape needed for measurement parsing.
 * Compatible with both Ponder and subgraph artifact types.
 */
export type MeasurementArtifact = {
  id: string;
  contentPreview?: string | null;
  blockTimestamp?: string | bigint | null;
};

/**
 * Type guard for structured measurement format (from create_measurement tool).
 */
function isStructuredMeasurement(data: unknown): data is StructuredMeasurement {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.invariant_id === 'string' &&
    typeof obj.invariant_type === 'string' &&
    ['FLOOR', 'CEILING', 'RANGE', 'BOOLEAN', 'DELEGATED'].includes(obj.invariant_type as string) &&
    typeof obj.passed === 'boolean'
  );
}

/**
 * Parse measurement from artifact contentPreview JSON.
 * Supports both new structured format and legacy format.
 *
 * @param artifact - Artifact with contentPreview field
 * @returns StructuredMeasurement if valid, null otherwise
 */
export function parseMeasurement(artifact: MeasurementArtifact): StructuredMeasurement | null {
  if (!artifact.contentPreview) return null;

  try {
    const data = JSON.parse(artifact.contentPreview);

    // Handle new structured format (from create_measurement tool)
    if (isStructuredMeasurement(data)) {
      return {
        ...data,
        timestamp: artifact.blockTimestamp
          ? typeof artifact.blockTimestamp === 'bigint'
            ? new Date(Number(artifact.blockTimestamp) * 1000).toISOString()
            : artifact.blockTimestamp
          : undefined,
      };
    }

    // Handle legacy format (from create_artifact with manual JSON)
    if (data.invariant_id && (data.score !== undefined || data.passed !== undefined)) {
      const score = data.score ?? data.passed;
      const passed = typeof score === 'boolean' ? score : (score >= 0); // Assume positive scores pass

      return {
        invariant_id: data.invariant_id,
        invariant_type: typeof score === 'boolean' ? 'BOOLEAN' : 'FLOOR', // Infer type from score
        score,
        passed,
        context: data.context || '',
        timestamp: artifact.blockTimestamp
          ? typeof artifact.blockTimestamp === 'bigint'
            ? new Date(Number(artifact.blockTimestamp) * 1000).toISOString()
            : artifact.blockTimestamp
          : undefined,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Convert StructuredMeasurement to InvariantMeasurement for compatibility.
 */
export function toInvariantMeasurement(structured: StructuredMeasurement): InvariantMeasurement {
  return {
    invariantId: structured.invariant_id,
    score: structured.score,
    context: structured.context,
    timestamp: structured.timestamp || new Date().toISOString(),
  };
}
