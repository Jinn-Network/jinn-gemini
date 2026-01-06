/**
 * QualityInvariantProvider - Provides quality-related invariants
 *
 * This provider consolidates:
 * - Verification directive (after child work is merged)
 * - Coding standards (for coding jobs)
 * 
 * Domain: quality - Standards, verification, practices
 */

import type {
    InvariantProvider,
    BuildContext,
    BlueprintContext,
    BlueprintBuilderConfig,
    Invariant,
} from '../../types.js';

const MAX_VERIFICATION_ATTEMPTS = 3;

/**
 * QualityInvariantProvider provides verification and coding standards invariants
 */
export class QualityInvariantProvider implements InvariantProvider {
    name = 'quality';

    enabled(_config: BlueprintBuilderConfig): boolean {
        return true;
    }

    async provide(
        ctx: BuildContext,
        _builtContext: BlueprintContext
    ): Promise<Invariant[]> {
        const invariants: Invariant[] = [];

        invariants.push(...this.getVerificationInvariants(ctx));
        invariants.push(...this.getCodingStandardsInvariants(ctx));

        return invariants;
    }

    private getVerificationInvariants(ctx: BuildContext): Invariant[] {
        const additionalContext = ctx.metadata.additionalContext;
        const verificationRequired = additionalContext?.verificationRequired === true;

        if (!verificationRequired) {
            return [];
        }

        const verificationAttempt = additionalContext?.verificationAttempt ?? 1;
        const isLastAttempt = verificationAttempt >= MAX_VERIFICATION_ATTEMPTS;

        const invariants: Invariant[] = [
            {
                id: 'QUAL-VERIFY',
                invariant: `VERIFICATION REQUIRED (attempt ${verificationAttempt}/${MAX_VERIFICATION_ATTEMPTS}): You merged child work in the previous run. Now VERIFY deliverables satisfy your goal invariants. For UI work, use browser_automation tools.`,
                examples: {
                    do: ['For each GOAL-* invariant, verify it is actually satisfied; for UI: use browser_automation to run the app'],
                    dont: ['Report COMPLETED without explicitly verifying each invariant against deliverables'],
                },
            },
        ];

        if (isLastAttempt) {
            invariants.push({
                id: 'QUAL-VERIFY-FINAL',
                invariant: `FINAL VERIFICATION ATTEMPT: If you cannot verify all invariants are satisfied, report FAILED with explanation.`,
                examples: {
                    do: ['If invariants cannot be satisfied, report FAILED with specifics'],
                    dont: ['Report COMPLETED if invariants remain unverified'],
                },
            });
        }

        return invariants;
    }

    private getCodingStandardsInvariants(ctx: BuildContext): Invariant[] {
        const isCodingJob = ctx.metadata.additionalContext?.isCodingJob === true;

        if (!isCodingJob) {
            return [];
        }

        return [
            {
                id: 'QUAL-CODING',
                invariant: 'I write observable, testable code. Key functions are externally callable, state is inspectable, and structure supports automation.',
                examples: {
                    do: ['Expose entry points globally; use data attributes and unique IDs for reliable element selection'],
                    dont: ['Bury all logic in closures with no external entry point'],
                },
            }
        ];
    }
}
