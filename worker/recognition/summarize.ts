/**
 * AI-powered summarization of workstream progress
 * 
 * This module uses a lightweight AI agent to generate a concise, relevant
 * summary of completed work in a workstream, tailored to the current job's objective.
 */

import { workerLogger } from '../../logging/index.js';
import { Agent } from '../../gemini-agent/agent.js';
import { serializeError } from '../logging/errors.js';
import type { WorkstreamJob } from './progressCheckpoint.js';

/**
 * Summarize workstream progress using AI (gemini-2.5-flash)
 * 
 * @param workstreamJobs - Array of completed jobs with their summaries
 * @param currentJobObjective - The objective/goal of the current job
 * @param currentJobName - Name of the current job
 * @param requestId - Current request ID (for logging)
 * @returns AI-generated summary markdown, or null on failure
 */
export async function summarizeWorkstreamProgress(
  workstreamJobs: WorkstreamJob[],
  currentJobObjective: string,
  currentJobName: string | undefined,
  requestId: string
): Promise<string | null> {
  if (workstreamJobs.length === 0) {
    return null;
  }

  try {
    workerLogger.info({
      requestId,
      jobCount: workstreamJobs.length,
      jobsWithSummaries: workstreamJobs.filter(j => j.deliverySummary).length,
    }, 'Starting AI summarization of workstream progress');

    // Build the context for the summarization agent
    const jobSummariesText = workstreamJobs
      .map((job, idx) => {
        const jobTitle = job.jobName || `Job ${job.requestId.slice(0, 8)}`;
        const timestamp = new Date(parseInt(job.blockTimestamp) * 1000).toISOString();
        const summary = job.deliverySummary || '(No summary available)';
        
        return `### ${idx + 1}. ${jobTitle}\n**Request ID:** ${job.requestId}\n**Completed:** ${timestamp}\n**Summary:**\n${summary}\n`;
      })
      .join('\n---\n\n');

    const prompt = `You are a progress summarization agent. Your task is to analyze completed work in a venture workstream and create a concise, relevant summary for the next job in the sequence.

## Current Job Context

**Job Name:** ${currentJobName || 'Unnamed Job'}
**Objective:** ${currentJobObjective}

## Completed Work in Workstream

The following jobs have been completed in this workstream (most recent first):

${jobSummariesText}

---

## Your Task

Create a concise summary (300-500 words) that:

1. **Highlights key accomplishments** - What major work has been done?
2. **Identifies patterns and decisions** - What approaches were taken? What worked?
3. **Surfaces relevant context** - What information from prior work is most relevant to "${currentJobObjective}"?
4. **Notes dependencies and building blocks** - What artifacts, decisions, or components from prior work should inform the current job?

## Output Format

Structure your summary as markdown with these sections:

### Workstream Progress Summary

[Brief overview of what's been accomplished in 2-3 sentences]

### Key Accomplishments

- [Bullet point 1]
- [Bullet point 2]
- [etc.]

### Relevant Context for Current Job

[Paragraph explaining what from the prior work is most relevant to the current objective: "${currentJobObjective}"]

### Building Blocks Available

- [Artifacts, components, or decisions that can be leveraged]

---

**Important:** 
- Be concise. Focus on information that will help the agent execute "${currentJobObjective}" effectively. Omit irrelevant details.
- This is HISTORICAL CONTEXT ONLY. The agent receiving this summary must NOT poll for updates or check child status.
- Frame all information as completed facts from prior runs.`;

    const summarizationAgent = new Agent(
      'gemini-2.5-flash',  // Always use flash for summarization
      [],  // No tools needed
      {
        jobId: `${requestId}-progress-summarization`,
        jobDefinitionId: null,
        jobName: currentJobName || 'job',
        phase: 'progress-summarization',
        projectRunId: null,
        sourceEventId: null,
        projectDefinitionId: null,
      },
      null, // No codeWorkspace for summarization agents
    );

    const agentResult = await summarizationAgent.run(prompt);
    
    if (!agentResult?.output) {
      workerLogger.warn({ requestId }, 'Summarization agent produced no output');
      return null;
    }

    const summary = agentResult.output.trim();
    
    workerLogger.info({
      requestId,
      summaryLength: summary.length,
      tokensUsed: agentResult.telemetry?.totalTokens || 0,
    }, 'AI summarization completed successfully');

    return summary;
  } catch (error: any) {
    workerLogger.error({
      requestId,
      error: serializeError(error),
    }, 'Failed to generate AI summary of workstream progress');
    return null;
  }
}

