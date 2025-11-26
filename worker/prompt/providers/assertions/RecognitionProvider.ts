/**
 * RecognitionProvider - Converts prescriptive learnings to recognition assertions
 *
 * This provider extracts learnings from the recognition phase result
 * and converts prescriptive insights into assertion format.
 */

import type {
  AssertionProvider,
  BuildContext,
  BlueprintContext,
  BlueprintBuilderConfig,
  BlueprintAssertion,
} from '../../types.js';

/**
 * Recognition learning structure (from recognition_helpers.ts)
 */
interface RecognitionLearning {
  sourceRequestId?: string;
  title?: string;
  insight?: string;
  actions?: string[];
  warnings?: string[];
  confidence?: string;
  artifactCid?: string;
}

/**
 * RecognitionProvider converts recognition learnings to assertions
 */
export class RecognitionProvider implements AssertionProvider {
  name = 'recognition';
  category = 'recognition' as const;

  enabled(config: BlueprintBuilderConfig): boolean {
    return config.enableRecognitionLearnings;
  }

  async provide(
    ctx: BuildContext,
    _builtContext: BlueprintContext
  ): Promise<BlueprintAssertion[]> {
    const recognition = ctx.recognition;

    if (!recognition) {
      return [];
    }

    const assertions: BlueprintAssertion[] = [];

    // Extract learnings from rawLearnings
    const learnings = this.extractLearnings(recognition.rawLearnings);

    let assertionIndex = 1;
    for (const learning of learnings) {
      const assertion = this.learningToAssertion(learning, assertionIndex);
      if (assertion) {
        assertions.push(assertion);
        assertionIndex++;
      }
    }

    return assertions;
  }

  /**
   * Extract learnings array from rawLearnings
   */
  private extractLearnings(rawLearnings: unknown): RecognitionLearning[] {
    if (!rawLearnings) {
      return [];
    }

    // rawLearnings might be an array or an object with a learnings property
    if (Array.isArray(rawLearnings)) {
      return rawLearnings;
    }

    if (typeof rawLearnings === 'object' && rawLearnings !== null) {
      const obj = rawLearnings as Record<string, unknown>;
      if (Array.isArray(obj.learnings)) {
        return obj.learnings;
      }
    }

    return [];
  }

  /**
   * Convert a recognition learning to a BlueprintAssertion
   */
  private learningToAssertion(
    learning: RecognitionLearning,
    index: number
  ): BlueprintAssertion | null {
    // Need at least an insight or warning to create an assertion
    if (!learning.insight && (!learning.warnings || learning.warnings.length === 0)) {
      return null;
    }

    // Build the assertion text
    const assertionParts: string[] = [];

    if (learning.insight) {
      assertionParts.push(learning.insight);
    }

    if (learning.warnings && learning.warnings.length > 0) {
      assertionParts.push(`Warning: ${learning.warnings.join('; ')}`);
    }

    const assertionText = assertionParts.join('. ');

    // Build do examples from actions
    const doExamples: string[] = [];
    if (learning.actions && learning.actions.length > 0) {
      doExamples.push(...learning.actions);
    } else {
      doExamples.push('Apply this learning from similar jobs');
    }

    // Build don't examples from warnings
    const dontExamples: string[] = [];
    if (learning.warnings && learning.warnings.length > 0) {
      dontExamples.push(...learning.warnings.map((w) => `Ignore: ${w}`));
    } else {
      dontExamples.push('Ignore learnings from similar jobs');
    }

    // Build commentary
    const commentaryParts: string[] = [];
    if (learning.title) {
      commentaryParts.push(`Learning: ${learning.title}`);
    }
    if (learning.sourceRequestId) {
      commentaryParts.push(`From similar job: ${learning.sourceRequestId.slice(0, 10)}...`);
    }
    if (learning.confidence) {
      commentaryParts.push(`Confidence: ${learning.confidence}`);
    }

    const commentary =
      commentaryParts.length > 0
        ? commentaryParts.join('. ')
        : 'Extracted from recognition of similar jobs';

    return {
      id: `REC-${String(index).padStart(3, '0')}`,
      category: 'recognition',
      assertion: assertionText,
      examples: {
        do: doExamples,
        dont: dontExamples,
      },
      commentary,
    };
  }
}
