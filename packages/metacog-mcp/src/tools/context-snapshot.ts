import { supabase } from './shared/supabase.js';
import { z } from 'zod';
import { calculateDataSize, bytesToMB, DEFAULT_SIZE_LIMIT_MB, truncateContent } from './shared/data-size-limiter.js';

export const getContextSnapshotParams = z.object({
  hours_back: z.number().positive().optional().default(6).describe('Number of hours to look back from now (max 12 hours).'),
  job_name: z.string().optional().describe('Optional job name to filter messages for. Shows only messages directed to this job, including content.'),
});

export const getContextSnapshotSchema = {
  description: 'Fetches a snapshot of the system state based on a time window. Optimized for Gemini 1M token context window. Messages only included when filtering by job name.',
  inputSchema: {
    hours_back: z.number().positive().optional().default(6).describe('Number of hours to look back from now (max 12 hours).'),
    job_name: z.string().optional().describe('Optional job name to filter messages for. Shows only messages directed to this job, including content.')
  },
};

function getTimeWindow(hoursBack: number): { startTime: string, endTime: string, cappedHours: number } {
    // Cap at 12 hours maximum
    const cappedHours = Math.min(hoursBack, 12);
    
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - (cappedHours * 60 * 60 * 1000));
    
    return { 
        startTime: startTime.toISOString(), 
        endTime: endTime.toISOString(),
        cappedHours
    };
}

async function fetchData(startTime: string, jobName?: string, limits = { jobs: 50, artifacts: 20, threads: 15 }) {
    // Fetch data sequentially to avoid TypeScript promise type issues
    const systemStateRes = await supabase.from('system_state').select('key, value, updated_at');
    const jobSchedulesRes = await supabase.from('job_schedules').select('id, dispatch_trigger, trigger_filter, job_name, job_definitions!inner(name, is_active)');
    
    const jobsRes = await supabase.from('job_board')
        .select('id, status, job_name, created_at, updated_at, job_report_id, output')
        .gte('created_at', startTime)
        .order('created_at', { ascending: false })
        .limit(limits.jobs);
        
    const artifactsRes = await supabase.from('artifacts')
        .select('id, topic, status, source_job_name, thread_id, content, created_at, updated_at')
        .gte('created_at', startTime)
        .order('created_at', { ascending: false })
        .limit(limits.artifacts);
        
    const threadsRes = await supabase.from('threads')
        .select('id, title, status, objective, summary, parent_thread_id, created_at, updated_at')
        .gte('created_at', startTime)
        .order('created_at', { ascending: false })
        .limit(limits.threads);
        
    const jobReportsRes = await supabase.from('job_reports')
        .select('id, job_id, total_tokens, duration_ms, status, created_at')
        .gte('created_at', startTime)
        .order('created_at', { ascending: false })
        .limit(limits.jobs);

    // Add message query only if job_name is provided
    const messagesRes = jobName ? await supabase.from('messages')
        .select('id, from_agent, to_agent, created_at, status, content')
        .gte('created_at', startTime)
        .eq('to_agent', jobName)
        .order('status', { ascending: true }) // Prioritize unread (pending) messages
        .order('created_at', { ascending: false })
        .limit(10) : null;

    if (systemStateRes.error) throw new Error(`Error fetching system_state: ${systemStateRes.error.message}`);
    if (jobSchedulesRes.error) throw new Error(`Error fetching job_schedules: ${jobSchedulesRes.error.message}`);
    if (jobsRes.error) throw new Error(`Error fetching job_board: ${jobsRes.error.message}`);
    if (artifactsRes.error) throw new Error(`Error fetching artifacts: ${artifactsRes.error.message}`);
    if (threadsRes.error) throw new Error(`Error fetching threads: ${threadsRes.error.message}`);
    if (jobReportsRes.error) throw new Error(`Error fetching job_reports: ${jobReportsRes.error.message}`);
    if (messagesRes && messagesRes.error) throw new Error(`Error fetching messages: ${messagesRes.error.message}`);

    return {
        system_state: systemStateRes.data,
        job_schedules: jobSchedulesRes.data,
        jobs_in_window: jobsRes.data,
        artifacts_in_window: artifactsRes.data,
        messages_in_window: messagesRes ? messagesRes.data : [],
        threads_in_window: threadsRes.data,
        job_reports_in_window: jobReportsRes.data,
    };
}


