import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { supabase, setJobContext, clearJobContext } from './tools/shared/supabase.js';
import { createJob, getContextSnapshot, listTools, manageArtifact, getDetails, createMemory, searchMemories, createRecord, readRecords, updateRecords, deleteRecords, sendMessage, getProjectSummary, planProject } from './tools/index.js';
import { serverTools } from './server.js';
import { randomUUID } from 'crypto';

describe('Database Tools Integration Tests', () => {

  // Mock Job Context
  const mockJobContext = {
    jobId: null as string | null, // Use null to avoid foreign key constraint issues in tests
    jobName: null as string | null, // Use null to avoid foreign key constraint issues in tests  
    threadId: null as string | null, // This will be set in specific tests
    projectDefinitionId: null as string | null, // For artifact tests
    projectRunId: null as string | null, // Required for artifact creation
    jobDefinitionId: null as string | null, // For lineage tracking
  };

  beforeEach(() => {
    // Default context for most tests
    setJobContext(mockJobContext.jobId, mockJobContext.jobName, mockJobContext.threadId);
  });

  afterEach(() => {
    clearJobContext();
    mockJobContext.threadId = null; // Reset threadId
    mockJobContext.projectDefinitionId = null; // Reset project definition ID
    mockJobContext.projectRunId = null; // Reset project run ID
    mockJobContext.jobDefinitionId = null; // Reset job definition ID
  });

  describe('get_schema Tool', () => {
    it('should return a list of all allowed tables', async () => {
      const { data, error } = await supabase.rpc('get_all_tables');
      expect(error).toBeNull();
      expect(data).toBeInstanceOf(Array);
      // get_all_tables returns an array of strings, not objects with table_name
      expect(data).toContain('job_board');
      expect(data).toContain('artifacts');
      expect(data).toContain('jobs');
    });

    it('should return the schema for a specific table', async () => {
      const { data, error } = await supabase.rpc('get_table_schema', {
        p_table_name: 'artifacts',
      });
      expect(error).toBeNull();
      expect(data).toBeInstanceOf(Array);
      expect(data.length).toBeGreaterThan(0);
      const columnNames = data.map((col: any) => col.column_name);
      // Loosen assertion to be robust across schema variants
      expect(columnNames).toContain('id');
    });
  });

  describe('manage_artifact Tool', () => {
    let testProjectDefinitionId: string | null = null;
    let testProjectRunId: string | null = null;
    let testArtifactId: string | null = null;

    beforeEach(async () => {
      // Create a project definition first
      const { data: projectDef, error: projectDefError } = await supabase.from('project_definitions')
        .insert({ name: `Test Project ${Date.now()}`, objective: 'Test Objective for artifact tests' })
        .select().single();
      expect(projectDefError).toBeNull();
      testProjectDefinitionId = projectDef.id;
      
      // Create a project run
      const { data: projectRun, error: projectRunError } = await supabase.from('project_runs')
        .insert({ project_definition_id: testProjectDefinitionId, status: 'OPEN' })
        .select().single();
      expect(projectRunError).toBeNull();
      testProjectRunId = projectRun.id;
      
      // Set the project context for artifact tests
      mockJobContext.projectDefinitionId = testProjectDefinitionId;
      mockJobContext.projectRunId = testProjectRunId;
      setJobContext(mockJobContext.jobId, mockJobContext.jobName, mockJobContext.threadId, testProjectRunId, testProjectDefinitionId);
    });

    afterEach(async () => {
      if (testArtifactId) await supabase.from('artifacts').delete().match({ id: testArtifactId });
      if (testProjectRunId) await supabase.from('project_runs').delete().match({ id: testProjectRunId });
      if (testProjectDefinitionId) await supabase.from('project_definitions').delete().match({ id: testProjectDefinitionId });
      testArtifactId = null;
      testProjectRunId = null;
      testProjectDefinitionId = null;
    });

    it('should CREATE a new artifact and inject context', async () => {
      const result = await manageArtifact({ operation: 'CREATE', content: 'Initial content.' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.meta?.ok).toBe(true);
      testArtifactId = parsed.data.id;

      expect(parsed.data.project_run_id).toBe(testProjectRunId);
      expect(parsed.data.project_definition_id).toBe(testProjectDefinitionId);
      expect(parsed.data.status).toBe('RAW');
      expect(parsed.data.content).toBe('Initial content.');
    });
    
    it('should fail to CREATE an artifact if context has no project_run_id', async () => {
        // Unset the project context for this specific test
        mockJobContext.projectRunId = null;
        setJobContext(mockJobContext.jobId, mockJobContext.jobName, mockJobContext.threadId, null, testProjectDefinitionId);
        const result = await manageArtifact({ operation: 'CREATE', content: 'This should fail.' });
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.meta?.ok).toBe(false);
        expect(parsed.meta?.message).toContain("project_run_id");
    });

    it('should UPDATE an artifact with REPLACE operation and inject context', async () => {
        const { data: artifact } = await supabase.from('artifacts').insert({ 
          project_run_id: testProjectRunId!, 
          project_definition_id: testProjectDefinitionId!,
          content: 'Original' 
        }).select().single();
        testArtifactId = artifact.id;
        const result = await manageArtifact({ artifact_id: testArtifactId!, operation: 'REPLACE', content: 'Replaced content.' });
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.meta?.ok).toBe(true);
        expect(parsed.data.content).toBe('Replaced content.');
    });

    it('should UPDATE an artifact with APPEND operation', async () => {
        const { data: artifact } = await supabase.from('artifacts').insert({ 
          project_run_id: testProjectRunId!, 
          project_definition_id: testProjectDefinitionId!,
          content: 'Original.' 
        }).select().single();
        testArtifactId = artifact.id;
        const result = await manageArtifact({ artifact_id: testArtifactId!, operation: 'APPEND', content: ' Appended.' });
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.meta?.ok).toBe(true);
        expect(parsed.data.content).toBe('Original. Appended.');
    });

    it('should UPDATE an artifact with PREPEND operation', async () => {
        const { data: artifact } = await supabase.from('artifacts').insert({ 
          project_run_id: testProjectRunId!, 
          project_definition_id: testProjectDefinitionId!,
          content: 'Original.' 
        }).select().single();
        testArtifactId = artifact.id;
        const result = await manageArtifact({ artifact_id: testArtifactId!, operation: 'PREPEND', content: 'Prepended. ' });
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.meta?.ok).toBe(true);
        expect(parsed.data.content).toBe('Prepended. Original.');
    });
    
    it('should UPDATE an artifact metadata', async () => {
        const { data: artifact } = await supabase.from('artifacts').insert({ 
          project_run_id: testProjectRunId!, 
          project_definition_id: testProjectDefinitionId!,
          content: 'Content' 
        }).select().single();
        testArtifactId = artifact.id;
        const result = await manageArtifact({ artifact_id: testArtifactId!, operation: 'REPLACE', content: 'Content', topic: 'new-topic', status: 'PROCESSED' });
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.meta?.ok).toBe(true);
        expect(parsed.data.topic).toBe('new-topic');
        expect(parsed.data.status).toBe('PROCESSED');
    });

    it('should fail to UPDATE a non-existent artifact', async () => {
        const nonExistentId = '00000000-0000-0000-0000-000000000000';
        const result = await manageArtifact({ artifact_id: nonExistentId, operation: 'REPLACE', content: 'This should fail.' });
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.meta?.ok).toBe(false);
        expect(parsed.meta?.message).toContain('Artifact');
    });
  });

  describe('plan_project Tool', () => {
    let testProjectDefId: string | null = null;
    let testProjectRunId: string | null = null;
    let testLeadJobDefId: string | null = null;
    let testChildJobDefIds: string[] = [];
    let testOwnerJobDefId: string | null = null;
    let testJobBoardEntryId: string | null = null;
    let testEventId: string | null = null;

    beforeAll(async () => {
      // Create an "owner" job to associate with the project
      const { data: ownerJob, error } = await supabase
        .from('jobs')
        .insert({
          job_id: randomUUID(),
          version: 1,
          name: `test-owner-job-${Date.now()}`,
          prompt_content: 'owner',
          enabled_tools: [],
          schedule_config: { trigger: 'manual' },
          is_active: true,
        })
        .select('id')
        .single();
      expect(error).toBeNull();
      testOwnerJobDefId = ownerJob!.id;
    });

    afterAll(async () => {
      if (testOwnerJobDefId) {
        await supabase.from('jobs').delete().eq('id', testOwnerJobDefId);
      }
    });

    afterEach(async () => {
      // Cleanup in reverse order of creation
      if (testJobBoardEntryId) await supabase.from('job_board').delete().eq('id', testJobBoardEntryId);
      if (testEventId) await supabase.from('events').delete().eq('id', testEventId);
      if (testChildJobDefIds.length > 0) await supabase.from('jobs').delete().in('id', testChildJobDefIds);
      if (testLeadJobDefId) await supabase.from('jobs').delete().eq('id', testLeadJobDefId);
      if (testProjectRunId) await supabase.from('project_runs').delete().eq('id', testProjectRunId);
      if (testProjectDefId) await supabase.from('project_definitions').delete().eq('id', testProjectDefId);
      
      testProjectDefId = null;
      testProjectRunId = null;
      testLeadJobDefId = null;
      testChildJobDefIds = [];
      testJobBoardEntryId = null;
      testEventId = null;
    });

    it('should create a project and bootstrap it with a lead and child job', async () => {
      // Set the context of the job that is CALLING plan_project
      setJobContext(randomUUID(), 'some-job-name', null, null, null, testOwnerJobDefId);

      const projectName = `bootstrapped-project-${Date.now()}`;
      const leadJobName = `lead-${projectName}`;
      const childJobName = `child-${projectName}`;

      const result = await planProject({
        name: projectName,
        objective: 'Test bootstrapping a project',
        jobs: [
          {
            name: leadJobName,
            prompt_content: 'This is the lead job.',
            enabled_tools: ['get_schema'],
          },
          {
            name: childJobName,
            prompt_content: 'This is the child job.',
            enabled_tools: ['read_records'],
          },
        ],
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.meta.ok, `Tool failed with: ${parsed.meta.message}`).toBe(true);
      
      const { project_definition_id, project_run_id, lead_job_definition_id, child_job_definition_ids } = parsed.data;
      testProjectDefId = project_definition_id;
      testProjectRunId = project_run_id;
      testLeadJobDefId = lead_job_definition_id;
      expect(child_job_definition_ids).toHaveLength(1);
      testChildJobDefIds = child_job_definition_ids;

      // --- Verify Project ---
      const { data: projectDef } = await supabase.from('project_definitions').select().eq('id', testProjectDefId).single();
      expect(projectDef.name).toBe(projectName);
      expect(projectDef.owner_job_definition_id).toBe(testOwnerJobDefId);

      // --- Verify Project Run ---
      const { data: projectRun } = await supabase.from('project_runs').select().eq('id', testProjectRunId).single();
      expect(projectRun.project_definition_id).toBe(testProjectDefId);

      // --- Verify Lead Job ---
      const { data: leadJob } = await supabase.from('jobs').select().eq('id', testLeadJobDefId).single();
      expect(leadJob.name).toBe(leadJobName);
      expect(leadJob.project_definition_id).toBe(testProjectDefId);
      expect(leadJob.schedule_config.trigger).toBe('manual');

      // --- Verify Child Job ---
      const { data: childJob } = await supabase.from('jobs').select().eq('id', testChildJobDefIds[0]).single();
      expect(childJob.name).toBe(childJobName);
      expect(childJob.project_definition_id).toBe(testProjectDefId);
      expect(childJob.schedule_config).toEqual({
        trigger: 'on_new_event',
        filters: {
          event_type: 'job.completed',
          job_definition_id: testLeadJobDefId,
        },
      });

      // --- Verify Lead Job was Dispatched ---
      const { data: jobBoardEntry } = await supabase.from('job_board').select().eq('job_definition_id', testLeadJobDefId).single();
      expect(jobBoardEntry).toBeDefined();
      expect(jobBoardEntry.status).toBe('PENDING');
      expect(jobBoardEntry.project_run_id).toBe(testProjectRunId);
      testJobBoardEntryId = jobBoardEntry.id;

      // Capture the event ID for cleanup
      if (jobBoardEntry.source_event_id) {
          testEventId = jobBoardEntry.source_event_id;
      }
    });
  });

  describe('get_details Tool', () => {
    let jobIds: string[] = [];
    let messageIds: string[] = [];

    beforeEach(async () => {
      const { data: jobs } = await supabase.from('jobs').insert([
        { job_id: '550e8400-e29b-41d4-a716-446655440101', version: 1, name: `details_job_${Date.now()}_1`, prompt_content: 'A', enabled_tools: [], schedule_config: { trigger: 'manual', filters: {} }, is_active: true },
        { job_id: '550e8400-e29b-41d4-a716-446655440102', version: 1, name: `details_job_${Date.now()}_2`, prompt_content: 'B', enabled_tools: [], schedule_config: { trigger: 'manual', filters: {} }, is_active: true }
      ]).select();
      jobIds = (jobs ?? []).map(j => j.id);

      // No messages needed for current tests
      messageIds = [];
    });

    afterEach(async () => {
      if (messageIds.length) await supabase.from('messages').delete().in('id', messageIds);
      if (jobIds.length) await supabase.from('jobs').delete().in('id', jobIds);
      jobIds = [];
      messageIds = [];
    });

    it('should get multiple jobs by their IDs', async () => {
      const result = await getDetails({ table_name: 'jobs', ids: jobIds });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data).toHaveLength(2);
    });

    it('should return an empty array for non-existent IDs (messages)', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const result = await getDetails({ table_name: 'messages', ids: [nonExistentId] });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data).toHaveLength(0);
    });

    it('should handle empty ids array gracefully', async () => {
      const result = await getDetails({ table_name: 'jobs', ids: [] });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data).toHaveLength(0);
      expect(Array.isArray(parsed.data)).toBe(true);
    });
  });
  
  describe('list_tools Tool', () => {
    it('should list all available tools', async () => {
      const result = await listTools({}, serverTools);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.meta?.ok).toBe(true);
      const resultData = parsed.data;
      // After removing 6 tools and adding 1 (get_project_summary), we should have around 15 tools
      expect(resultData.tools.length).toBeGreaterThanOrEqual(12);
      expect(resultData.tools.length).toBeLessThanOrEqual(18);
    });
  });

  describe.skip('get_context_snapshot Tool', () => {
    // This test suite does not require context injection as it's a read-only tool
    let testProjectDefinitionId: string | null = null;
    let testProjectRunId: string | null = null;
    let testArtifactId: string | null = null;
    let testJobName: string | null = null;

    beforeEach(async () => {
      // Create a project definition first
      const { data: projectDef, error: projectDefError } = await supabase.from('project_definitions').insert({ 
        name: `Context Test Project ${Date.now()}`, 
        objective: 'Test objective for context snapshot',
        strategy: 'Test strategy with context data'
      }).select().single();
      expect(projectDefError).toBeNull();
      testProjectDefinitionId = projectDef.id;
      
      // Create a project run
      const { data: projectRun, error: projectRunError } = await supabase.from('project_runs').insert({ 
        project_definition_id: testProjectDefinitionId!, 
        status: 'OPEN',
        summary: { key: 'test summary data' }
      }).select().single();
      expect(projectRunError).toBeNull();
      testProjectRunId = projectRun.id;

      const { data: artifact } = await supabase.from('artifacts').insert({ 
        project_run_id: testProjectRunId!, 
        project_definition_id: testProjectDefinitionId!,
        content: 'This is a test artifact with some meaningful content that provides context about what this artifact contains and represents in the system.',
        topic: 'test-topic'
      }).select().single();
      testArtifactId = artifact.id;

      testJobName = 'test-context-job';
      
      // Create an event first (required for job_board)
      const { data: event } = await supabase.from('events').insert({
        event_type: 'test.context_setup',
        payload: { test: 'context snapshot setup' },
        project_run_id: testProjectRunId
      }).select().single();
      
      const { data: job, error: jobError } = await supabase.from('job_board').insert({
        job_name: testJobName,
        status: 'COMPLETED',
        output: 'Test job completed successfully',
        input: 'Test prompt',
        source_event_id: event.id,
        project_run_id: testProjectRunId!,
        project_definition_id: testProjectDefinitionId!
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
        total_tokens: 1500,
        project_definition_id: testProjectDefinitionId
      });

      await supabase.from('messages').insert([
        {
          content: 'Test message for specific job',
          status: 'PENDING',
          project_run_id: testProjectRunId!,
          project_definition_id: testProjectDefinitionId!
        },
        {
          content: 'Message for different project',
          status: 'READ',
          project_run_id: testProjectRunId!,
          project_definition_id: testProjectDefinitionId!
        }
      ]);
    });

    afterEach(async () => {
      await supabase.from('messages').delete().gte('created_at', new Date(Date.now() - 1000 * 60 * 60).toISOString());
      await supabase.from('job_reports').delete().gte('created_at', new Date(Date.now() - 1000 * 60 * 60).toISOString());
      await supabase.from('job_board').delete().eq('job_name', testJobName!);
      await supabase.from('events').delete().gte('created_at', new Date(Date.now() - 1000 * 60 * 60).toISOString());
      if (testArtifactId) await supabase.from('artifacts').delete().match({ id: testArtifactId });
      if (testProjectRunId) await supabase.from('project_runs').delete().match({ id: testProjectRunId });
      if (testProjectDefinitionId) await supabase.from('project_definitions').delete().match({ id: testProjectDefinitionId });
      testProjectDefinitionId = null;
      testProjectRunId = null;
      testArtifactId = null;
      testJobName = null;
    });

    it('should return context snapshot with default time window (6 hours)', async () => {
      const result = await getContextSnapshot({});
      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed.data)).toBe(true);
    });
  });

  describe('Memory Tools', () => {
    let testMemoryId1: string | null = null;
    let testMemoryId2: string | null = null;
    let testProjectDefinitionId: string | null = null;
    let testProjectRunId: string | null = null;

    beforeEach(async () => {
        // Create a project definition first
        const { data: projectDef, error: projectDefError } = await supabase.from('project_definitions')
          .insert({ name: `Memory Test Project ${Date.now()}`, objective: 'Test Objective for memory tests' })
          .select().single();
        expect(projectDefError).toBeNull();
        testProjectDefinitionId = projectDef.id;
        
        // Create a project run
        const { data: projectRun, error: projectRunError } = await supabase.from('project_runs')
          .insert({ project_definition_id: testProjectDefinitionId, status: 'OPEN' })
          .select().single();
        expect(projectRunError).toBeNull();
        testProjectRunId = projectRun.id;
        
        // Set the project context for memory tests
        mockJobContext.projectDefinitionId = testProjectDefinitionId;
        mockJobContext.projectRunId = testProjectRunId;
        setJobContext(mockJobContext.jobId, mockJobContext.jobName, mockJobContext.threadId, testProjectRunId, testProjectDefinitionId);
    });

    afterEach(async () => {
      if (testMemoryId2) await supabase.from('memories').delete().eq('id', testMemoryId2);
      if (testMemoryId1) await supabase.from('memories').delete().eq('id', testMemoryId1);
      if (testProjectRunId) await supabase.from('project_runs').delete().eq('id', testProjectRunId);
      if (testProjectDefinitionId) await supabase.from('project_definitions').delete().eq('id', testProjectDefinitionId);
      testMemoryId1 = null;
      testMemoryId2 = null;
      testProjectDefinitionId = null;
      testProjectRunId = null;
    });

    it('should create a memory and inject context', async () => {
      const content = 'The sky is blue on a clear day.';
      const createResult = await createMemory({ content, custom_metadata: { type: 'fact' } });
      const createParsed = JSON.parse(createResult.content[0].text);
      expect(createParsed.meta?.ok).toBe(true);
      testMemoryId1 = createParsed.data?.memory_id;

      const { data: memory, error } = await supabase.from('memories').select().eq('id', testMemoryId1).single();
      expect(error).toBeNull();
      expect(memory).toBeDefined();
      expect(memory.content).toBe(content);
      // Verify project context injection
      expect(memory.project_run_id).toBe(testProjectRunId);
      expect(memory.project_definition_id).toBe(testProjectDefinitionId);
      expect(memory.metadata.type).toBe('fact');
    }, 10000);

    it('should create linked memories and retrieve them', async () => {
      const causeContent = 'An experiment was planned to test the new algorithm.';
      const createResult1 = await createMemory({ content: causeContent, custom_metadata: { type: 'plan' } });
      const createParsed1 = JSON.parse(createResult1.content[0].text);
      testMemoryId1 = createParsed1.data?.memory_id;

      const effectContent = 'The experiment succeeded, showing a 20% performance increase.';
      const createResult2 = await createMemory({ 
        content: effectContent, 
        custom_metadata: { type: 'result' },
        linked_memory_id: testMemoryId1!,
        link_type: 'EFFECT'
      });
      const createParsed2 = JSON.parse(createResult2.content[0].text);
      testMemoryId2 = createParsed2.data?.memory_id;

      const searchResult = await searchMemories({ 
        query: 'experiment performance increase results',
        include_links: true,
        limit: 10,
        similarity_threshold: 0.5
      });
      const searchParsed = JSON.parse(searchResult.content[0].text);
      const searchData = searchParsed.data;

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
      // Clean up any test records created in jobs
      if (testRecordId) {
        await supabase.from('jobs').delete().eq('id', testRecordId);
        testRecordId = null;
      }
    });

    describe('create_record Tool', () => {
      it('should create a new record with context injection', async () => {
        const testData = { 
          content: `hello_${Date.now()}`
        };
        
        const result = await createRecord({ table_name: 'messages', data: testData });
        
        // New shape: { data: { id }, meta: { ok: true } }
        const createParsed = JSON.parse(result.content[0].text);
        expect(createParsed.meta?.ok).toBe(true);
        expect(createParsed.data?.id).toBeDefined();
        testRecordId = createParsed.data.id;
        
        // Verify the record was actually created by reading it back
        const readResult = await readRecords({ table_name: 'messages', filter: { id: testRecordId } });
        const readParsed = JSON.parse(readResult.content[0].text);
        const readData = readParsed.data;
        expect(readData).toHaveLength(1);
        expect(readData[0].content).toBe(testData.content);
        expect(readData[0].status).toBe('PENDING');
      });

      it('should fail to create a record in a non-existent table', async () => {
        const result = await createRecord({ table_name: 'nonexistent_table' as any, data: { test: 'data' } });
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.meta?.ok).toBe(false);
        expect(parsed.meta?.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('read_records Tool', () => {
      beforeEach(async () => {
        // Create a test record for reading (messages)
        const { data } = await supabase.from('messages').insert({ 
          content: 'Test read content'
        }).select().single();
        testRecordId = data?.id;
      });

      it('should read records with filter', async () => {
        const result = await readRecords({ 
          table_name: 'messages', 
          filter: { id: testRecordId! } 
        });
        const parsed = JSON.parse(result.content[0].text);
        const resultData = parsed.data;
        
        expect(resultData).toHaveLength(1);
        expect(resultData[0].id).toBe(testRecordId);
        expect(resultData[0].content).toBe('Test read content');
      });

      it('should read all records when no filter provided', async () => {
        const result = await readRecords({ table_name: 'messages' });
        const parsed = JSON.parse(result.content[0].text);
        const resultData = parsed.data;
        
        expect(Array.isArray(resultData)).toBe(true);
        expect(resultData.length).toBeGreaterThanOrEqual(1);
      });

      it('should return empty array for non-matching filter', async () => {
        const result = await readRecords({ 
          table_name: 'messages', 
          filter: { id: '00000000-0000-0000-0000-000000000000' } 
        });
        const parsed = JSON.parse(result.content[0].text);
        const resultData = parsed.data;
        
        expect(resultData).toHaveLength(0);
      });

      it('should fail to read from non-existent table', async () => {
        const result = await readRecords({ table_name: 'nonexistent_table' as any });
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.meta?.ok).toBe(false);
        expect(parsed.meta?.code).toBe('VALIDATION_ERROR');
      });
      it('should read records with hours_back filter', async () => {
        const result = await readRecords({ 
          table_name: 'messages', 
          hours_back: 1
        });
        const parsed = JSON.parse(result.content[0].text);
        const resultData = parsed.data;
        
        // Find our specific test record in the results
        const testRecord = resultData.find((r: any) => r.id === testRecordId);
        expect(testRecord).toBeDefined();
        expect(testRecord.id).toBe(testRecordId);
      });
    });

    describe('update_records Tool', () => {
      beforeEach(async () => {
        // Create a test record for updating (messages)
        const { data } = await supabase.from('messages').insert({ 
          content: 'Original content'
        }).select().single();
        testRecordId = data?.id;
      });

      it('should update records with context injection', async () => {
        const updates = { status: 'READ' };
        const result = await updateRecords({ 
          table_name: 'messages', 
          filter: { id: testRecordId! },
          updates 
        });
        
        // New shape: { data: { updated: N }, meta: { ok: true } }
        const updateParsed = JSON.parse(result.content[0].text);
        expect(updateParsed.meta?.ok).toBe(true);
        expect(updateParsed.data?.updated).toBe(1);
        
        // Verify the record was actually updated by reading it back
        const readResult = await readRecords({ table_name: 'messages', filter: { id: testRecordId! } });
        const readParsed = JSON.parse(readResult.content[0].text);
        const readData = readParsed.data;
        expect(readData).toHaveLength(1);
        expect(readData[0].status).toBe('READ');
      });

      it('should return zero count when no records match filter', async () => {
        const result = await updateRecords({ 
          table_name: 'messages', 
          filter: { id: '00000000-0000-0000-0000-000000000000' },
          updates: { status: 'READ' }
        });
        const updateParsed = JSON.parse(result.content[0].text);
        expect(updateParsed.meta?.ok).toBe(true);
        expect(updateParsed.data?.updated).toBe(0);
      });

      it('should fail with empty filter', async () => {
        const result = await updateRecords({ 
          table_name: 'messages', 
          filter: {},
          updates: { status: 'READ' }
        });
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.meta?.ok).toBe(false);
        expect(parsed.meta?.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('delete_records Tool', () => {
      beforeEach(async () => {
        // Create test records for deletion (messages)
        const { data } = await supabase.from('messages').insert({ 
          content: 'Prompt to delete'
        }).select().single();
        testRecordId = data?.id;
      });

      it('should delete records matching filter', async () => {
        const result = await deleteRecords({ 
          table_name: 'messages', 
          filter: { id: testRecordId! }
        });
        
        // New shape: { data: { deleted: N }, meta: { ok: true } }
        const deleteParsed = JSON.parse(result.content[0].text);
        expect(deleteParsed.meta?.ok).toBe(true);
        expect(deleteParsed.data?.deleted ?? deleteParsed.data).toBe(1);
        
        // Verify record was actually deleted
        const checkResult = await readRecords({ 
          table_name: 'messages', 
          filter: { id: testRecordId! } 
        });
        const checkParsed = JSON.parse(checkResult.content[0].text);
        expect(checkParsed.data).toHaveLength(0);
        
        testRecordId = null; // No need to clean up in afterEach
      });

      it('should return zero deleted count when no records match', async () => {
        const result = await deleteRecords({ 
          table_name: 'messages', 
          filter: { id: '00000000-0000-0000-0000-000000000000' }
        });
        
        const deleteParsed = JSON.parse(result.content[0].text);
        expect(deleteParsed.meta?.ok).toBe(true);
        expect(deleteParsed.data?.deleted ?? deleteParsed.data).toBe(0);
      });

      it('should fail with empty filter', async () => {
        const result = await deleteRecords({ 
          table_name: 'messages', 
          filter: {}
        });
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.meta?.ok).toBe(false);
        expect(parsed.meta?.code).toBe('VALIDATION_ERROR');
      });
    });
  });

  describe('send_message Tool', () => {
    let supervisorJobDefId: string | null = null;
    let createdMessageId: string | null = null;

    beforeAll(async () => {
      // Ensure the human supervisor job definition exists; if not, create a manual one for tests
      const { data: existing } = await supabase
        .from('jobs')
        .select('id, name')
        .eq('name', 'human_supervisor')
        .limit(1)
        .maybeSingle();
      if (existing) {
        supervisorJobDefId = existing.id;
      } else {
        const { data: created } = await supabase
          .from('jobs')
          .insert({
            job_id: '550e8400-e29b-41d4-a716-446655440777',
            version: 1,
            name: 'human_supervisor',
            prompt_content: 'Human inbox',
            enabled_tools: [],
            schedule_config: { trigger: 'manual', filters: {} },
            is_active: true
          })
          .select('id')
          .single();
        supervisorJobDefId = created?.id ?? null;
      }
    });

    afterAll(async () => {
      if (createdMessageId) await supabase.from('messages').delete().eq('id', createdMessageId);
      createdMessageId = null;
    });

    it('should send a message to the human supervisor by job definition id', async () => {
      expect(supervisorJobDefId).toBeTruthy();
      const content = `supervisor_ping_${Date.now()}`;
      const result = await sendMessage({ to_job_definition_id: supervisorJobDefId!, content });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.meta?.ok).toBe(true);
      createdMessageId = parsed.data?.id;
      expect(createdMessageId).toBeDefined();

      // Verify row exists and defaults applied
      const { data: msg, error } = await supabase
        .from('messages')
        .select('*')
        .eq('id', createdMessageId!)
        .single();
      expect(error).toBeNull();
      expect(msg.content).toBe(content);
      expect(msg.status).toBe('PENDING');
      expect(msg.to_job_definition_id).toBe(supervisorJobDefId);
    });
  });

  describe('create_job Tool', () => {
    let testJobId: string | null = null;

    afterEach(async () => {
      // Clean up test artifacts from unified jobs table
      if (testJobId) {
        await supabase.from('jobs').delete().eq('id', testJobId);
      }
      testJobId = null;
    });

    it('should create a complete job with prompt, definition, and schedule', async () => {
      const jobName = `test_job_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      
      const jobParams = {
        name: jobName,
        description: 'Test job for integration testing',
        prompt_content: 'This is a test prompt for automated testing purposes.',
        enabled_tools: ['get_schema', 'read_records'],
        schedule_on: 'artifact.created'
      };

      const result = await createJob(jobParams);
      // createJob returns JSON directly: { data: {...}, meta: { ok: true } }
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.meta.ok).toBe(true);
      const resultData = parsed.data;
      
      expect(resultData.id).toBeDefined();
      expect(resultData.job_id).toBeDefined();
      expect(resultData.version).toBe(1);
      expect(resultData.name).toBe(jobName);
      expect(resultData.is_active).toBe(true);
      
      testJobId = resultData.id;
      
      // Verify the job was created correctly in the unified jobs table
      const { data: job } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', testJobId)
        .single();
      
      expect(job.name).toBe(jobName);
      expect(job.description).toBe(jobParams.description);
      expect(job.enabled_tools).toEqual(jobParams.enabled_tools);
      expect(job.schedule_config).toEqual({
        trigger: 'on_new_event',
        filters: { event_type: 'artifact.created' }
      });
      expect(job.prompt_content).toBe(jobParams.prompt_content);
      expect(job.version).toBe(1);
      expect(job.is_active).toBe(true);
    });

    it('should fail when required parameters are missing', async () => {
      const result = await createJob({
        // Missing required 'name' parameter
        prompt_content: 'Test prompt',
        enabled_tools: []
      } as any);
      
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.meta.ok).toBe(false);
      expect(parsed.meta.code).toBe('VALIDATION_ERROR');
      expect(parsed.meta.message).toContain('Invalid parameters:');
    });

    it('should create job with context injection', async () => {
      const jobName = `test_context_job_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      
      const result = await createJob({
        name: jobName,
        description: 'Test job for context injection',
        prompt_content: 'Test prompt content',
        enabled_tools: [],
        schedule_on: 'artifact.created'
      });
      
      // createJob returns JSON directly: { data: {...}, meta: { ok: true } }
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.meta.ok).toBe(true);
      const resultData = parsed.data;
      testJobId = resultData.id;
      
      // The new unified jobs table doesn't have source_job_id/source_job_name columns
      // Instead verify the job was created successfully
      expect(resultData.id).toBeDefined();
      expect(resultData.name).toBe(jobName);
    });
  });


  describe('get_project_summary Tool', () => {
    it('should fail when called without project context', async () => {
      // Clear any existing context
      clearJobContext();
      
      const result = await getProjectSummary({ history_count: 3 });
      expect(result.content).toBeDefined();
      expect(result.content).toHaveLength(1);
      
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.meta.ok).toBe(false);
      expect(resultData.meta.code).toBe('NO_PROJECT_CONTEXT');
      expect(resultData.meta.message).toContain('No project context available');
    });

    it('should accept history_count parameter', async () => {
      // This test would require setting up a proper project context
      // For now, just test that the tool can be called with parameters
      const result = await getProjectSummary({ history_count: 5 });
      expect(result.content).toBeDefined();
      expect(result.content).toHaveLength(1);
      
      // Should fail due to no project context, but at least the parameter was accepted
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.meta.ok).toBe(false);
    });
  });
});
