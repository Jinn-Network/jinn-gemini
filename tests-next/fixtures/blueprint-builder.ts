/**
 * Test data builders for blueprint structures
 * Used across unit, integration, and system tests for Phase 1 verification
 */

export interface BlueprintAssertion {
  id: string;
  assertion: string;
  examples: {
    do: string[];
    dont: string[];
  };
  commentary: string;
}

export interface BlueprintStructure {
  assertions: BlueprintAssertion[];
}

/**
 * Build a complete blueprint JSON string from assertions array
 */
export function buildTestBlueprint(assertions: BlueprintAssertion[]): string {
  return JSON.stringify({ assertions });
}

/**
 * Build a minimal valid assertion for testing
 */
export function buildMinimalAssertion(id: string): BlueprintAssertion {
  return {
    id,
    assertion: `Test assertion ${id}`,
    examples: {
      do: ['Example positive behavior'],
      dont: ['Example negative behavior'],
    },
    commentary: `Test commentary for ${id}`,
  };
}

/**
 * Build an assertion with custom content
 */
export function buildCustomAssertion(
  id: string,
  assertion: string,
  doExamples: string[],
  dontExamples: string[],
  commentary: string
): BlueprintAssertion {
  return {
    id,
    assertion,
    examples: {
      do: doExamples,
      dont: dontExamples,
    },
    commentary,
  };
}

/**
 * Build a complete multi-assertion blueprint for complex tests
 */
export function buildMultiAssertionBlueprint(count: number): string {
  const assertions: BlueprintAssertion[] = [];
  for (let i = 1; i <= count; i++) {
    assertions.push(buildMinimalAssertion(`TEST-${String(i).padStart(3, '0')}`));
  }
  return buildTestBlueprint(assertions);
}

/**
 * Build an invalid blueprint for negative testing
 */
export function buildInvalidBlueprint(issue: 'missing-id' | 'missing-assertion' | 'missing-examples' | 'missing-commentary' | 'invalid-structure'): string {
  switch (issue) {
    case 'missing-id':
      return JSON.stringify({
        assertions: [{
          assertion: 'Test assertion',
          examples: { do: ['example'], dont: ['example'] },
          commentary: 'Test commentary',
        }],
      });
    case 'missing-assertion':
      return JSON.stringify({
        assertions: [{
          id: 'TEST-001',
          examples: { do: ['example'], dont: ['example'] },
          commentary: 'Test commentary',
        }],
      });
    case 'missing-examples':
      return JSON.stringify({
        assertions: [{
          id: 'TEST-001',
          assertion: 'Test assertion',
          commentary: 'Test commentary',
        }],
      });
    case 'missing-commentary':
      return JSON.stringify({
        assertions: [{
          id: 'TEST-001',
          assertion: 'Test assertion',
          examples: { do: ['example'], dont: ['example'] },
        }],
      });
    case 'invalid-structure':
      return JSON.stringify({
        notAssertions: 'invalid',
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

