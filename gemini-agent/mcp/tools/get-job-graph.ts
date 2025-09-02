import { z } from 'zod';
import { supabase } from './shared/supabase.js';

const getJobGraphParams = z.object({
  topic: z.string().optional().describe('Optional topic to filter the graph. If omitted, returns all topics.'),
  random_string: z.string().optional().describe('Dummy parameter for no-parameter tools')
}).refine(
  (data) => {
    // Always accept - all parameters are optional
    return true;
  }
);

export type GetJobGraphParams = z.infer<typeof getJobGraphParams>;

export { getJobGraphParams };

export const getJobGraphSchema = {
  description: 'Get Job Graph - Inspect the system\'s "blueprint" of job capabilities. This tool provides static awareness of which job definitions emit artifacts and which subscribe to them, forming the foundational understanding of the system\'s event-driven architecture.',
  inputSchema: getJobGraphParams.shape,
};

/**
 * Get Job Graph - Inspect the system's "blueprint" of job capabilities
 * 
 * This tool provides static awareness of which job definitions emit artifacts
 * and which subscribe to them, forming the foundational understanding of the
 * system's event-driven architecture.
 * 
 * Supports both direct parameter calls (for agents) and random_string JSON 
 * envelope calls (for chat wrappers that require dummy parameters).
 */
export async function getJobGraph(params: GetJobGraphParams) {
  const parsedParams = getJobGraphParams.parse(params);
  
  try {
    let topic = parsedParams.topic;

    // If direct topic not provided, try parsing from random_string
    if (!topic && parsedParams.random_string) {
      try {
        const jsonParams = JSON.parse(parsedParams.random_string);
        topic = jsonParams.topic;
      } catch (parseError) {
        const result = {
          success: false,
          error: 'Failed to parse random_string as JSON',
          topic: null
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      }
    }
    
    // Call the database function
    const { data, error } = await supabase.rpc('get_job_graph_data', {
      filter_topic: topic || null
    });

    if (error) {
      throw new Error(`Database error: ${error.message}`);
    }

    if (!data || data.length === 0) {
      let result;
      if (topic) {
        result = {
          success: true,
          topic,
          publishers: [],
          subscribers: [],
          message: `No jobs found for topic: ${topic}`
        };
      } else {
        result = {
          success: true,
          topics: [],
          message: 'No active job definitions with artifact relationships found'
        };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }

    let result;
    if (topic) {
      // Single topic response
      const topicData = data[0];
      result = {
        success: true,
        topic: topicData.topic,
        publishers: topicData.publishers,
        subscribers: topicData.subscribers,
        publisher_count: topicData.publishers.length,
        subscriber_count: topicData.subscribers.length
      };
    } else {
      // Multiple topics response
      result = {
        success: true,
        topics: data.map((item: any) => ({
          topic: item.topic,
          publishers: item.publishers,
          subscribers: item.subscribers,
          publisher_count: item.publishers.length,
          subscriber_count: item.subscribers.length
        })),
        total_topics: data.length,
        summary: {
          system_topics: data.filter((item: any) => item.topic.startsWith('system.')).length,
          application_topics: data.filter((item: any) => !item.topic.startsWith('system.')).length
        }
      };
    }

    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    console.error('Error in getJobGraph:', error);
    const result = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      topic: parsedParams.topic || null
    };
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }
}