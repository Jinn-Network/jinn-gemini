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
  });
  
  describe('list_tools Tool', () => {
    it('should list all available tools', async () => {
      const result = await listTools({}, serverTools);
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.tools).toHaveLength(14);
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
