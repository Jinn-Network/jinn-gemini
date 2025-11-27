/**
 * JobBlueprintProvider - Passes through job-specific assertions
 *
 * This provider extracts assertions from the job's blueprint (metadata.blueprint)
 * and passes them through with category 'job'.
 *
 * Blueprint MUST be valid JSON with an assertions array. Invalid blueprints
 * cause explicit failures per the code spec's fail-fast principle.
 */

import type {
  AssertionProvider,
  BuildContext,
  BlueprintContext,
  BlueprintBuilderConfig,
  BlueprintAssertion,
} from '../../types.js';

/**
 * Expected structure of a job blueprint
 */
interface JobBlueprint {
  assertions: Array<{
    id: string;
    assertion: string;
    examples: {
      do: string[];
      dont: string[];
    };
    commentary: string;
  }>;
}

/**
 * JobBlueprintProvider passes through job assertions from metadata.blueprint
 */
export class JobBlueprintProvider implements AssertionProvider {
  name = 'job-blueprint';
  category = 'job' as const;

  enabled(_config: BlueprintBuilderConfig): boolean {
    return true;
  }

  async provide(
    ctx: BuildContext,
    _builtContext: BlueprintContext
  ): Promise<BlueprintAssertion[]> {
    const blueprintStr = ctx.metadata?.blueprint;

    if (!blueprintStr) {
      // No blueprint is valid - system assertions still apply
      return [];
    }

    // Parse the blueprint JSON - fail fast if invalid
    const blueprint = this.parseBlueprint(blueprintStr, ctx.requestId);

    // Map assertions to BlueprintAssertion format with category 'job'
    return blueprint.assertions.map((assertion) => ({
      id: assertion.id,
      category: 'job' as const,
      assertion: assertion.assertion,
      examples: assertion.examples,
      commentary: assertion.commentary,
    }));
  }

  /**
   * Parse blueprint string to JSON
   * @throws Error if blueprint is not valid JSON or missing assertions array
   */
  private parseBlueprint(blueprintStr: string, requestId: string): JobBlueprint {
    // Blueprint might already be an object (from internal augmentation)
    let blueprint: unknown;
    if (typeof blueprintStr === 'object') {
      blueprint = blueprintStr;
    } else {
      try {
        blueprint = JSON.parse(blueprintStr);
      } catch (error) {
        throw new Error(
          `Invalid blueprint for request ${requestId}: Blueprint must be valid JSON. ` +
            `Got: ${blueprintStr.slice(0, 100)}${blueprintStr.length > 100 ? '...' : ''}`
        );
      }
    }

    // Validate structure
    if (!blueprint || typeof blueprint !== 'object') {
      throw new Error(
        `Invalid blueprint for request ${requestId}: Blueprint must be a JSON object`
      );
    }

    const obj = blueprint as Record<string, unknown>;
    if (!Array.isArray(obj.assertions)) {
      throw new Error(
        `Invalid blueprint for request ${requestId}: Blueprint must have an 'assertions' array. ` +
          `Got keys: ${Object.keys(obj).join(', ')}`
      );
    }

    return blueprint as JobBlueprint;
  }
}
