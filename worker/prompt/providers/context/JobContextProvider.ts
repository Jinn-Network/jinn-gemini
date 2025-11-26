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
   * Combines data from both `hierarchy` array and `completedChildRuns` array
   */
  private extractHierarchy(additionalContext: AdditionalContext): HierarchyContext | undefined {
    const summary = additionalContext.summary;
    const hierarchyJobs = additionalContext.hierarchy;
    const completedChildRuns = additionalContext.completedChildRuns;

    if (!summary && !hierarchyJobs && !completedChildRuns) {
      return undefined;
    }

    // Extract children from the hierarchy
    const children: ChildJobInfo[] = [];
    const seenRequestIds = new Set<string>();

    // First, process completedChildRuns (most recent child completion data)
    // This contains branchName/baseBranch directly from the dispatching child
    if (Array.isArray(completedChildRuns)) {
      for (const run of completedChildRuns) {
        if (!run.requestId) continue;
        seenRequestIds.add(run.requestId);

        // Extract branch info from run or from GIT_BRANCH artifact
        let branchName = (run as any).branchName;
        let baseBranch = (run as any).baseBranch;

        // Check artifacts for GIT_BRANCH if not directly on run
        if (!branchName && Array.isArray((run as any).artifacts)) {
          const branchArtifact = (run as any).artifacts.find(
            (a: any) => a.type === 'GIT_BRANCH' || a.topic === 'git/branch'
          );
          if (branchArtifact?.details) {
            branchName = branchArtifact.details.headBranch;
            baseBranch = baseBranch || branchArtifact.details.baseBranch;
          }
        }

        children.push({
          requestId: run.requestId,
          jobName: (run as any).jobName,
          status: this.mapJobStatus((run as any).status || 'completed'),
          summary: (run as any).summary,
          branchName,
          baseBranch,
        });
      }
    }

    // Then process hierarchy array (may have additional jobs)
    if (Array.isArray(hierarchyJobs)) {
      for (const job of hierarchyJobs) {
        const requestId = job.requestId || job.id || '';
        // Skip if already added from completedChildRuns
        if (seenRequestIds.has(requestId)) continue;

        // Map job status to our simplified status
        const status = this.mapJobStatus(job.status);

        // Extract branch info from job or from GIT_BRANCH artifact
        let branchName = job.branchName;
        let baseBranch = job.baseBranch;

        // If not directly on job, check artifactRefs for GIT_BRANCH artifact
        if (!branchName && Array.isArray(job.artifactRefs)) {
          const branchArtifact = job.artifactRefs.find(
            (a) => a.type === 'GIT_BRANCH' || a.topic === 'git/branch'
          );
          if (branchArtifact?.details) {
            branchName = branchArtifact.details.headBranch;
            baseBranch = baseBranch || branchArtifact.details.baseBranch;
          }
        }

        children.push({
          requestId,
          jobName: job.name || job.jobName,
          status,
          summary: job.summary || job.deliverySummary,
          branchName,
          baseBranch,
        });
      }
    }

    return {
      totalJobs: summary?.totalJobs || children.length,
      completedJobs: summary?.completedJobs || children.filter((c) => c.status === 'COMPLETED').length,
      activeJobs: summary?.activeJobs || children.filter((c) => c.status === 'ACTIVE').length,
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
