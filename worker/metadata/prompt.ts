/**
 * Prompt construction utilities
 */

import type { IpfsMetadata } from '../types.js';

/**
 * Build enhanced prompt with additional context if available
 */
export function buildEnhancedPrompt(metadata: IpfsMetadata, basePrompt?: string): string {
  let prompt = basePrompt || String(metadata?.prompt || '').trim();
  
  if (metadata?.additionalContext) {
    const context = metadata.additionalContext;
    const contextSummary = `

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

**Available Artifacts:**
${context.hierarchy?.flatMap((job: any) => 
  job.artifactRefs?.map((artifact: any) => 
    `- ${artifact.name} (${artifact.topic}) - CID: ${artifact.cid}`
  ) || []
).join('\n') || 'No artifacts available'}

---

`;
    prompt = contextSummary + prompt;
  }
  
  return prompt;
}

