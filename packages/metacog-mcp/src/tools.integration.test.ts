import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { supabase } from './tools/shared/supabase.js';
import { createJob, getContextSnapshot, listTools, manageArtifact, manageThread, getDetails, createMemory, searchMemories } from './tools/index.js';
import { serverTools } from './server.js';

describe('Database Tools Integration Tests', () => {
  
  describe('get_schema Tool', () => {
    it('should return a list of all allowed tables', async () => {
      const { data, error } = await supabase.rpc('get_all_tables');
      expect(error).toBeNull();
      expect(data).toBeInstanceOf(Array);
      const tableNames = data.map((t: any) => t.table_name);
      expect(tableNames).toContain('job_board');
      expect(tableNames).toContain('artifacts');
    });

    it('should return the schema for a specific table', async () => {
      const { data, error } = await supabase.rpc('get_table_schema', {
        p_table_name: 'artifacts',
      });
      expect(error).toBeNull();
      expect(data).toBeInstanceOf(Array);
      expect(data.length).toBeGreaterThan(0);
      const columnNames = data.map((col: any) => col.column_name);
      expect(columnNames).toContain('thread_id');
    });
  });

  describe('manage_artifact Tool', () => {
    let testThreadId: string | null = null;
    let testArtifactId: string | null = null;

    beforeEach(async () => {
      const { data, error } = await supabase.from('threads').insert({ title: 'Test Thread', objective: 'Test Objective' }).select().single();
      expect(error).toBeNull();
      testThreadId = data.id;
    });

    afterEach(async () => {
      if (testArtifactId) await supabase.from('artifacts').delete().match({ id: testArtifactId });
      if (testThreadId) await supabase.from('threads').delete().match({ id: testThreadId });
      testArtifactId = null;
      testThreadId = null;
    });

    it('should CREATE a new artifact', async () => {
      const result = await manageArtifact({ thread_id: testThreadId!, operation: 'REPLACE', content: 'Initial content.' });
      const resultData = JSON.parse(result.content[0].text);
      testArtifactId = resultData.id;
      expect(resultData.thread_id).toBe(testThreadId);
      expect(resultData.status).toBe('RAW');
    });
    
    it('should fail to CREATE an artifact without a thread_id', async () => {
        const result = await manageArtifact({ operation: 'REPLACE', content: 'This should fail.' });
        expect(result.content[0].text).toContain("`thread_id` is required to create a new artifact.");
    });

    it('should UPDATE an artifact with REPLACE operation', async () => {
        const { data: artifact } = await supabase.from('artifacts').insert({ thread_id: testThreadId!, content: 'Original' }).select().single();
        testArtifactId = artifact.id;
        const result = await manageArtifact({ artifact_id: testArtifactId!, operation: 'REPLACE', content: 'Replaced content.' });
        const resultData = JSON.parse(result.content[0].text);
        expect(resultData.content).toBe('Replaced content.');
    });

    it('should UPDATE an artifact with APPEND operation', async () => {
        const { data: artifact } = await supabase.from('artifacts').insert({ thread_id: testThreadId!, content: 'Original.' }).select().single();
        testArtifactId = artifact.id;
        const result = await manageArtifact({ artifact_id: testArtifactId!, operation: 'APPEND', content: ' Appended.' });
        const resultData = JSON.parse(result.content[0].text);
        expect(resultData.content).toBe('Original. Appended.');
    });

    it('should UPDATE an artifact with PREPEND operation', async () => {
        const { data: artifact } = await supabase.from('artifacts').insert({ thread_id: testThreadId!, content: 'Original.' }).select().single();
        testArtifactId = artifact.id;
        const result = await manageArtifact({ artifact_id: testArtifactId!, operation: 'PREPEND', content: 'Prepended. ' });
        const resultData = JSON.parse(result.content[0].text);
        expect(resultData.content).toBe('Prepended. Original.');
    });
    
    it('should UPDATE an artifact metadata', async () => {
        const { data: artifact } = await supabase.from('artifacts').insert({ thread_id: testThreadId!, content: 'Content' }).select().single();
        testArtifactId = artifact.id;
        const result = await manageArtifact({ artifact_id: testArtifactId!, operation: 'REPLACE', content: 'Content', topic: 'new-topic', status: 'PROCESSED' });
        const resultData = JSON.parse(result.content[0].text);
        expect(resultData.topic).toBe('new-topic');
        expect(resultData.status).toBe('PROCESSED');
    });

    it('should fail to UPDATE a non-existent artifact', async () => {
        const nonExistentId = '00000000-0000-0000-0000-000000000000';
        const result = await manageArtifact({ artifact_id: nonExistentId, operation: 'REPLACE', content: 'This should fail.' });
        expect(result.content[0].text).toContain('Failed to update artifact');
    });
  });

  describe('manage_thread Tool', () => {
    let testThreadId: string | null = null;

    afterEach(async () => {
      if (testThreadId) await supabase.from('threads').delete().match({ id: testThreadId });
      testThreadId = null;
    });

    it('should CREATE a new thread', async () => {
      const result = await manageThread({ title: 'Test Create Thread', objective: 'Test objective' });
      const resultData = JSON.parse(result.content[0].text);
      testThreadId = resultData.id;
      expect(resultData.title).toBe('Test Create Thread');
    });

    it('should fail to CREATE a thread without title or objective', async () => {
        const result = await manageThread({ title: 'Test' });
        expect(result.content[0].text).toContain('`title` and `objective` are required');
    });

    it('should UPDATE an existing thread', async () => {
      const { data: thread } = await supabase.from('threads').insert({ title: 'Original Title', objective: 'Original Objective' }).select().single();
      testThreadId = thread.id;
      const result = await manageThread({ thread_id: testThreadId!, status: 'COMPLETED' });
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.status).toBe('COMPLETED');
    });

    it('should fail to UPDATE a thread with no properties', async () => {
        const { data: thread } = await supabase.from('threads').insert({ title: 'Original Title', objective: 'Original Objective' }).select().single();
        testThreadId = thread.id;
        const result = await manageThread({ thread_id: testThreadId! });
        expect(result.content[0].text).toContain('Nothing to update');
    });
  });

  describe('get_details Tool', () => {
    let testThreadId: string | null = null;
    let testArtifactIds: string[] = [];

    beforeEach(async () => {
      const { data: thread } = await supabase.from('threads').insert({ title: 'Get Details Test', objective: 'An objective' }).select().single();
      testThreadId = thread.id;
      const { data: artifacts } = await supabase.from('artifacts').insert([
        { thread_id: testThreadId!, content: 'Artifact 1' },
        { thread_id: testThreadId!, content: 'Artifact 2' },
      ]).select();
      testArtifactIds = artifacts.map(a => a.id);
    });

    afterEach(async () => {
      if (testArtifactIds.length > 0) await supabase.from('artifacts').delete().in('id', testArtifactIds);
      if (testThreadId) await supabase.from('threads').delete().match({ id: testThreadId });
      testArtifactIds = [];
      testThreadId = null;
    });

    it('should get a thread and its artifact_ids', async () => {
      const result = await getDetails({ table_name: 'threads', ids: [testThreadId!] });
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData[0].artifact_ids).toHaveLength(2);
    });

    it('should get multiple artifacts by their IDs', async () => {
      const result = await getDetails({ table_name: 'artifacts', ids: testArtifactIds });
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData).toHaveLength(2);
    });

    it('should return an empty array for non-existent IDs', async () => {
        const nonExistentId = '00000000-0000-0000-0000-000000000000';
        const result = await getDetails({ table_name: 'threads', ids: [nonExistentId] });
        const resultData = JSON.parse(result.content[0].text);
        expect(resultData).toHaveLength(0);
    });

    it('should handle empty ids array gracefully', async () => {
        const result = await getDetails({ table_name: 'threads', ids: [] });
        const resultData = JSON.parse(result.content[0].text);
        expect(resultData).toHaveLength(0);
        expect(Array.isArray(resultData)).toBe(true);
    });
  });
  
  describe('list_tools Tool', () => {
    it('should list all available tools', async () => {
      const result = await listTools({}, serverTools);
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.tools).toHaveLength(14);
    });
  });

  describe('get_context_snapshot Tool', () => {
    let testThreadId: string | null = null;
    let testArtifactId: string | null = null;
    let testJobName: string | null = null;

    beforeEach(async () => {
      // Create test data to populate the context snapshot
      const { data: thread } = await supabase.from('threads').insert({ 
        title: 'Context Test Thread', 
        objective: 'Test objective for context',
        summary: { key: 'test summary data' }
      }).select().single();
      testThreadId = thread.id;

      const { data: artifact } = await supabase.from('artifacts').insert({ 
        thread_id: testThreadId!, 
        content: 'This is a test artifact with some meaningful content that provides context about what this artifact contains and represents in the system.',
        topic: 'test-topic',
        source: 'test-job'
      }).select().single();
      testArtifactId = artifact.id;

      // Create a test job entry
      testJobName = 'test-context-job';
      const { data: job, error: jobError } = await supabase.from('job_board').insert({
        job_name: testJobName,
        status: 'COMPLETED',
        output: 'Test job completed successfully',
        input_prompt: 'Test prompt' // Required field
      }).select().single();
      
      if (jobError || !job) {
        console.error('Job creation failed:', jobError);
        return; // Skip if job creation fails
      }
      
      // Create a job report with token data
      await supabase.from('job_reports').insert({
        job_id: job.id,
        worker_id: 'test-worker',
        status: 'COMPLETED',
        duration_ms: 5000,
        total_tokens: 1500
      });

      // Create test messages
      await supabase.from('messages').insert([
        {
          from_agent: 'test-sender',
          to_agent: testJobName,
          content: 'Test message for specific job',
          status: 'PENDING'
        },
        {
          from_agent: 'other-sender', 
          to_agent: 'other-job',
          content: 'Message for different job',
          status: 'READ'
        }
      ]);
    });

    afterEach(async () => {
      // Clean up test data
      await supabase.from('messages').delete().gte('created_at', new Date(Date.now() - 1000 * 60 * 60).toISOString());
      await supabase.from('job_reports').delete().gte('created_at', new Date(Date.now() - 1000 * 60 * 60).toISOString());
      await supabase.from('job_board').delete().eq('job_name', testJobName!);
      if (testArtifactId) await supabase.from('artifacts').delete().match({ id: testArtifactId });
      if (testThreadId) await supabase.from('threads').delete().match({ id: testThreadId });
      testThreadId = null;
      testArtifactId = null;
      testJobName = null;
    });

    it('should return context snapshot with default time window (6 hours)', async () => {
      const result = await getContextSnapshot({});
      expect(result.content[0].text).toContain('## System Context Snapshot');
      expect(result.content[0].text).toContain('🎯 **PRIMARY MISSION**');
      expect(result.content[0].text).toContain('### Time Window');
      expect(result.content[0].text).toContain('- **Requested**: 6 hours back');
      expect(result.content[0].text).toContain('### System Health Overview');
    });

    it('should respect custom time window (max 12 hours)', async () => {
      const result = await getContextSnapshot({ hours_back: 8 });
      expect(result.content[0].text).toContain('- **Requested**: 8 hours back');
      expect(result.content[0].text).toContain('- **Actual**: 8 hours back');
    });

    it('should cap time window at 12 hours maximum', async () => {
      const result = await getContextSnapshot({ hours_back: 24 });
      expect(result.content[0].text).toContain('- **Requested**: 24 hours back');
      expect(result.content[0].text).toContain('- **Actual**: 12 hours back');
    });

    it('should include job-specific messages when job_name is provided', async () => {
      const result = await getContextSnapshot({ job_name: testJobName! });
      expect(result.content[0].text).toContain(`## System Context Snapshot (Job: ${testJobName})`);
      expect(result.content[0].text).toContain(`### Messages for ${testJobName}`);
      expect(result.content[0].text).toContain('Test message for specific job');
      expect(result.content[0].text).not.toContain('Message for different job');
    });

    it('should exclude messages when no job_name is provided', async () => {
      const result = await getContextSnapshot({});
      // Should not contain the detailed messages section for a specific job
      expect(result.content[0].text).not.toContain('### Messages for');
      expect(result.content[0].text).not.toContain('Test message for specific job');
      // Should show message count in overview
      expect(result.content[0].text).toContain('- **Messages**: 0');
    });

    it('should include enhanced fields in job activity', async () => {
      const result = await getContextSnapshot({});
      expect(result.content[0].text).toContain('### Recent Job Activity');
      expect(result.content[0].text).toContain(testJobName!);
      expect(result.content[0].text).toContain('1500 tokens');
      expect(result.content[0].text).toContain('5000ms');
      expect(result.content[0].text).toContain('Test job completed successfully');
    });

    it('should include enhanced fields in artifacts and threads', async () => {
      const result = await getContextSnapshot({});
      expect(result.content[0].text).toContain('### Recent Artifacts');
      expect(result.content[0].text).toContain('test-topic');
      expect(result.content[0].text).toContain(`Thread: ${testThreadId}`);
      expect(result.content[0].text).toContain('Content: This is a test artifact with some meaningful content');
      
      expect(result.content[0].text).toContain('### Active Threads');
      expect(result.content[0].text).toContain('Context Test Thread');
      expect(result.content[0].text).toContain('Objective: Test objective for context');
      expect(result.content[0].text).toContain('Summary: {"key":"test summary data"}');
    });

    it('should handle empty results gracefully', async () => {
      // Clean up all test data first to ensure empty results
      await supabase.from('messages').delete().gte('created_at', new Date(Date.now() - 1000 * 60 * 60).toISOString());
      await supabase.from('job_reports').delete().gte('created_at', new Date(Date.now() - 1000 * 60 * 60).toISOString());
      await supabase.from('job_board').delete().eq('job_name', testJobName!);
      if (testArtifactId) await supabase.from('artifacts').delete().match({ id: testArtifactId });
      if (testThreadId) await supabase.from('threads').delete().match({ id: testThreadId });
      
      // Use a very short time window to get no results
      const result = await getContextSnapshot({ hours_back: 0.0001 });
      expect(result.content[0].text).toContain('## System Context Snapshot');
      expect(result.content[0].text).toContain('- **Recent Jobs**: 0 in time window');
      expect(result.content[0].text).toContain('- **Recent Artifacts**: 0 created');
    });

    it('should emphasize mission from system_state', async () => {
      // First, let's set a mission in system_state
      await supabase.from('system_state').upsert({ 
        key: 'mission', 
        value: 'Test mission: Optimize system performance and reliability' 
      });

      const result = await getContextSnapshot({});
      expect(result.content[0].text).toContain('🎯 **PRIMARY MISSION**');
      expect(result.content[0].text).toContain('Test mission: Optimize system performance and reliability');

      // Clean up
      await supabase.from('system_state').delete().eq('key', 'mission');
    });

    it('should show default mission message when not defined', async () => {
      // Ensure no mission is set
      await supabase.from('system_state').delete().eq('key', 'mission');
      
      const result = await getContextSnapshot({});
      expect(result.content[0].text).toContain('🎯 **PRIMARY MISSION**');
      expect(result.content[0].text).toContain('Mission not defined in system_state.');
    });

    it('should handle data size management gracefully', async () => {
      // Test that the function completes without errors even with the internal size limit
      const result = await getContextSnapshot({ hours_back: 12 });
      expect(result.content[0].text).toContain('## System Context Snapshot');
      expect(result.content[0].text).toContain('### Raw Data Summary');
      // Should not contain error messages
      expect(result.content[0].text).not.toContain('Error getting context snapshot');
    });

    it('should truncate long artifact content to approximately 200 words', async () => {
      // Create an artifact with very long content
      const longContent = 'This is a very long artifact content that exceeds 200 words. '.repeat(50); // ~350 words
      const { data: longArtifact } = await supabase.from('artifacts').insert({
        thread_id: testThreadId!,
        content: longContent,
        topic: 'long-content-test',
        source: 'test-truncation'
      }).select().single();

      const result = await getContextSnapshot({});
      
      // Should contain the artifact but with truncated content
      expect(result.content[0].text).toContain('long-content-test');
      expect(result.content[0].text).toContain('Content:');
      expect(result.content[0].text).toContain('...');
      
      // Content should be significantly shorter than the original
      const contentMatch = result.content[0].text.match(/Content: ([^\n]+)/);
      if (contentMatch) {
        const displayedContent = contentMatch[1];
        expect(displayedContent.length).toBeLessThan(longContent.length / 2);
      }

      // Clean up the long artifact
      await supabase.from('artifacts').delete().match({ id: longArtifact.id });
    });
  });

  describe('Memory Tools', () => {
    let testMemoryId1: string | null = null;
    let testMemoryId2: string | null = null;

    afterEach(async () => {
      // Use a direct delete without relying on the tool to ensure cleanup
      // Delete the referencing memory first to avoid foreign key constraints
      if (testMemoryId2) await supabase.from('memories').delete().eq('id', testMemoryId2);
      if (testMemoryId1) await supabase.from('memories').delete().eq('id', testMemoryId1);
      testMemoryId1 = null;
      testMemoryId2 = null;
    });

    it('should create a memory and verify its existence in the DB', async () => {
      const content = 'The sky is blue on a clear day.';
      const createResult = await createMemory({ content, metadata: { type: 'fact' } });
      const createData = JSON.parse(createResult.content[0].text);
      testMemoryId1 = createData.memory_id;
      expect(createData.success).toBe(true);

      // Deep verification
      const { data: memory, error } = await supabase.from('memories').select().eq('id', testMemoryId1).single();
      expect(error).toBeNull();
      expect(memory).toBeDefined();
      expect(memory.content).toBe(content);
      expect(memory.embedding).toBeDefined();
    }, 10000);

    it('should create linked memories and retrieve them', async () => {
      const causeContent = 'An experiment was planned to test the new algorithm.';
      const createResult1 = await createMemory({ content: causeContent, metadata: { type: 'plan' } });
      const createData1 = JSON.parse(createResult1.content[0].text);
      testMemoryId1 = createData1.memory_id;

      const effectContent = 'The experiment succeeded, showing a 20% performance increase.';
      const createResult2 = await createMemory({ 
        content: effectContent, 
        metadata: { type: 'result' },
        linked_memory_id: testMemoryId1!,
        link_type: 'EFFECT'
      });
      const createData2 = JSON.parse(createResult2.content[0].text);
      testMemoryId2 = createData2.memory_id;

      const searchResult = await searchMemories({ 
        query: 'experiment performance increase results',
        include_links: true 
      });
      const searchData = JSON.parse(searchResult.content[0].text);

      expect(searchData.length).toBeGreaterThan(0);
      const resultMemory = searchData.find((m: any) => m.id === testMemoryId2);
      expect(resultMemory).toBeDefined();
      expect(resultMemory.linked_memory).toBeDefined();
      expect(resultMemory.linked_memory.id).toBe(testMemoryId1);
    }, 10000);
  });
});
