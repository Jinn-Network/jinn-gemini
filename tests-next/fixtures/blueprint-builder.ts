/**
 * Test data builders for blueprint structures
 * Used across unit, integration, and system tests for Phase 1 verification
 */

import type { Invariant } from '../../worker/prompt/types.js';

export interface BlueprintStructure {
  invariants: Invariant[];
}

/**
 * Build a complete blueprint JSON string from invariants array
 */
export function buildTestBlueprint(invariants: Invariant[]): string {
  return JSON.stringify({ invariants });
}

/**
 * Build a minimal valid invariant for testing
 */
export function buildMinimalInvariant(id: string): Invariant {
  return {
    id,
    invariant: `Test invariant ${id}`,
    examples: {
      do: ['Example positive behavior'],
      dont: ['Example negative behavior'],
    },
  };
}

/**
 * Build an invariant with custom content
 */
export function buildCustomInvariant(
  id: string,
  invariantText: string,
  doExamples: string[],
  dontExamples: string[]
): Invariant {
  return {
    id,
    invariant: invariantText,
    examples: {
      do: doExamples,
      dont: dontExamples,
    },
  };
}

/**
 * Build a complete multi-invariant blueprint for complex tests
 */
export function buildMultiInvariantBlueprint(count: number): string {
  const invariants: Invariant[] = [];
  for (let i = 1; i <= count; i++) {
    invariants.push(buildMinimalInvariant(`JOB-${String(i).padStart(3, '0')}`));
  }
  return buildTestBlueprint(invariants);
}

/**
 * Build an invalid blueprint for negative testing
 */
export function buildInvalidBlueprint(issue: 'missing-id' | 'missing-description' | 'invalid-structure'): string {
  switch (issue) {
    case 'missing-id':
      return JSON.stringify({
        invariants: [{
          invariant: 'Test invariant',
          examples: { do: ['example'], dont: ['example'] },
        }],
      });
    case 'missing-description':
      return JSON.stringify({
        invariants: [{
          id: 'JOB-001',
          // Missing 'invariant' field
          examples: { do: ['example'], dont: ['example'] },
        }],
      });
    case 'invalid-structure':
      return JSON.stringify({
        notInvariants: 'invalid',
      });
    default:
      return '{}';
  }
}

/**
 * Parse blueprint JSON string back to structure (for testing round-trip)
 */
export function parseBlueprint(blueprintJson: string): BlueprintStructure {
  return JSON.parse(blueprintJson);
}

// Legacy exports for backwards compatibility with existing tests
export { buildMinimalInvariant as buildMinimalAssertion };
export { buildCustomInvariant as buildCustomAssertion };
export { buildMultiInvariantBlueprint as buildMultiAssertionBlueprint };
export type BlueprintAssertion = Invariant;

