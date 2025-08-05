import { supabase } from './shared/supabase.js';
import { z } from 'zod';

export const getContextSnapshotParams = z.object({
  lookback: z.number().int().positive().optional().default(1).describe('The number of Metacog.GenesysMetacog runs to look back.'),
});

export const getContextSnapshotSchema = {
  description: 'Fetches a snapshot of the system state based on a lookback of Metacog.GenesysMetacog runs. It always retrieves the full job_schedules and system_state tables.',
  inputSchema: {
    lookback: z.number().int().positive().optional().default(1).describe('The number of Metacog.GenesysMetacog runs to look back.')
  },
};

async function getLookbackWindow(lookback: number): Promise<{ startTime: string, endTime: string }> {
    const { data: jobs, error } = await supabase
        .from('job_board')
        .select('created_at')
        .eq('job_name', 'Metacog.GenesysMetacog')
        .eq('status', 'COMPLETED')
        .order('created_at', { ascending: false })
        .limit(lookback);

    if (error) {
        throw new Error(`Error fetching lookback window: ${error.message}`);
    }

    if (!jobs || jobs.length === 0) {
        throw new Error('No completed Metacog.GenesysMetacog jobs found to establish a lookback window.');
    }

    // The first job is the most recent (end time), the last job is the oldest (start time)
    const endTime = jobs[0].created_at;
    const startTime = jobs[jobs.length - 1].created_at;

    return { startTime, endTime };
}

async function fetchData(startTime: string) {
    const [
        systemStateRes,
        jobSchedulesRes,
        jobsRes,
        artifactsRes,
        messagesRes,
        threadsRes
    ] = await Promise.all([
        supabase.from('system_state').select('*'),
        supabase.from('job_schedules').select('id, dispatch_trigger, trigger_filter, job_definitions!inner(name, is_active)'),
        supabase.from('job_board').select('*').gte('created_at', startTime),
        supabase.from('artifacts').select('*').gte('created_at', startTime),
        supabase.from('messages').select('*').gte('created_at', startTime),
        supabase.from('threads').select('*').gte('created_at', startTime),
    ]);

    if (systemStateRes.error) throw new Error(`Error fetching system_state: ${systemStateRes.error.message}`);
    if (jobSchedulesRes.error) throw new Error(`Error fetching job_schedules: ${jobSchedulesRes.error.message}`);
    if (jobsRes.error) throw new Error(`Error fetching job_board: ${jobsRes.error.message}`);
    if (artifactsRes.error) throw new Error(`Error fetching artifacts: ${artifactsRes.error.message}`);
    if (messagesRes.error) throw new Error(`Error fetching messages: ${messagesRes.error.message}`);
    if (threadsRes.error) throw new Error(`Error fetching threads: ${threadsRes.error.message}`);

    return {
        system_state: systemStateRes.data,
        job_schedules: jobSchedulesRes.data,
        jobs_in_lookback: jobsRes.data,
        artifacts_in_lookback: artifactsRes.data,
        messages_in_lookback: messagesRes.data,
        threads_in_lookback: threadsRes.data,
    };
}

export async function getContextSnapshot(params: any) {
  try {
    const { lookback } = getContextSnapshotParams.parse(params);

    const { startTime, endTime } = await getLookbackWindow(lookback);
    
    const data = await fetchData(startTime);

    const missionRecord = data.system_state.find(s => s.key === 'mission');
    const mission = missionRecord ? missionRecord.value : 'Mission not defined in system_state.';

    const snapshot = {
      snapshot_details: {
        lookback_runs: lookback,
        start_time: startTime,
        end_time: endTime,
        generated_at: new Date().toISOString(),
      },
      mission: mission,
      ...data,
    };

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(snapshot, null, 2)
      }]
    };
  } catch (e: any) {
    return {
      content: [
        { type: 'text' as const, text: `Error getting context snapshot: ${e.message}` },
      ],
    };
  }
}