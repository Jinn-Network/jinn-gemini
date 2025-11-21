/**
 * Prompt construction utilities
 * Note: "Prompt" here refers to the final context passed to the agent via GEMINI.md
 * The blueprint IS the job specification and is available directly in GEMINI.md context
 */

import type { IpfsMetadata } from '../types.js';

/**
 * Build enhanced prompt with blueprint and additional context
 * Blueprint is the primary specification - it's made available to agent via GEMINI.md
 */
export function buildEnhancedPrompt(metadata: IpfsMetadata, fallbackPrompt?: string): string {
  const promptBase = metadata?.blueprint || fallbackPrompt || "";
  if (!promptBase) {
    return "No job specification found";
  }
  const blueprintPreface =
    'Blueprint (required): This is your job spec—a set of assertions/requirements you must satisfy. Complete them yourself or delegate, but ensure every assertion is met.';
  let prompt = `${blueprintPreface}\n\n${promptBase}`;

  if (metadata?.additionalContext) {
    const context = metadata.additionalContext;

    // Check for completed child jobs (level > 0 with status 'completed')
    const completedChildren = context.hierarchy?.filter((job: any) =>
      job.level > 0 && job.status === 'completed'
    ) || [];

    // Check for Work Protocol message indicating child completion
    const workProtocolMessage = context.message;
    const hasChildCompletionMessage = workProtocolMessage &&
      (typeof workProtocolMessage === 'string'
        ? workProtocolMessage.includes('Child job COMPLETED') || workProtocolMessage.includes('Child job completed')
        : workProtocolMessage.content?.includes('Child job COMPLETED') || workProtocolMessage.content?.includes('Child job completed'));

    const deterministicChildRuns = Array.isArray(context.completedChildRuns)
      ? context.completedChildRuns
      : [];

    const formatArtifactLine = (artifact: any, id: string, cid: string) => {
      const isBranch = artifact.type === 'GIT_BRANCH' || artifact.topic === 'git/branch';
      const prefix = isBranch ? '    - [GIT BRANCH] ' : '    - ';
      return `${prefix}${artifact.name || 'Unnamed Artifact'} (${artifact.topic || 'no topic'}) — ${id}, ${cid}`;
    };

    const completedChildSummaries =
      completedChildren.length > 0
        ? completedChildren.map((job: any) => {
          const requests = Array.isArray(job.requestIds) && job.requestIds.length > 0
            ? job.requestIds.join(', ')
            : 'none';
          const artifacts =
            job.artifactRefs?.length
              ? job.artifactRefs.map((artifact: any) => {
                const artifactId = artifact.id ? `ID: ${artifact.id}` : 'ID: n/a';
                const artifactCid = artifact.cid ? `CID: ${artifact.cid}` : 'CID: n/a';
                return formatArtifactLine(artifact, artifactId, artifactCid);
              }).join('\n')
              : '    - No artifacts reported';
          return [
            `- ${job.name} (Job Definition: ${job.jobId || 'unknown'})`,
            `  Request IDs: ${requests}`,
            artifacts,
          ].join('\n');
        }).join('\n')
        : 'No completed child jobs detected.';

    const deterministicChildSummaries =
      deterministicChildRuns.length > 0
        ? deterministicChildRuns.map((run: any) => {
          const artifacts =
            Array.isArray(run?.artifacts) && run.artifacts.length
              ? run.artifacts.map((artifact: any, index: number) => {
                const artifactId =
                  artifact?.id ||
                  `${run?.requestId || 'request'}:${typeof index === 'number' ? index : '0'}`;
                const artifactCid = artifact?.cid ? `CID: ${artifact.cid}` : 'CID: n/a';
                return formatArtifactLine(artifact, `ID: ${artifactId}`, artifactCid);
              }).join('\n')
              : '    - No artifacts reported';
          return [
            `- Child Request ID: ${run?.requestId || 'unknown'} (Status: ${run?.status || 'unknown'})`,
            `  Job Definition ID: ${run?.jobDefinitionId || 'unknown'}`,
            `  Summary: ${run?.summary || 'n/a'}`,
            `  Artifacts:\n${artifacts}`,
          ].join('\n');
        }).join('\n')
        : null;

    const hierarchyArtifacts =
      context.hierarchy?.flatMap((job: any) =>
        job.artifactRefs?.map((artifact: any) => {
          const artifactId = artifact.id ? `ID: ${artifact.id}` : 'ID: n/a';
          const artifactCid = artifact.cid ? `CID: ${artifact.cid}` : 'CID: n/a';
          return `- ${artifact.name} (${artifact.topic}) — ${artifactId}, ${artifactCid}`;
        }) || []
      ) || [];

    const deterministicArtifactLines =
      deterministicChildSummaries && deterministicChildRuns.length > 0
        ? deterministicChildRuns.flatMap((run: any) =>
          Array.isArray(run?.artifacts)
            ? run.artifacts.map((artifact: any, index: number) => {
              const artifactId =
                artifact?.id ||
                `${run?.requestId || 'request'}:${typeof index === 'number' ? index : '0'}`;
              const artifactCid = artifact?.cid ? `CID: ${artifact.cid}` : 'CID: n/a';
              return `- ${artifact?.name || 'Artifact'} (${artifact?.topic || 'unknown-topic'}) — ${artifactId}, ${artifactCid}`;
            })
            : []
        )
        : [];

    // Collect all artifacts with their metadata (not just strings)
    const allArtifacts: Array<{ name: string; topic: string; type?: string; id: string; cid: string; details?: any }> = [];

    // From hierarchy
    context.hierarchy?.forEach((job: any) => {
      job.artifactRefs?.forEach((artifact: any) => {
        const artifactId = artifact.id ? `ID: ${artifact.id}` : 'ID: n/a';
        const artifactCid = artifact.cid ? `CID: ${artifact.cid}` : 'CID: n/a';
        allArtifacts.push({
          name: artifact.name || 'Unnamed Artifact',
          topic: artifact.topic || 'no topic',
          type: artifact.type,
          id: artifactId,
          cid: artifactCid,
          details: artifact.details,
        });
      });
    });

    // From deterministic child runs
    if (deterministicChildRuns.length > 0) {
      deterministicChildRuns.forEach((run: any) => {
        if (Array.isArray(run?.artifacts)) {
          run.artifacts.forEach((artifact: any, index: number) => {
            const artifactId =
              artifact?.id ||
              `${run?.requestId || 'request'}:${typeof index === 'number' ? index : '0'}`;
            const artifactCid = artifact?.cid ? `CID: ${artifact.cid}` : 'CID: n/a';
            allArtifacts.push({
              name: artifact?.name || 'Artifact',
              topic: artifact?.topic || 'unknown-topic',
              type: artifact?.type,
              id: artifactId,
              cid: artifactCid,
              details: artifact?.details,
            });
          });
        }
      });
    }

    // Filter out PR artifacts from the general list since they are now highlighted in child summaries
    // or if we want to show them in a general list, we can, but user requested "only deterministically show... from child jobs"
    // We will keep 'otherArtifacts' for general context but remove the specific PR section
    const isBranchArtifact = (artifact: any) => artifact.type === 'GIT_BRANCH' || artifact.topic === 'git/branch';
    const branchArtifacts = allArtifacts.filter(isBranchArtifact);
    const otherArtifacts = allArtifacts.filter((a) => !isBranchArtifact(a));

    const branchArtifactLines =
      branchArtifacts.length > 0
        ? branchArtifacts.map((artifact) => {
            const artifactName = artifact.name || artifact.id;
            const headBranch =
              artifact.details?.headBranch ||
              artifact.details?.branchName ||
              (artifactName?.startsWith('branch-') ? artifactName.replace(/^branch-/, '') : artifactName);
            const mergeStatus = artifact.details?.mergeStatus || 'unknown';
            return `- Branch ${headBranch} (merge status: ${mergeStatus})`;
          }).join('\n')
        : null;

    const branchIntegrationReminder = branchArtifacts.length > 0
      ? `
**Branch Integration Reminder:**
${branchArtifactLines}
- Review the diffSummary/mergeStatus provided in the branch artifact details.
- When calling \`process_branch\`, use the exact headBranch shown above (e.g., \`${branchArtifacts
          .map((artifact) =>
            artifact.details?.headBranch ||
            artifact.details?.branchName ||
            (artifact.name?.startsWith('branch-') ? artifact.name.replace(/^branch-/, '') : artifact.name || artifact.id)
          )
          .join(', ')}\`). Do **not** include the \`branch-\` prefix.
- If the branch satisfies acceptance criteria, call \`process_branch({ branch_name: "<headBranch>", action: "merge", rationale: "<brief reason>" })\` before finishing.
- If you decide not to merge, explicitly state why in your execution summary.`
      : '';

    const otherArtifactsSection = otherArtifacts.length > 0
      ? otherArtifacts.map((a) => `- ${a.name} (${a.topic}${a.type ? `, type=${a.type}` : ''}) — ${a.id}, ${a.cid}`).join('\n')
      : 'No artifacts available';

    const contextSummary = `

## Context (supporting)
The following information is provided to help you execute the blueprint correctly.

## Job Context
This job is part of a larger workflow. Here's the context:

**Job Hierarchy Summary:**
- Total jobs in hierarchy: ${context.summary?.totalJobs || 0}
- Completed jobs: ${context.summary?.completedJobs || 0}
- Active jobs: ${context.summary?.activeJobs || 0}
- Available artifacts: ${context.summary?.totalArtifacts || 0}

**Related Jobs:**
${context.hierarchy?.map((job: any) =>
      `- ${job.name} (Level ${job.level}, Status: ${job.status})`
    ).join('\n') || 'No related jobs found'}

${otherArtifactsSection}

${branchIntegrationReminder}

${completedChildren.length > 0 || hasChildCompletionMessage || deterministicChildRuns.length > 0 ? `

---

## IMPORTANT: Review Completed Child Work Before Acting

You have ${Math.max(completedChildren.length, deterministicChildRuns.length)} completed child job(s) detected (hierarchy + deterministic context). Before delegating additional work, you must:

1. **Review Child Deliverables**: Examine artifacts, execution summaries, and any PR links from completed child jobs
2. **Summarize Child Output**: Document what the child jobs accomplished and what deliverables they produced
3. **Evaluate Completeness**: Determine whether the child work satisfies your objective
4. **Decide Next Steps**:
   - If child work satisfies the objective: Synthesize their results and complete the job yourself
   - If gaps remain: Only then dispatch additional child jobs, and clearly document what work is still needed

${completedChildren.length > 0 ? `**Completed Child Jobs (hierarchy snapshot):**\n${completedChildSummaries}\n` : ''}
${deterministicChildSummaries ? `**Deterministic Completed Child Runs (captured at dispatch time):**\n${deterministicChildSummaries}\n` : ''}

**Retrieval Instructions:**
- For each request ID above, run \`get_details\` with \`ids: ["<requestId>"]\` and \`resolve_ipfs=true\` to pull their execution summaries and artifacts.
- To fetch a specific artifact directly, include its artifact ID (e.g. \`<requestId>:0\`) in the \`ids\` array or search by name/CID using \`search_artifacts\`.
- Do **not** re-delegate until you have reviewed and synthesized the deliverables listed here and identified concrete remaining gaps.

---` : ''}

`;
    prompt = contextSummary + prompt;
  }

  return prompt;
}
