/**
 * RecoveryInvariantProvider - Injects loop recovery directive after loop termination
 *
 * When a job is re-dispatched after loop protection terminated the previous run,
 * this provider injects a strong invariant with context about what went wrong
 * and guidance for approaching the task differently.
 * 
 * Domain: recovery - Error handling, loop recovery
 */

import type {
    InvariantProvider,
    BuildContext,
    BlueprintContext,
    BlueprintBuilderConfig,
    Invariant,
} from '../../types.js';

const MAX_LOOP_RECOVERY_ATTEMPTS = 3;

/**
 * RecoveryInvariantProvider injects recovery directive when loopRecovery is set
 */
export class RecoveryInvariantProvider implements InvariantProvider {
    name = 'recovery';

    enabled(_config: BlueprintBuilderConfig): boolean {
        return true;
    }

    async provide(
        ctx: BuildContext,
        _builtContext: BlueprintContext
    ): Promise<Invariant[]> {
        const additionalContext = ctx.metadata.additionalContext;
        const loopRecovery = additionalContext?.loopRecovery;

        if (!loopRecovery) {
            return [];
        }

        const attempt = loopRecovery.attempt ?? 1;
        const isLastAttempt = attempt >= MAX_LOOP_RECOVERY_ATTEMPTS;
        const loopMessage = loopRecovery.loopMessage || 'Previous run terminated due to unproductive loop';

        const invariants: Invariant[] = [
            {
                id: 'RECOV-LOOP',
                invariant: `LOOP RECOVERY (attempt ${attempt}/${MAX_LOOP_RECOVERY_ATTEMPTS}): Previous run was terminated because: "${loopMessage}". You MUST approach this task differently.`,
                examples: {
                    do: ['Verify CURRENT state of files before making changes; if already correct, acknowledge and move on'],
                    dont: ['Repeat the same sequence of actions that caused the loop'],
                },
            },
        ];

        if (isLastAttempt) {
            invariants.push({
                id: 'RECOV-FINAL',
                invariant: `FINAL LOOP RECOVERY ATTEMPT: If you cannot complete the task without entering a loop, report FAILED with an explanation.`,
                examples: {
                    do: ['If genuinely blocked, report FAILED with specifics about what is preventing completion'],
                    dont: ['Enter another loop on the final attempt'],
                },
            });
        }

        return invariants;
    }
}
