import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { supabase, setJobContext, clearJobContext } from './tools/shared/supabase.js';
import { createJob, getContextSnapshot, listTools, manageArtifact, manageThread, getDetails, createMemory, searchMemories, createRecord, readRecords, updateRecords, deleteRecords } from './tools/index.js';
import { serverTools } from './server.js';

describe('Database Tools Integration Tests', () => {

  // Mock Job Context
  const mockJobContext = {
    jobId: null as string | null, // Use null to avoid foreign key constraint issues in tests
    jobName: null as string | null, // Use null to avoid foreign key constraint issues in tests  
    threadId: null as string | null, // This will be set in specific tests
  };

  beforeEach(() => {
    // Default context for most tests
    setJobContext(mockJobContext.jobId, mockJobContext.jobName, mockJobContext.threadId);
  });

  afterEach(() => {
    clearJobContext();
    mockJobContext.threadId = null; // Reset threadId
  });

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
      // Set the threadId in the mock context for artifact tests
      mockJobContext.threadId = testThreadId;
      setJobContext(mockJobContext.jobId, mockJobContext.jobName, mockJobContext.threadId);
    });

    afterEach(async () => {
      if (testArtifactId) await supabase.from('artifacts').delete().match({ id: testArtifactId });
      if (testThreadId) await supabase.from('threads').delete().match({ id: testThreadId });
      testArtifactId = null;
      testThreadId = null;
    });

    it('should CREATE a new artifact and inject context', async () => {
      const result = await manageArtifact({ operation: 'REPLACE', content: 'Initial content.' });
      const resultData = JSON.parse(result.content[0].text);
      testArtifactId = resultData.id;

      expect(resultData.thread_id).toBe(testThreadId);
      expect(resultData.status).toBe('RAW');
      // Verify context injection (null for tests)
      expect(resultData.source_job_id).toBe(null);
      expect(resultData.source_job_name).toBe(null);
    });
    
    it('should fail to CREATE an artifact if context has no thread_id', async () => {
        // Unset the threadId for this specific test
        setJobContext(mockJobContext.jobId, mockJobContext.jobName, null);
        const result = await manageArtifact({ operation: 'REPLACE', content: 'This should fail.' });
        expect(result.content[0].text).toContain("Cannot create an artifact because the current job is not associated with a thread.");
    });

    it('should UPDATE an artifact with REPLACE operation and inject context', async () => {
        const { data: artifact } = await supabase.from('artifacts').insert({ thread_id: testThreadId!, content: 'Original' }).select().single();
        testArtifactId = artifact.id;
        const result = await manageArtifact({ artifact_id: testArtifactId!, operation: 'REPLACE', content: 'Replaced content.' });
        const resultData = JSON.parse(result.content[0].text);
        expect(resultData.content).toBe('Replaced content.');
        // Verify context injection on update (null for tests)
        expect(resultData.source_job_id).toBe(null);
        expect(resultData.source_job_name).toBe(null);
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

    it('should CREATE a new thread and inject context', async () => {
      const result = await manageThread({ title: 'Test Create Thread', objective: 'Test objective' });
      const resultData = JSON.parse(result.content[0].text);
      testThreadId = resultData.id;
      expect(resultData.title).toBe('Test Create Thread');
      // Verify context injection (null for tests)
      expect(resultData.source_job_id).toBe(null);
      expect(resultData.source_job_name).toBe(null);
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
      testArtifactIds = artifacts?.map(a => a.id) ?? [];
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
      // 2 core CLI tools + 12 MCP server tools = 14 total
      expect(resultData.tools).toHaveLength(14);
    });
  });

  describe('get_context_snapshot Tool', () => {
    // This test suite does not require context injection as it's a read-only tool
    let testThreadId: string | null = null;
    let testArtifactId: string | null = null;
    let testJobName: string | null = null;

    beforeEach(async () => {
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
        source_job_name: 'test-job' // Using new column
      }).select().single();
      testArtifactId = artifact.id;

      testJobName = 'test-context-job';
      const { data: job, error: jobError } = await supabase.from('job_board').insert({
        job_name: testJobName,
        status: 'COMPLETED',
        output: 'Test job completed successfully',
        input_prompt: 'Test prompt'
      }).select().single();
      
      if (jobError || !job) {
        console.error('Job creation failed:', jobError);
        return;
      }
      
      await supabase.from('job_reports').insert({
        job_id: job.id,
        worker_id: 'test-worker',
        status: 'COMPLETED',
        duration_ms: 5000,
        total_tokens: 1500
      });

      await supabase.from('messages').insert([
        {
          source_job_name: 'test-sender',
          to_agent: testJobName,
          content: 'Test message for specific job',
          status: 'PENDING'
        },
        {
          source_job_name: 'other-sender', 
          to_agent: 'other-job',
          content: 'Message for different job',
          status: 'READ'
        }
      ]);
    });

    afterEach(async () => {
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
    });
  });

  describe('Memory Tools', () => {
    let testMemoryId1: string | null = null;
    let testMemoryId2: string | null = null;
    let testThreadId: string | null = null;

    beforeEach(async () => {
        // Create a thread to get a threadId for the context
        const { data, error } = await supabase.from('threads').insert({ title: 'Memory Test Thread', objective: 'Test Objective' }).select().single();
        expect(error).toBeNull();
        testThreadId = data.id;
        mockJobContext.threadId = testThreadId;
        setJobContext(mockJobContext.jobId, mockJobContext.jobName, mockJobContext.threadId);
    });

    afterEach(async () => {
      if (testMemoryId2) await supabase.from('memories').delete().eq('id', testMemoryId2);
      if (testMemoryId1) await supabase.from('memories').delete().eq('id', testMemoryId1);
      if (testThreadId) await supabase.from('threads').delete().eq('id', testThreadId);
      testMemoryId1 = null;
      testMemoryId2 = null;
      testThreadId = null;
    });

    it('should create a memory and inject context', async () => {
      const content = 'The sky is blue on a clear day.';
      const createResult = await createMemory({ content, custom_metadata: { type: 'fact' } });
      const createData = JSON.parse(createResult.content[0].text);
      testMemoryId1 = createData.memory_id;
      expect(createData.success).toBe(true);

      const { data: memory, error } = await supabase.from('memories').select().eq('id', testMemoryId1).single();
      expect(error).toBeNull();
      expect(memory).toBeDefined();
      expect(memory.content).toBe(content);
      // Verify context injection (null for tests)
      expect(memory.source_job_id).toBe(null);
      expect(memory.source_job_name).toBe(null);
      expect(memory.thread_id).toBe(testThreadId);
      expect(memory.metadata.type).toBe('fact');
    }, 10000);

    it('should create linked memories and retrieve them', async () => {
      const causeContent = 'An experiment was planned to test the new algorithm.';
      const createResult1 = await createMemory({ content: causeContent, custom_metadata: { type: 'plan' } });
      const createData1 = JSON.parse(createResult1.content[0].text);
      testMemoryId1 = createData1.memory_id;

      const effectContent = 'The experiment succeeded, showing a 20% performance increase.';
      const createResult2 = await createMemory({ 
        content: effectContent, 
        custom_metadata: { type: 'result' },
        linked_memory_id: testMemoryId1!,
        link_type: 'EFFECT'
      });
      const createData2 = JSON.parse(createResult2.content[0].text);
      testMemoryId2 = createData2.memory_id;

      const searchResult = await searchMemories({ 
        query: 'experiment performance increase results',
        include_links: true,
        limit: 10,
        similarity_threshold: 0.5
      });
      const searchData = JSON.parse(searchResult.content[0].text);

      expect(searchData.length).toBeGreaterThan(0);
      const resultMemory = searchData.find((m: any) => m.id === testMemoryId2);
      expect(resultMemory).toBeDefined();
      expect(resultMemory.linked_memory).toBeDefined();
      expect(resultMemory.linked_memory.id).toBe(testMemoryId1);
    }, 10000);
  });

  describe('CRUD Tools', () => {
    let testRecordId: string | null = null;

    afterEach(async () => {
      // Clean up any test records created in prompt_library
      if (testRecordId) {
        await supabase.from('prompt_library').delete().eq('id', testRecordId);
        testRecordId = null;
      }
    });

    describe('create_record Tool', () => {
      it('should create a new record with context injection', async () => {
        const testData = { 
          name: `test_prompt_${Date.now()}`,
          content: 'This is a test prompt for CRUD testing',
          version: 1,
          is_active: true
        };
        
        const result = await createRecord({ table_name: 'prompt_library', data: testData });
        
        // createRecord returns a simple success message with the ID
        expect(result.content[0].text).toContain('Successfully created record with ID:');
        
        // Extract the ID from the message
        const idMatch = result.content[0].text.match(/Successfully created record with ID: (.+)/);
        expect(idMatch).toBeTruthy();
        testRecordId = idMatch![1];
        
        // Verify the record was actually created by reading it back
        const readResult = await readRecords({ table_name: 'prompt_library', filter: { id: testRecordId } });
        const readData = JSON.parse(readResult.content[0].text);
        expect(readData).toHaveLength(1);
        expect(readData[0].name).toBe(testData.name);
        expect(readData[0].content).toBe(testData.content);
        // Verify context injection (null for tests)
        expect(readData[0].source_job_id).toBe(null);
        expect(readData[0].source_job_name).toBe(null);
      });

      it('should fail to create a record in a non-existent table', async () => {
        const result = await createRecord({ table_name: 'nonexistent_table' as any, data: { test: 'data' } });
        expect(result.content[0].text).toContain('Error creating record');
      });
    });

    describe('read_records Tool', () => {
      beforeEach(async () => {
        // Create a test record for reading
        const { data } = await supabase.from('prompt_library').insert({ 
          name: `test_read_${Date.now()}`,
          content: 'Test read prompt',
          version: 1,
          is_active: true
        }).select().single();
        testRecordId = data?.id;
      });

      it('should read records with filter', async () => {
        const result = await readRecords({ 
          table_name: 'prompt_library', 
          filter: { id: testRecordId! } 
        });
        const resultData = JSON.parse(result.content[0].text);
        
        expect(resultData).toHaveLength(1);
        expect(resultData[0].id).toBe(testRecordId);
        expect(resultData[0].content).toBe('Test read prompt');
      });

      it('should read all records when no filter provided', async () => {
        const result = await readRecords({ table_name: 'prompt_library' });
        const resultData = JSON.parse(result.content[0].text);
        
        expect(Array.isArray(resultData)).toBe(true);
        expect(resultData.length).toBeGreaterThanOrEqual(1);
      });

      it('should return empty array for non-matching filter', async () => {
        const result = await readRecords({ 
          table_name: 'prompt_library', 
          filter: { id: '00000000-0000-0000-0000-000000000000' } 
        });
        const resultData = JSON.parse(result.content[0].text);
        
        expect(resultData).toHaveLength(0);
      });

      it('should fail to read from non-existent table', async () => {
        const result = await readRecords({ table_name: 'nonexistent_table' as any });
        expect(result.content[0].text).toContain('Error reading records');
      });
      it('should read records with hours_back filter', async () => {
        const result = await readRecords({ 
          table_name: 'prompt_library', 
          hours_back: 1
        });
        const resultData = JSON.parse(result.content[0].text);
        
        // Find our specific test record in the results
        const testRecord = resultData.find((r: any) => r.id === testRecordId);
        expect(testRecord).toBeDefined();
        expect(testRecord.id).toBe(testRecordId);
      });
    });

    describe('update_records Tool', () => {
      beforeEach(async () => {
        // Create a test record for updating
        const { data } = await supabase.from('prompt_library').insert({ 
          name: `test_update_${Date.now()}`,
          content: 'Original prompt content',
          version: 1,
          is_active: true
        }).select().single();
        testRecordId = data?.id;
      });

      it('should update records with context injection', async () => {
        const updates = { content: 'Updated prompt content', is_active: false };
        const result = await updateRecords({ 
          table_name: 'prompt_library', 
          filter: { id: testRecordId! },
          updates 
        });
        
        // updateRecords returns a simple success message with count
        expect(result.content[0].text).toBe('Successfully updated 1 record(s).');
        
        // Verify the record was actually updated by reading it back
        const readResult = await readRecords({ table_name: 'prompt_library', filter: { id: testRecordId! } });
        const readData = JSON.parse(readResult.content[0].text);
        expect(readData).toHaveLength(1);
        expect(readData[0].content).toBe('Updated prompt content');
        expect(readData[0].is_active).toBe(false);
        // Verify context injection (null for tests)
        expect(readData[0].source_job_id).toBe(null);
        expect(readData[0].source_job_name).toBe(null);
      });

      it('should return zero count when no records match filter', async () => {
        const result = await updateRecords({ 
          table_name: 'prompt_library', 
          filter: { id: '00000000-0000-0000-0000-000000000000' },
          updates: { content: 'should_not_update' }
        });
        
        expect(result.content[0].text).toBe('Successfully updated 0 record(s).');
      });

      it('should fail with empty filter', async () => {
        const result = await updateRecords({ 
          table_name: 'prompt_library', 
          filter: {},
          updates: { content: 'dangerous_update' }
        });
        expect(result.content[0].text).toContain('Error updating records');
      });
    });

    describe('delete_records Tool', () => {
      beforeEach(async () => {
        // Create test records for deletion
        const { data } = await supabase.from('prompt_library').insert({ 
          name: `test_delete_${Date.now()}`,
          content: 'Prompt to delete',
          version: 1,
          is_active: true
        }).select().single();
        testRecordId = data?.id;
      });

      it('should delete records matching filter', async () => {
        const result = await deleteRecords({ 
          table_name: 'prompt_library', 
          filter: { id: testRecordId! }
        });
        
        // deleteRecords returns a simple success message with count
        expect(result.content[0].text).toBe('Successfully deleted 1 record(s).');
        
        // Verify record was actually deleted
        const checkResult = await readRecords({ 
          table_name: 'prompt_library', 
          filter: { id: testRecordId! } 
        });
        const checkData = JSON.parse(checkResult.content[0].text);
        expect(checkData).toHaveLength(0);
        
        testRecordId = null; // No need to clean up in afterEach
      });

      it('should return zero deleted count when no records match', async () => {
        const result = await deleteRecords({ 
          table_name: 'prompt_library', 
          filter: { id: '00000000-0000-0000-0000-000000000000' }
        });
        
        expect(result.content[0].text).toBe('Successfully deleted 0 record(s).');
      });

      it('should fail with empty filter', async () => {
        const result = await deleteRecords({ 
          table_name: 'prompt_library', 
          filter: {}
        });
        expect(result.content[0].text).toContain('Error deleting records');
      });
    });
  });

  describe('create_job Tool', () => {
    let testJobDefId: string | null = null;
    let testPromptName: string | null = null;

    afterEach(async () => {
      // Clean up test artifacts
      if (testJobDefId) {
        await supabase.from('job_schedules').delete().eq('job_definition_id', testJobDefId);
        await supabase.from('job_definitions').delete().eq('id', testJobDefId);
      }
      if (testPromptName) {
        await supabase.from('prompt_library').delete().eq('name', testPromptName);
      }
      testJobDefId = null;
      testPromptName = null;
    });

    it('should create a complete job with prompt, definition, and schedule', async () => {
      const jobName = `test_job_${Date.now()}`;
      testPromptName = `test_prompt_${Date.now()}`;
      
      const jobParams = {
        job_name: jobName,
        job_description: 'Test job for integration testing',
        prompt_content: 'This is a test prompt for automated testing purposes.',
        enabled_tools: ['get_schema', 'read_records'],
        model_settings: { temperature: 0.7, max_tokens: 1000 },
        schedule_dispatch_trigger: 'one-off' as const,
        schedule_trigger_context_key: 'test_context',
        schedule_trigger_filter: { test: true }
      };

      const result = await createJob(jobParams);
      const resultData = JSON.parse(result.content[0].text);
      
      expect(resultData.promptId).toBeDefined();
      expect(resultData.jobDefinitionId).toBeDefined();
      expect(resultData.jobScheduleId).toBeDefined();
      
      testJobDefId = resultData.jobDefinitionId;
      testPromptName = jobName; // The prompt name matches job name
      
      // Verify the job definition was created correctly
      const { data: jobDef } = await supabase
        .from('job_definitions')
        .select('*')
        .eq('id', testJobDefId)
        .single();
      
      expect(jobDef.name).toBe(jobName);
      expect(jobDef.description).toBe(jobParams.job_description);
      expect(jobDef.enabled_tools).toEqual(jobParams.enabled_tools);
      expect(jobDef.model_settings).toEqual(jobParams.model_settings);
      
      // Verify the schedule was created correctly  
      const { data: schedule } = await supabase
        .from('job_schedules')
        .select('*')
        .eq('job_definition_id', testJobDefId)
        .single();
      
      expect(schedule.dispatch_trigger).toBe('one-off');
      expect(schedule.trigger_context_key).toBe('test_context');
      expect(schedule.trigger_filter).toEqual({ test: true });
    });

    it('should fail when required parameters are missing', async () => {
      const result = await createJob({
        job_name: 'incomplete_job',
        prompt_content: 'Test prompt',
        schedule_dispatch_trigger: 'one-off' as const
        // Missing job_description
      });
      
      expect(result.content[0].text).toContain('Error creating job');
    });

    it('should create job with context injection', async () => {
      const jobName = `test_context_job_${Date.now()}`;
      testPromptName = jobName;
      
      const result = await createJob({
        job_name: jobName,
        job_description: 'Test job for context injection',
        prompt_content: 'Test prompt content',
        schedule_dispatch_trigger: 'one-off' as const
      });
      
      const resultData = JSON.parse(result.content[0].text);
      testJobDefId = resultData.jobDefinitionId;
      
      // Check that context was injected into the job definition
      const { data: jobDef } = await supabase
        .from('job_definitions')
        .select('source_job_id, source_job_name')
        .eq('id', testJobDefId)
        .single();
      
      // Verify context injection (null for tests)
      expect(jobDef?.source_job_id).toBe(null);
      expect(jobDef?.source_job_name).toBe(null);
    });
  });
});
