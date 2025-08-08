import { supabase } from './shared/supabase.js';
import { z } from 'zod';
import { composeSinglePageResponse, decodeCursor } from './shared/context-management.js';

export const getContextSnapshotParams = z.object({
  hours_back: z.number().positive().optional().default(6).describe('Number of hours to look back from now.'),
  job_name: z.string().optional().describe('Optional job name to filter messages for. Shows only messages directed to this job, including content.'),
  cursor: z.string().optional().describe('Opaque cursor for fetching the next page of results.'),
});

export const getContextSnapshotSchema = {
  description: 'Fetches a snapshot of the system state based on a time window. Optimized for Gemini 1M token context window. Messages only included when filtering by job name.',
  inputSchema: {
    hours_back: z.number().positive().optional().default(6).describe('Number of hours to look back from now.'),
    job_name: z.string().optional().describe('Optional job name to filter messages for. Shows only messages directed to this job, including content.'),
    cursor: z.string().optional().describe('Opaque cursor for fetching the next page of results.'),
  },
};

function getTimeWindow(hoursBack: number): { startTime: string, endTime: string, cappedHours: number } {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - (hoursBack * 60 * 60 * 1000));
    return { startTime: startTime.toISOString(), endTime: endTime.toISOString(), cappedHours: hoursBack };
}

async function fetchData(startTime: string, jobName?: string) {
    // Fetch data sequentially to avoid TypeScript promise type issues
    const systemStateRes = await supabase.from('system_state').select('key, value, updated_at');
    const unifiedJobsRes = await supabase.from('jobs').select('id, name, description, schedule_config, is_active, created_at, updated_at');
    
    const jobsRes = await supabase.from('job_board')
        .select('id, status, job_name, created_at, updated_at, job_report_id, output')
        .gte('created_at', startTime)
        .order('created_at', { ascending: false });
        
    const artifactsRes = await supabase.from('artifacts')
        .select('id, topic, status, source_job_name, thread_id, content, created_at, updated_at')
        .gte('created_at', startTime)
        .order('created_at', { ascending: false });
        
    const threadsRes = await supabase.from('threads')
        .select('id, title, status, objective, summary, parent_thread_id, created_at, updated_at')
        .gte('created_at', startTime)
        .order('created_at', { ascending: false });
        
    const jobReportsRes = await supabase.from('job_reports')
        .select('id, job_id, total_tokens, duration_ms, status, created_at')
        .gte('created_at', startTime)
        .order('created_at', { ascending: false });

    // Add message query only if job_name is provided
    const messagesRes = jobName ? await supabase.from('messages')
        .select('id, to_agent, created_at, status, content, source_job_name')
        .gte('created_at', startTime)
        .eq('to_agent', jobName)
        .order('status', { ascending: true }) // Prioritize unread (pending) messages
        .order('created_at', { ascending: false }) : null;

    if (systemStateRes.error) throw new Error(`Error fetching system_state: ${systemStateRes.error.message}`);
    if (unifiedJobsRes.error) throw new Error(`Error fetching unified jobs: ${unifiedJobsRes.error.message}`);
    if (jobsRes.error) throw new Error(`Error fetching job_board: ${jobsRes.error.message}`);
    if (artifactsRes.error) throw new Error(`Error fetching artifacts: ${artifactsRes.error.message}`);
    if (threadsRes.error) throw new Error(`Error fetching threads: ${threadsRes.error.message}`);
    if (jobReportsRes.error) throw new Error(`Error fetching job_reports: ${jobReportsRes.error.message}`);
    if (messagesRes && messagesRes.error) throw new Error(`Error fetching messages: ${messagesRes.error.message}`);

    return {
        system_state: systemStateRes.data,
        unified_jobs: unifiedJobsRes.data,
        jobs_in_window: jobsRes.data,
        artifacts_in_window: artifactsRes.data,
        messages_in_window: messagesRes ? messagesRes.data : [],
        threads_in_window: threadsRes.data,
        job_reports_in_window: jobReportsRes.data,
    };
}


