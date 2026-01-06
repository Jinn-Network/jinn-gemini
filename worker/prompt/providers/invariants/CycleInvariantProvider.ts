/**
 * CycleInvariantProvider - Injects cyclic operation directive for continuous jobs
 *
 * When a job is marked as cyclic and is re-dispatched for a new cycle,
 * this provider injects invariants that instruct the agent to reassess
 * all JOB invariants and dispatch work as needed to ensure ongoing satisfaction.
 *
 * Domain: cycle - Continuous/ongoing operation
 */

import type {
    InvariantProvider,
    BuildContext,
    BlueprintContext,
    BlueprintBuilderConfig,
    Invariant,
} from '../../types.js';

/**
 * CycleInvariantProvider injects cyclic operation directive when cycleRun is set
 */
export class CycleInvariantProvider implements InvariantProvider {
    name = 'cycle';

    enabled(_config: BlueprintBuilderConfig): boolean {
        return true;
    }

    async provide(
        ctx: BuildContext,
        _builtContext: BlueprintContext
    ): Promise<Invariant[]> {
        const additionalContext = ctx.metadata.additionalContext;
        const cycleInfo = additionalContext?.cycle;

        // Only inject if this is a cycle run
        if (!cycleInfo?.isCycleRun) {
            return [];
        }

        const cycleNumber = cycleInfo.cycleNumber ?? 1;
        const previousCycleCompletedAt = cycleInfo.previousCycleCompletedAt;

        const invariants: Invariant[] = [
            {
                id: 'CYCLE-001',
                invariant: `CYCLIC OPERATION (Cycle ${cycleNumber}): This job's invariants represent ongoing requirements that must remain satisfied. Evaluate current state and take whatever action is needed—direct work, delegation for assessment, or delegation for remediation.`,
                examples: {
                    do: [
                        'Dispatch child jobs to assess invariant satisfaction if assessment is complex',
                        'Dispatch child jobs to remediate unsatisfied invariants',
                        'Perform direct assessment and work if straightforward',
                    ],
                    dont: [
                        'Assume previous cycle state is still valid without checking',
                        'Report COMPLETED without addressing invariants that need attention',
                    ],
                },
            },
            {
                id: 'CYCLE-002',
                invariant: `CYCLE CONTEXT: Previous cycle completed at ${previousCycleCompletedAt || 'unknown'}. Build on prior work rather than starting fresh.`,
                examples: {
                    do: [
                        'Review artifacts and hierarchy from previous cycles',
                        'Continue or extend work from prior cycles where appropriate',
                    ],
                    dont: [
                        'Duplicate work already completed in previous cycles',
                    ],
                },
            },
        ];

        return invariants;
    }
}
