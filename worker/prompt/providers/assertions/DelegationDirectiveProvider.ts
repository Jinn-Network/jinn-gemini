/**
 * DelegationDirectiveProvider - Injects a strong delegation directive when assertion count is high
 *
 * When job assertions >= threshold, this provider adds a prominent assertion
 * instructing the agent to decompose and delegate rather than execute directly.
 *
 * This addresses the problem where agents attempt to execute many assertions
 * directly instead of breaking them down into focused child jobs.
 */

import type {
  AssertionProvider,
  BuildContext,
  BlueprintContext,
  BlueprintBuilderConfig,
  BlueprintAssertion,
} from '../../types.js';
import type { IpfsMetadata } from '../../../types.js';

const DELEGATION_THRESHOLD = 4;

/**
 * DelegationDirectiveProvider injects a delegation directive when assertion count is high
 */
export class DelegationDirectiveProvider implements AssertionProvider {
  name = 'delegation-directive';
  category = 'system' as const;

  enabled(_config: BlueprintBuilderConfig): boolean {
    return true;
  }

  async provide(
    ctx: BuildContext,
    builtContext: BlueprintContext
  ): Promise<BlueprintAssertion[]> {
    const jobAssertionCount = this.countJobAssertions(ctx.metadata);

    // If we have completed children, the agent is in review mode
    // ChildWorkAssertionProvider handles that case
    const hasCompletedChildren =
      (builtContext.hierarchy?.children?.filter(
        (c) => c.status === 'COMPLETED' || c.status === 'FAILED'
      ) ?? []).length > 0;

    if (hasCompletedChildren) {
      return [];
    }

    // Only inject if above threshold
    if (jobAssertionCount < DELEGATION_THRESHOLD) {
      return [];
    }

    return [
      {
        id: 'SYS-DELEGATE-001',
        category: 'system',
        assertion: `DELEGATION REQUIRED: You have ${jobAssertionCount} job assertions (threshold: ${DELEGATION_THRESHOLD}). You MUST decompose these into atomic sub-assertions and delegate to focused child jobs. Do NOT attempt to execute all assertions directly.`,
        examples: {
          do: [
            'Analyze job assertions and identify logical groupings',
            'Break complex assertions into atomic, independently-testable sub-assertions',
            'Create child jobs with 1-3 focused assertions each using dispatch_new_job',
            'Report DELEGATING status after dispatching children',
          ],
          dont: [
            `Attempt to complete all ${jobAssertionCount} assertions yourself`,
            'Delegate assertions verbatim without decomposing them',
            'Create child jobs with 4+ assertions',
            'Report COMPLETED without having delegated',
          ],
        },
        commentary: `With ${jobAssertionCount} assertions, direct execution would overload a single agent. Decomposition is key: "Implement game X" becomes atomic sub-assertions like "render grid", "handle input", "detect collisions". Each child receives focused, verifiable work. You will be re-dispatched to review their work when they complete.`,
      },
    ];
  }

  /**
   * Count job assertions from metadata.blueprint
   */
  private countJobAssertions(metadata: IpfsMetadata): number {
    if (!metadata?.blueprint) return 0;
    try {
      const blueprint =
        typeof metadata.blueprint === 'string'
          ? JSON.parse(metadata.blueprint)
          : metadata.blueprint;
      return Array.isArray(blueprint.assertions) ? blueprint.assertions.length : 0;
    } catch {
      return 0;
    }
  }
}
