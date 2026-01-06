/**
 * Shared utilities for parsing and displaying invariants (new schema) and assertions (legacy schema)
 * 
 * The backend blueprint system has been refactored:
 * - Old schema: { assertions: [{ id, assertion, ... }] }
 * - New schema: { invariants: [{ id, invariant, measurement?, ... }] }
 * 
 * This module provides backward-compatible utilities for both.
 */

/**
 * Unified type for invariants (new) and assertions (legacy)
 */
export interface InvariantItem {
    id: string;
    /** New schema uses 'invariant' for the statement text */
    invariant?: string;
    /** Legacy schema uses 'assertion' for the statement text */
    assertion?: string;
    /** New field: how to measure/verify this invariant */
    measurement?: string;
    /** Optional description */
    description?: string;
    /** Optional commentary explaining the rationale */
    commentary?: string;
    /** Optional examples of correct and incorrect application */
    examples?: { do?: string[]; dont?: string[] };
}

/**
 * Get the display text for an invariant/assertion item.
 * Prefers 'invariant' (new schema) over 'assertion' (legacy schema).
 */
export function getInvariantText(item: InvariantItem): string | undefined {
    return item.invariant || item.assertion;
}

/**
 * Parse a blueprint JSON and extract invariants/assertions array.
 * Supports both new 'invariants' and legacy 'assertions' keys.
 * 
 * @param blueprintJson - Parsed JSON object from blueprint
 * @returns Array of InvariantItem, or empty array if not found
 */
export function parseInvariants(blueprintJson: unknown): InvariantItem[] {
    if (!blueprintJson || typeof blueprintJson !== 'object') return [];

    const obj = blueprintJson as Record<string, unknown>;
    // Prefer new 'invariants' key, fall back to legacy 'assertions'
    const items = obj.invariants || obj.assertions;

    if (Array.isArray(items)) {
        return items as InvariantItem[];
    }
    return [];
}

/**
 * Check if a parsed blueprint has invariants/assertions
 */
export function hasInvariants(blueprintJson: unknown): boolean {
    return parseInvariants(blueprintJson).length > 0;
}
