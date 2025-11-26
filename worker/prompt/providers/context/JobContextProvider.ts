/**
 * JobContextProvider - Provides job hierarchy and artifact context
 *
 * This provider extracts job hierarchy information from metadata.additionalContext
 * and outputs structured BlueprintContext.hierarchy and BlueprintContext.artifacts.
 */

import type {
  ContextProvider,
  BuildContext,
  BlueprintContext,
  BlueprintBuilderConfig,
  HierarchyContext,
  ChildJobInfo,
  ArtifactInfo,
  AdditionalContext,
} from '../../types.js';

/**
 * JobContextProvider extracts hierarchy and artifact information
 */
export class JobContextProvider implements ContextProvider {
  name = 'job-context';

  enabled(config: BlueprintBuilderConfig): boolean {
    return config.enableJobContext;
  }

  async provide(ctx: BuildContext): Promise<Partial<BlueprintContext>> {
    const additionalContext = ctx.metadata?.additionalContext;

    if (!additionalContext) {
      return {};
    }

    const result: Partial<BlueprintContext> = {};

    // Extract hierarchy information
    const hierarchy = this.extractHierarchy(additionalContext);
    if (hierarchy) {
      result.hierarchy = hierarchy;
    }

    // Extract artifacts
    const artifacts = this.extractArtifacts(additionalContext);
    if (artifacts.length > 0) {
      result.artifacts = artifacts;
    }

    return result;
  }

  /**
   * Extract hierarchy information from additionalContext
   */
  private extractHierarchy(additionalContext: AdditionalContext): HierarchyContext | undefined {
    const summary = additionalContext.summary;
    const hierarchyJobs = additionalContext.hierarchy;

    if (!summary && !hierarchyJobs) {
      return undefined;
    }

    // Extract children from the hierarchy
    const children: ChildJobInfo[] = [];

    if (Array.isArray(hierarchyJobs)) {
      for (const job of hierarchyJobs) {
        // Map job status to our simplified status
        const status = this.mapJobStatus(job.status);

        children.push({
          requestId: job.requestId || job.id || '',
          jobName: job.name || job.jobName,
          status,
          summary: job.summary || job.deliverySummary,
        });
      }
    }

    return {
      totalJobs: summary?.totalJobs || 0,
      completedJobs: summary?.completedJobs || 0,
      activeJobs: summary?.activeJobs || 0,
      children,
    };
  }

  /**
   * Extract artifacts from additionalContext
   */
  private extractArtifacts(additionalContext: AdditionalContext): ArtifactInfo[] {
    const artifacts: ArtifactInfo[] = [];
    const hierarchyJobs = additionalContext.hierarchy;

    if (!Array.isArray(hierarchyJobs)) {
      return artifacts;
    }

    // Collect artifacts from all jobs in the hierarchy
    for (const job of hierarchyJobs) {
      if (Array.isArray(job.artifactRefs)) {
        for (const artifact of job.artifactRefs) {
          artifacts.push({
            name: artifact.name || artifact.topic || 'unnamed',
            cid: artifact.cid,
            type: artifact.type || artifact.topic,
          });
        }
      }
    }

    return artifacts;
  }

  /**
   * Map various job status strings to our simplified status
   */
  private mapJobStatus(status: string): 'COMPLETED' | 'ACTIVE' | 'FAILED' {
    const normalized = (status || '').toUpperCase();

    if (normalized === 'COMPLETED' || normalized === 'DELIVERED' || normalized === 'SUCCESS') {
      return 'COMPLETED';
    }

    if (normalized === 'FAILED' || normalized === 'ERROR') {
      return 'FAILED';
    }

    return 'ACTIVE';
  }
}
