# Trigger Verification Test Plan (Manual Execution)

This document outlines the step-by-step process for manually verifying the event-driven trigger architecture in the Marketplace project database.

---

### **Test 1: Processing Time & Job Chaining (`on_job_board_status_update`)**

*   **Objective**: Verify that job processing time is correctly calculated and that a `COMPLETED` job correctly triggers a new, dependent job.

#### **Phase 1.1: Setup**
1.  **Full Reset**:
    ```sql
    DELETE FROM public.job_board;
    DELETE FROM public.job_schedules;
    DELETE FROM public.job_definitions;
    DELETE FROM public.prompt_library;
    INSERT INTO public.system_state (key, value) 
    VALUES ('cumulative_job_processing_seconds', '{"value": 0}') 
    ON CONFLICT (key) 
    DO UPDATE SET value = '{"value": 0}';
    ```
2.  **Create Dependencies**:
    ```sql
    INSERT INTO public.prompt_library (name, version, content) VALUES ('p', 1, 'This is a test prompt.');
    INSERT INTO public.job_definitions (name, prompt_ref) VALUES ('initial_manual_job', 'p@1'), ('chained_manual_job', 'p@1');
    INSERT INTO public.job_schedules (job_definition_id, dispatch_trigger, trigger_filter, job_name) 
    VALUES (
        (SELECT id FROM public.job_definitions WHERE name = 'chained_manual_job'), 
        'on_job_status_change', 
        '{"table": "job_board", "match_conditions": {"source_job_name": "initial_manual_job", "new_status": "COMPLETED"}}', 
        'chained_manual_job'
    );
    INSERT INTO public.job_board (job_definition_id, input_prompt, job_name) 
    VALUES ((SELECT id FROM public.job_definitions WHERE name = 'initial_manual_job'), 'Initial prompt', 'initial_manual_job');
    ```

#### **Phase 1.2: Execution & Verification**
1.  **Action Step 1 (Start Job)**: Mark the initial job as `IN_PROGRESS`. This sets its start time.
    ```sql
    UPDATE public.job_board SET status = 'IN_PROGRESS' WHERE job_name = 'initial_manual_job';
    ```
2.  **MANUAL STEP**: **Wait physically for at least 5 seconds.**
3.  **Action Step 2 (Complete Job)**: Mark the job as `COMPLETED`.
    ```sql
    UPDATE public.job_board SET status = 'COMPLETED' WHERE job_name = 'initial_manual_job';
    ```
4.  **Verification**:
    *   **Check Processing Time**:
        ```sql
        SELECT value->>'value' as seconds FROM public.system_state WHERE key = 'cumulative_job_processing_seconds';
        ```
        *   **Expected Result**: Returns a value greater than or equal to `5`.
    *   **Check Job Chaining**:
        ```sql
        SELECT count(*) FROM public.job_board WHERE job_name = 'chained_manual_job' AND status = 'PENDING';
        ```
        *   **Expected Result**: Returns a count of `1`.

---

### **Test 2: Idle Loop Detection (`on_job_board_status_update`)**

*   **Objective**: Verify that when the last active job completes, the idle-loop logic creates exactly one `Metacog.GenesysMetacog` job.

#### **Phase 2.1: Setup**
1.  **Full Reset**:
    ```sql
    DELETE FROM public.job_board;
    DELETE FROM public.job_schedules;
    DELETE FROM public.job_definitions;
    ```
2.  **Minimal Setup**:
    ```sql
    INSERT INTO public.job_definitions (name, prompt_ref) VALUES ('Metacog.GenesysMetacog', 'p@1');
    INSERT INTO public.job_board (job_definition_id, input_prompt, job_name, status) 
    VALUES (
        (SELECT id FROM public.job_definitions WHERE name = 'Metacog.GenesysMetacog'), 
        'The only job', 
        'the_very_last_job',
        'IN_PROGRESS'
    );
    ```

#### **Phase 2.2: Execution & Verification**
1.  **Action**: Mark the single job as `COMPLETED`.
    ```sql
    UPDATE public.job_board SET status = 'COMPLETED' WHERE job_name = 'the_very_last_job';
    ```
2.  **Verification**: Check that exactly one idle job was created.
    ```sql
    SELECT count(*) FROM public.job_board WHERE job_name = 'Metacog.GenesysMetacog';
    ```
    *   **Expected Result**: Returns a count of `1`.

---

### **Test 3: `on_new_thread` Dispatch Trigger**

#### **Phase 3.1: Setup**
1.  **Full Reset**:
    ```sql
    DELETE FROM public.job_board;
    DELETE FROM public.job_schedules;
    DELETE FROM public.job_definitions;
    DELETE FROM public.threads;
    ```
2.  **Create Dependencies**:
    ```sql
    INSERT INTO public.job_definitions (name, prompt_ref) VALUES ('new_thread_processor_job', 'p@1');
    INSERT INTO public.job_schedules (job_definition_id, dispatch_trigger, job_name) 
    VALUES (
        (SELECT id FROM public.job_definitions WHERE name = 'new_thread_processor_job'), 
        'on_new_research_thread', 
        'new_thread_processor_job'
    );
    ```

#### **Phase 3.2: Execution & Verification**
1.  **Action**: Insert a new thread.
    ```sql
    INSERT INTO public.threads (title, objective) VALUES ('Test Thread Alpha', 'Verify thread trigger');
    ```
2.  **Verification**: Check if a corresponding job was created.
    ```sql
    SELECT count(*) FROM public.job_board WHERE job_name = 'new_thread_processor_job' AND status = 'PENDING';
    ```
    *   **Expected Result**: Returns a count of `1`.

---

### **Test 4: `on_artifact_status_change` Dispatch Trigger**

#### **Phase 4.1: Setup**
1.  **Full Reset**:
    ```sql
    DELETE FROM public.job_board;
    DELETE FROM public.job_schedules;
    DELETE FROM public.job_definitions;
    DELETE FROM public.artifacts;
    DELETE FROM public.threads;
    ```
2.  **Create Dependencies**:
    ```sql
    INSERT INTO public.job_definitions (name, prompt_ref) VALUES ('artifact_status_change_job', 'p@1');
    INSERT INTO public.job_schedules (job_definition_id, dispatch_trigger, trigger_filter, job_name) 
    VALUES (
        (SELECT id FROM public.job_definitions WHERE name = 'artifact_status_change_job'), 
        'on_artifact_status_change', 
        '{"table": "artifacts", "match_conditions": {"status": "PROCESSED"}}', 
        'artifact_status_change_job'
    );
    -- The following command returns an ID that you must use in the next step.
    INSERT INTO public.threads (title, objective) VALUES ('Artifact Test Thread', 'Verify artifact triggers') RETURNING id;
    ```
3.  **Create Artifact**: **(Replace `<thread_id>` with the ID from the previous step)**
    ```sql
    INSERT INTO public.artifacts (thread_id, content, topic, status) 
    VALUES ('<thread_id>', 'Initial artifact content', 'status_change_test', 'RAW');
    ```

#### **Phase 4.2: Execution & Verification**
1.  **Action**: Update the artifact's status.
    ```sql
    UPDATE public.artifacts SET status = 'PROCESSED' WHERE topic = 'status_change_test';
    ```
2.  **Verification**: Check if the status change triggered the correct job.
    ```sql
    SELECT count(*) FROM public.job_board WHERE job_name = 'artifact_status_change_job' AND status = 'PENDING';
    ```
    *   **Expected Result**: Returns a count of `1`.
