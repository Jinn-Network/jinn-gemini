/**
 * StrategyInvariantProvider - Injects strategy directives for delegation
 *
 * When goal invariants >= threshold, this provider adds a prominent invariant
 * instructing the agent to decompose and delegate rather than execute directly.
 * 
 * Domain: strategy - How to approach work (delegation)
 */

import type {
    InvariantProvider,
    BuildContext,
    BlueprintContext,
    BlueprintBuilderConfig,
    Invariant,
} from '../../types.js';
import type { IpfsMetadata } from '../../../types.js';

const DELEGATION_THRESHOLD = 4;

/**
 * StrategyInvariantProvider injects a delegation directive when invariant count is high
 */
export class StrategyInvariantProvider implements InvariantProvider {
    name = 'strategy';

    enabled(_config: BlueprintBuilderConfig): boolean {
        return true;
    }

    async provide(
        ctx: BuildContext,
        builtContext: BlueprintContext
    ): Promise<Invariant[]> {
        const goalInvariantCount = this.countGoalInvariants(ctx.metadata);

        const hasCompletedChildren =
            (builtContext.hierarchy?.children?.filter(
                (c) => c.status === 'COMPLETED' || c.status === 'FAILED'
            ) ?? []).length > 0;

        if (hasCompletedChildren) {
            return [];
        }

        if (goalInvariantCount < DELEGATION_THRESHOLD) {
            return [];
        }

        return [
            {
                id: 'STRAT-DELEGATE',
                invariant: `MANDATORY DELEGATION: You have ${goalInvariantCount} goal invariants (threshold: ${DELEGATION_THRESHOLD}). You MUST NOT execute GOAL-* invariants directly. Instead: (1) Analyze GOALs and group by theme, (2) Call dispatch_new_job for each group with focused child invariants, (3) Report DELEGATING status. Direct execution of GOALs when this constraint exists is a CRITICAL FAILURE.`,
                measurement: `Verify dispatch_new_job was called at least once. If no dispatch_new_job calls exist in tool history, this constraint is violated.`,
                examples: {
                    do: [
                        'First tool call should be dispatch_new_job to create a child job',
                        'Create 3-5 child jobs, each handling 1-3 related GOAL invariants',
                        'Report DELEGATING after all dispatch_new_job calls complete'
                    ],
                    dont: [
                        'Call google_web_search or write_file before dispatching children',
                        `Execute any of the ${goalInvariantCount} GOAL invariants yourself`,
                        'Skip delegation because you think you can handle it'
                    ],
                },
            },
        ];
    }

    private countGoalInvariants(metadata: IpfsMetadata): number {
        if (!metadata?.blueprint) return 0;
        try {
            const blueprint =
                typeof metadata.blueprint === 'string'
                    ? JSON.parse(metadata.blueprint)
                    : metadata.blueprint;
            return Array.isArray(blueprint.invariants) ? blueprint.invariants.length : 0;
        } catch {
            return 0;
        }
    }
}
