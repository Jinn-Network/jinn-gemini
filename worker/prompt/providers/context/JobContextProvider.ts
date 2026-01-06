/**
 * JobContextProvider - Provides job hierarchy and artifact context
 *
 * This provider fetches child job data from Ponder using a single query,
 * replacing the dual-source approach (completedChildRuns + hierarchy)
 * that was prone to duplicates and phantom entries.
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
import { workerLogger } from '../../../../logging/index.js';
import { fetchAllChildren, type ChildJobData } from './fetchChildren.js';
import { isChildIntegrated, batchFetchBranches } from '../../../git/integration.js';

/**
 * JobContextProvider extracts hierarchy and artifact information
 */
export class JobContextProvider implements ContextProvider {
  name = 'job-context';

  enabled(config: BlueprintBuilderConfig): boolean {
    return config.enableJobContext;
  }

  async provide(ctx: BuildContext): Promise<Partial<BlueprintContext>> {
    const result: Partial<BlueprintContext> = {};
    const jobDefinitionId = ctx.metadata?.jobDefinitionId;

    // Fetch children from Ponder using single authoritative query
    if (jobDefinitionId) {
      const hierarchy = await this.fetchHierarchy(jobDefinitionId);
      if (hierarchy) {
        result.hierarchy = hierarchy;
      }
    }

    // Extract artifacts from additionalContext (kept for backward compatibility)
    const additionalContext = ctx.metadata?.additionalContext;
    if (additionalContext) {
      const artifacts = this.extractArtifacts(additionalContext);
      if (artifacts.length > 0) {
        result.artifacts = artifacts;
      }
    }

    return result;
  }

  /**
   * Fetch hierarchy information from Ponder using single query.
   * This replaces the dual-source merge of completedChildRuns + hierarchy.
   */
  private async fetchHierarchy(parentJobDefId: string): Promise<HierarchyContext | undefined> {
    const childrenData = await fetchAllChildren(parentJobDefId);

    if (childrenData.length === 0) {
      return undefined;
    }

    const repoRoot = process.env.CODE_METADATA_REPO_ROOT;
    const parentBranch = process.env.CODE_METADATA_BRANCH_NAME || 'main';

    // Batch fetch all child branches + parent for efficiency
    if (repoRoot) {
      const branchNames = childrenData.map((c) => c.branchName).filter(Boolean) as string[];
      if (branchNames.length > 0) {
        batchFetchBranches(branchNames, parentBranch);
      }
    }

    // Map Ponder data to ChildJobInfo with integration check
    const children: ChildJobInfo[] = childrenData.map((child) => {
      // Check if child's work is already integrated into parent
      const isIntegrated = child.branchName
        ? isChildIntegrated(child.branchName, parentBranch)
        : true; // No branch = integrated (nothing to merge)

      if (isIntegrated) {
        workerLogger.info(
          { branchName: child.branchName, jobDefinitionId: child.jobDefinitionId },
          'Child already integrated (commits in parent or branch deleted)'
        );
      }

      return {
        // Note: We're using jobDefinitionId as the identifier now,
        // since that's what Ponder query returns. The ChildJobInfo type
        // uses requestId, but for our purposes the job def ID works.
        requestId: child.jobDefinitionId,
        jobName: child.jobName,
        status: child.status,
        summary: undefined, // Not fetched from Ponder; can add IPFS fetch if needed
        branchName: child.branchName,
        baseBranch: child.baseBranch,
        isIntegrated,
      };
    });

    return {
      totalJobs: children.length,
      completedJobs: children.filter((c) => c.status === 'COMPLETED').length,
      activeJobs: children.filter((c) => c.status === 'ACTIVE').length,
      children,
    };
  }

  /**
   * Extract artifacts from additionalContext
   * (kept for backward compatibility until artifact fetching is consolidated)
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
}