function formatSnapshot(data: any, timeWindow: { startTime: string, endTime: string }, originalHours: number, actualHours: number, jobName?: string) {
    // Look for mission and strategy separately
    const missionRecord = data.system_state.find((s: any) => s.key === 'mission');
    const strategyRecord = data.system_state.find((s: any) => s.key === 'strategy');
    
    const mission = missionRecord ? missionRecord.value : 'Mission not defined in system_state.';
    const strategy = strategyRecord ? strategyRecord.value : null;

    // Create AI-friendly structured output
    const windowReduced = actualHours < originalHours;
    
    let output = `## System Context Snapshot${jobName ? ` (Job: ${jobName})` : ''}

🎯 **PRIMARY MISSION**
${typeof mission === 'string' ? mission : JSON.stringify(mission, null, 2)}`;

    // Add strategy section if available
    if (strategy) {
        output += `

�� **STRATEGY**
${typeof strategy === 'string' ? strategy : JSON.stringify(strategy, null, 2)}`;
    }

    output += `

### Time Window
- **Requested**: ${originalHours} hours back
- **Actual**: ${actualHours} hours back ${windowReduced ? '(reduced due to data size limits)' : ''}
- **Period**: ${new Date(timeWindow.startTime).toLocaleString()} to ${new Date(timeWindow.endTime).toLocaleString()}

### System Health Overview
- **Job Definitions Active**: ${data.unified_jobs.filter((j: any) => j.is_active).length}/${data.unified_jobs.length}
- **Recent Jobs**: ${data.jobs_in_window.length} in time window
- **Recent Artifacts**: ${data.artifacts_in_window.length} created
- **Active Threads**: ${data.threads_in_window.length}
- **Messages**: ${data.messages_in_window.length}${jobName ? ` (filtered for job: ${jobName})` : ''}

### Recent Job Activity
${data.jobs_in_window.slice(0, 10).map((job: any) => {
  // Find matching job report for token data
  const jobReport = data.job_reports_in_window?.find((report: any) => report.job_id === job.id);
  const tokens = jobReport?.total_tokens || 0;
  const duration = jobReport?.duration_ms ? `${jobReport.duration_ms}ms` : 'N/A';
  
  let jobLine = `- **${job.job_name}** [${job.status}] - ${tokens} tokens, ${duration}`;
  if (job.job_report_id) jobLine += ` (Report: ${job.job_report_id})`;
  jobLine += ` (${new Date(job.created_at).toLocaleString()})`;
  if (job.output && job.output.length > 100) {
    jobLine += `\n  Output: ${job.output.substring(0, 500)}...`;
  } else if (job.output) {
    jobLine += `\n  Output: ${job.output}`;
  }
  return jobLine;
}).join('\n')}

### Recent Artifacts
${data.artifacts_in_window.slice(0, 10).map((artifact: any) => {
  let artifactLine = `- **[${artifact.topic || 'No Topic'}]** ${artifact.status} - by ${artifact.source || 'Unknown'}${artifact.thread_id ? ` (Thread: ${artifact.thread_id})` : ''} (${new Date(artifact.created_at).toLocaleString()})`;
  
  if (artifact.content) {
    artifactLine += `\n  Content: ${artifact.content}`;
  }
  
  return artifactLine;
}).join('\n')}

### Active Threads
${data.threads_in_window.slice(0, 10).map((thread: any) => {
  let threadLine = `- **${thread.title}** [${thread.status}]${thread.parent_thread_id ? ` (Child of: ${thread.parent_thread_id})` : ''}`;
  if (thread.objective) threadLine += `\n  Objective: ${thread.objective}`;
  if (thread.summary) threadLine += `\n  Summary: ${JSON.stringify(thread.summary).substring(0, 150)}...`;
  threadLine += ` (${new Date(thread.created_at).toLocaleString()})`;
  return threadLine;
}).join('\n')}`

    // Add job-specific messages section if filtering by job
    if (jobName && data.messages_in_window.length > 0) {
        output += `\n\n### Messages for ${jobName}
${data.messages_in_window.map((message: any) => {
  let msgLine = `- **From ${message.source_job_name || "Unknown"}** [${message.status}] (${new Date(message.created_at).toLocaleString()})`;
  if (message.content) msgLine += `\n  ${message.content}`;
  return msgLine;
}).join('\n')}`;
    } else if (!jobName && data.messages_in_window.length > 0) {
        output += `\n\n### Recent Messages
${data.messages_in_window.slice(0, 5).map((message: any) => 
  `- **${message.source_job_name || "Unknown"}** → **${message.to_agent}** [${message.status}] (${new Date(message.created_at).toLocaleString()})`
).join('\n')}`;
    }

    output += `\n\n### Active Job Definitions  
${data.unified_jobs.filter((j: any) => j.is_active).map((job: any) => 
  `- **${job.name}**: ${job.schedule_config.trigger} ${job.schedule_config.filters ? `with filter ${JSON.stringify(job.schedule_config.filters)}` : ''}`
).join('\n')}

### System State
${data.system_state.map((state: any) => `- **${state.key}**: ${typeof state.value === 'string' ? state.value : JSON.stringify(state.value)}`).join('\n')}

### Raw Data Summary
- Jobs: ${data.jobs_in_window.length} records
- Artifacts: ${data.artifacts_in_window.length} records  
- Messages: ${data.messages_in_window.length} records
- Threads: ${data.threads_in_window.length} records
- Job Definitions: ${data.unified_jobs.length} total (${data.unified_jobs.filter((j: any) => j.is_active).length} active)
- System State: ${data.system_state.length} key-value pairs`;

    return output;
}

export async function getContextSnapshot(params: any) {
  try {
    const parseResult = getContextSnapshotParams.safeParse(params);
    if (!parseResult.success) {
      return {
        isError: true,
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ ok: false, code: 'VALIDATION_ERROR', message: `Invalid parameters: ${parseResult.error.message}`, details: parseResult.error.flatten?.() ?? undefined }, null, 2)
        }]
      };
    }
    const { hours_back, job_name, cursor } = parseResult.data;

    const { startTime, endTime, cappedHours } = getTimeWindow(hours_back);
    const data = await fetchData(startTime, job_name);

    // Build a single page from a flattened list of "items" for pagination purposes
    const items = [
      ...data.jobs_in_window.map((r: any) => ({ _type: 'job', ...r })),
      ...data.artifacts_in_window.map((r: any) => ({ _type: 'artifact', ...r })),
      ...data.threads_in_window.map((r: any) => ({ _type: 'thread', ...r })),
      ...data.messages_in_window.map((r: any) => ({ _type: 'message', ...r })),
      ...data.unified_jobs.map((r: any) => ({ _type: 'definition', ...r })),
      ...data.system_state.map((r: any) => ({ _type: 'system_state', ...r })),
    ];

    const keyset = decodeCursor<{ offset: number }>(cursor) ?? { offset: 0 };
    const composed = composeSinglePageResponse(items, {
      startOffset: keyset.offset,
      truncationPolicy: { output: 500, content: 200 },
      requestedMeta: { cursor, hours_back, job_name },
    });

    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: composed.data, meta: composed.meta }, null, 2) }] };
  } catch (e: any) {
    return {
      isError: true,
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ ok: false, code: 'RUNTIME_ERROR', message: `Error getting context snapshot: ${e.message}` }, null, 2)
      }]
    };
  }
}