function formatSnapshot(data: any, timeWindow: { startTime: string, endTime: string }, originalHours: number, actualHours: number, jobName?: string) {
    const missionRecord = data.system_state.find((s: any) => s.key === 'mission');
    const mission = missionRecord ? missionRecord.value : 'Mission not defined in system_state.';

    // Create AI-friendly structured output
    const windowReduced = actualHours < originalHours;
    
    let output = `## System Context Snapshot${jobName ? ` (Job: ${jobName})` : ''}

🎯 **PRIMARY MISSION**
${typeof mission === 'string' ? mission : JSON.stringify(mission, null, 2)}

### Time Window
- **Requested**: ${originalHours} hours back
- **Actual**: ${actualHours} hours back ${windowReduced ? '(reduced due to data size limits)' : ''}
- **Period**: ${new Date(timeWindow.startTime).toLocaleString()} to ${new Date(timeWindow.endTime).toLocaleString()}

### System Health Overview
- **Job Schedules Active**: ${data.job_schedules.filter((s: any) => s.job_definitions?.is_active).length}/${data.job_schedules.length}
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
    jobLine += `\n  Output: ${job.output.substring(0, 200)}...`;
  } else if (job.output) {
    jobLine += `\n  Output: ${job.output}`;
  }
  return jobLine;
}).join('\n')}

### Recent Artifacts
${data.artifacts_in_window.slice(0, 10).map((artifact: any) => {
  let artifactLine = `- **[${artifact.topic || 'No Topic'}]** ${artifact.status} - by ${artifact.source || 'Unknown'}${artifact.thread_id ? ` (Thread: ${artifact.thread_id})` : ''} (${new Date(artifact.created_at).toLocaleString()})`;
  
  if (artifact.content) {
    const truncatedContent = truncateContent(artifact.content);
    artifactLine += `\n  Content: ${truncatedContent}`;
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
  let msgLine = `- **From ${message.from_agent}** [${message.status}] (${new Date(message.created_at).toLocaleString()})`;
  if (message.content) msgLine += `\n  ${message.content}`;
  return msgLine;
}).join('\n')}`;
    } else if (!jobName && data.messages_in_window.length > 0) {
        output += `\n\n### Recent Messages
${data.messages_in_window.slice(0, 5).map((message: any) => 
  `- **${message.from_agent}** → **${message.to_agent}** [${message.status}] (${new Date(message.created_at).toLocaleString()})`
).join('\n')}`;
    }

    output += `\n\n### Active Job Schedules
${data.job_schedules.filter((s: any) => s.job_definitions?.is_active).map((schedule: any) => 
  `- **${schedule.job_name}**: ${schedule.dispatch_trigger} ${schedule.trigger_filter ? `with filter ${JSON.stringify(schedule.trigger_filter)}` : ''}`
).join('\n')}

### System State
${data.system_state.map((state: any) => `- **${state.key}**: ${typeof state.value === 'string' ? state.value : JSON.stringify(state.value)}`).join('\n')}

### Raw Data Summary
- Jobs: ${data.jobs_in_window.length} records
- Artifacts: ${data.artifacts_in_window.length} records  
- Messages: ${data.messages_in_window.length} records
- Threads: ${data.threads_in_window.length} records
- Schedules: ${data.job_schedules.length} active schedules
- System State: ${data.system_state.length} key-value pairs`;

    return output;
}

export async function getContextSnapshot(params: any) {
  try {
    const { hours_back, job_name } = getContextSnapshotParams.parse(params);
    const max_size_mb = DEFAULT_SIZE_LIMIT_MB; // Internal default: ~600KB for safe 1M token context window

    let currentHours = hours_back;
    let attempts = 0;
    const maxAttempts = 4; // Will try: full -> half -> quarter -> eighth
    
    while (attempts < maxAttempts) {
      attempts++;
      
      const { startTime, endTime, cappedHours } = getTimeWindow(currentHours);
      currentHours = cappedHours; // Use the capped hours for consistent logic
      const data = await fetchData(startTime, job_name);
      
      // Calculate data size
      const dataSizeBytes = calculateDataSize(data);
      const dataSizeMB = bytesToMB(dataSizeBytes);
      
      if (dataSizeMB <= max_size_mb) {
        // Size is acceptable, format and return
        const formattedOutput = formatSnapshot(data, { startTime, endTime }, hours_back, currentHours, job_name);
        
        return {
          content: [{
            type: 'text' as const,
            text: formattedOutput
          }]
        };
      }
      
      // Data too large, reduce window by half and try again
      currentHours = Math.max(0.5, currentHours / 2); // Minimum 30 minutes
    }
    
    // If we get here, even the smallest window was too large
    throw new Error(`Unable to fetch context snapshot within size limit of ${max_size_mb}MB even with minimum window size`);
    
  } catch (e: any) {
    return {
      content: [
        { type: 'text' as const, text: `Error getting context snapshot: ${e.message}` },
      ],
    };
  }
}