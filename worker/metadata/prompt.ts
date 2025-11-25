/**
 * Prompt construction utilities
 * Note: "Prompt" here refers to the final context passed to the agent via GEMINI.md
 * The blueprint IS the job specification and is available directly in GEMINI.md context
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { IpfsMetadata } from '../types.js';

// Read GEMINI.md once at module load
// This contains the Work Protocol that defines how agents should operate
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORK_PROTOCOL = readFileSync(
  join(__dirname, '../../gemini-agent/GEMINI.md'), 
  'utf8'
);

/**
 * Build enhanced prompt with blueprint and additional context
 * Blueprint is the primary specification - it's made available to agent via GEMINI.md
 */
export function buildEnhancedPrompt(metadata: IpfsMetadata, fallbackPrompt?: string): string {
  // Blueprint is the job specification
  // If no blueprint exists (legacy job), use fallback
  const blueprint = metadata?.blueprint || fallbackPrompt || '';
  
  if (!blueprint) {
    return 'No job specification found';
  }
  
  let prompt = blueprint;
  
  // Add job hierarchy context if available
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
  
  // Prepend Work Protocol (GEMINI.md content) before all job-specific content
  // This ensures agents receive the Work Protocol instructions regardless of
  // whether Gemini CLI's automatic GEMINI.md loading works in non-interactive mode
  return `${WORK_PROTOCOL}\n\n---\n\n${prompt}`;
}

