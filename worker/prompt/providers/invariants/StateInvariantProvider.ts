/**
 * StateInvariantProvider - Generates dynamic invariants from progress data
 *
 * This provider creates context-aware invariants that embed specific information
 * about prior work in the workstream, preventing duplication of effort.
 * 
 * Domain: state - Context, prior work, progress
 */

import type {
    InvariantProvider,
    BuildContext,
    BlueprintContext,
    BlueprintBuilderConfig,
    Invariant,
} from '../../types.js';

/**
 * StateInvariantProvider generates invariants from workstream progress
 */
export class StateInvariantProvider implements InvariantProvider {
    name = 'state';

    enabled(config: BlueprintBuilderConfig): boolean {
        return config.enableProgressCheckpoint;
    }

    async provide(
        _ctx: BuildContext,
        builtContext: BlueprintContext
    ): Promise<Invariant[]> {
        const progress = builtContext.progress;

        if (!progress || !progress.summary) {
            return [];
        }

        const invariants: Invariant[] = [];

        invariants.push(this.createMainProgressInvariant(progress.summary));

        if (progress.completedPhases && progress.completedPhases.length > 0) {
            invariants.push(this.createPhasesInvariant(progress.completedPhases));
        }

        return invariants;
    }

    private createMainProgressInvariant(summary: string): Invariant {
        const truncatedSummary =
            summary.length > 500 ? summary.slice(0, 500) + '...' : summary;

        return {
            id: 'STATE-PROGRESS',
            invariant: `Prior work has been completed in this workstream. You MUST NOT repeat this work: ${truncatedSummary}`,
            examples: {
                do: ['Continue from where prior work left off, building upon existing progress'],
                dont: ['Start from scratch ignoring the prior work described above'],
            },
        };
    }

    private createPhasesInvariant(phases: string[]): Invariant {
        const phaseList = phases.join(', ');
        const lastPhase = phases[phases.length - 1] || 'prior phases';

        return {
            id: 'STATE-PHASES',
            invariant: `The following phases have been completed and MUST NOT be repeated: ${phaseList}`,
            examples: {
                do: [`Skip completed phases and continue after: ${lastPhase}`],
                dont: [`Re-run any of: ${phases.slice(0, 2).join(', ')}`],
            },
        };
    }
}
