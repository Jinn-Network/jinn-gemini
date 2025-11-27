/**
 * ArtifactAssertionProvider - Generates dynamic assertions for available artifacts
 *
 * This provider creates context-aware assertions that embed specific information
 * about available artifacts with their CIDs.
 */

import type {
  AssertionProvider,
  BuildContext,
  BlueprintContext,
  BlueprintBuilderConfig,
  BlueprintAssertion,
  ArtifactInfo,
} from '../../types.js';

/**
 * ArtifactAssertionProvider generates assertions for available artifacts
 */
export class ArtifactAssertionProvider implements AssertionProvider {
  name = 'artifact-assertions';
  category = 'context' as const;

  enabled(config: BlueprintBuilderConfig): boolean {
    return config.enableContextAssertions;
  }

  async provide(
    _ctx: BuildContext,
    builtContext: BlueprintContext
  ): Promise<BlueprintAssertion[]> {
    const artifacts = builtContext.artifacts;

    if (!artifacts || artifacts.length === 0) {
      return [];
    }

    const assertions: BlueprintAssertion[] = [];

    // Add summary assertion if multiple artifacts
    if (artifacts.length > 1) {
      assertions.push(this.createSummaryAssertion(artifacts));
    }

    // Generate an assertion for each artifact
    let assertionIndex = 1;
    for (const artifact of artifacts) {
      assertions.push(this.artifactToAssertion(artifact, assertionIndex));
      assertionIndex++;
    }

    return assertions;
  }

  /**
   * Create a summary assertion about available artifacts
   */
  private createSummaryAssertion(artifacts: ArtifactInfo[]): BlueprintAssertion {
    const artifactNames = artifacts.map((a) => a.name).join(', ');

    return {
      id: 'CTX-ARTIFACTS-SUMMARY',
      category: 'context',
      assertion: `${artifacts.length} artifact(s) are available from related jobs: ${artifactNames}. Use them instead of regenerating data.`,
      examples: {
        do: [
          'Check if relevant data exists in available artifacts',
          'Fetch artifacts using their CIDs',
          'Reference existing data rather than regenerating',
        ],
        dont: [
          'Regenerate data that exists in artifacts',
          'Ignore available artifacts',
          'Create duplicate outputs',
        ],
      },
      commentary:
        'Artifacts contain work products from related jobs. Using them avoids duplicating effort.',
    };
  }

  /**
   * Create an assertion for a specific artifact
   */
  private artifactToAssertion(
    artifact: ArtifactInfo,
    index: number
  ): BlueprintAssertion {
    const cidPreview =
      artifact.cid.length > 20
        ? artifact.cid.slice(0, 20) + '...'
        : artifact.cid;

    const typeInfo = artifact.type ? ` (${artifact.type})` : '';

    return {
      id: `CTX-ARTIFACT-${String(index).padStart(3, '0')}`,
      category: 'context',
      assertion: `Artifact '${artifact.name}'${typeInfo} is available at CID: ${artifact.cid}. Use it instead of regenerating.`,
      examples: {
        do: [
          `Fetch '${artifact.name}' artifact using CID ${cidPreview}`,
          `Reference existing '${artifact.name}' data in your outputs`,
        ],
        dont: [
          `Regenerate '${artifact.name}' data from scratch`,
          'Create a new artifact with the same content',
        ],
      },
      commentary: `Available artifact from prior job execution. CID: ${artifact.cid}`,
    };
  }
}
