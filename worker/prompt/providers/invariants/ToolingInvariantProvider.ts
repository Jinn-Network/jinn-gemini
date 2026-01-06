/**
 * ToolingInvariantProvider - Provides beads issue tracking invariants for coding jobs
 *
 * This provider injects instructions for using the beads (bd) CLI for issue tracking
 * during coding work. It's only enabled when:
 * 1. config.enableBeadsAssertions is true
 * 2. The job has codeMetadata (is a coding job)
 * 
 * Domain: tooling - Tool-specific workflows (beads)
 */

import type {
    InvariantProvider,
    BuildContext,
    BlueprintContext,
    BlueprintBuilderConfig,
    Invariant,
} from '../../types.js';

/**
 * ToolingInvariantProvider provides beads issue tracking workflow instructions
 */
export class ToolingInvariantProvider implements InvariantProvider {
    name = 'tooling';

    enabled(config: BlueprintBuilderConfig): boolean {
        return config.enableBeadsAssertions;
    }

    async provide(
        ctx: BuildContext,
        _builtContext: BlueprintContext
    ): Promise<Invariant[]> {
        if (!ctx.metadata.codeMetadata) {
            return [];
        }

        return [{
            id: 'TOOL-BEADS',
            invariant: 'I use beads (bd CLI) for issue tracking. At start: bd ready --json. During work: claim issues, create discoveries. At end: bd close and commit .beads/issues.jsonl with code.',
            examples: {
                do: [`Run 'bd ready --json' at start, 'bd close <id> --reason "Done" --json' at end, commit .beads/issues.jsonl`],
                dont: ['Create markdown TODO lists instead of using beads'],
            },
        }];
    }
}
