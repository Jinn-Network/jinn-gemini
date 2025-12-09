/**
 * VerificationDirectiveProvider - Injects verification directive after child work is merged
 *
 * When a job completes after having children (review phase), it gets re-dispatched
 * with verificationRequired: true. This provider injects a strong assertion
 * instructing the agent to verify that the merged work actually satisfies
 * the original assertions.
 *
 * The verification cycle:
 * 1. Parent merges child branches → COMPLETED
 * 2. System re-dispatches parent with verificationRequired: true
 * 3. This provider injects SYS-VERIFY-001
 * 4. Agent verifies deliverables against assertions
 * 5. If verified → COMPLETED → grandparent dispatched
 * 6. If issues → dispatch fix-children → DELEGATING → cycle continues
 */

import type {
  AssertionProvider,
  BuildContext,
  BlueprintContext,
  BlueprintBuilderConfig,
  BlueprintAssertion,
} from '../../types.js';

const MAX_VERIFICATION_ATTEMPTS = 3;

/**
 * VerificationDirectiveProvider injects verification directive when verificationRequired is set
 */
export class VerificationDirectiveProvider implements AssertionProvider {
  name = 'verification-directive';
  category = 'system' as const;

  enabled(_config: BlueprintBuilderConfig): boolean {
    return true;
  }

  async provide(
    ctx: BuildContext,
    _builtContext: BlueprintContext
  ): Promise<BlueprintAssertion[]> {
    const additionalContext = ctx.metadata.additionalContext;
    const verificationRequired = additionalContext?.verificationRequired === true;

    if (!verificationRequired) {
      return [];
    }

    const verificationAttempt = additionalContext?.verificationAttempt ?? 1;
    const isLastAttempt = verificationAttempt >= MAX_VERIFICATION_ATTEMPTS;

    const assertions: BlueprintAssertion[] = [
      {
        id: 'SYS-VERIFY-001',
        category: 'system',
        assertion: `VERIFICATION REQUIRED (attempt ${verificationAttempt}/${MAX_VERIFICATION_ATTEMPTS}): You merged child work in the previous run. Now VERIFY the deliverables actually satisfy your original job assertions. Test functionality, run code, inspect outputs.`,
        examples: {
          do: [
            'Review each of YOUR job assertions (JOB-*)',
            'For each assertion, verify it is actually satisfied (not just that code exists)',
            'Run tests if they exist, execute code, check outputs',
            'Inspect the actual behavior, not just the code structure',
            'If ALL assertions verified → report COMPLETED',
            'If issues found → dispatch targeted fix-children → report DELEGATING',
          ],
          dont: [
            'Assume merged code works without testing',
            'Report COMPLETED without explicitly verifying each assertion',
            'Skip verification because the code "looks right"',
            'Re-do work that is already correct',
            'Dispatch children for issues you can fix directly (minor fixes)',
          ],
        },
        commentary: `Verification ensures merged child work actually satisfies requirements. This is attempt ${verificationAttempt} of ${MAX_VERIFICATION_ATTEMPTS}. ${isLastAttempt ? 'This is the FINAL attempt - if verification fails, the job will be marked for human review.' : 'If issues are found, dispatch fix-children to address them.'}`,
      },
    ];

    // Add escalation warning on last attempt
    if (isLastAttempt) {
      assertions.push({
        id: 'SYS-VERIFY-002',
        category: 'system',
        assertion: `FINAL VERIFICATION ATTEMPT: This is attempt ${verificationAttempt} of ${MAX_VERIFICATION_ATTEMPTS}. If you cannot verify all assertions are satisfied, report FAILED with a clear explanation of what remains unverified.`,
        examples: {
          do: [
            'Be thorough - this is the last chance to verify',
            'If assertions are satisfied, report COMPLETED',
            'If assertions cannot be satisfied, report FAILED with specifics',
          ],
          dont: [
            'Dispatch more children on the final attempt',
            'Report COMPLETED if assertions remain unverified',
            'Give up without clear explanation',
          ],
        },
        commentary:
          'After maximum verification attempts, the system needs a definitive outcome. Either the work is verified complete, or it requires human intervention.',
      });
    }

    return assertions;
  }
}
