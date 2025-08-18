-- MIGRATION SCRIPT: CREATE universal_job_dispatcher_v2

BEGIN;

CREATE OR REPLACE FUNCTION public.universal_job_dispatcher_v2()
RETURNS TRIGGER AS $$
DECLARE
  event_data jsonb;
  job_to_dispatch public.jobs;
  v_project_definition_id uuid;
  v_project_name text;
  v_project_objective text;
  v_project_run_id uuid;
  trigger_context jsonb;
  delegated_work_context jsonb;
BEGIN
  IF TG_TABLE_NAME <> 'events' OR TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;

  event_data := to_jsonb(NEW);

  -- Resolve project context
  IF NEW.project_run_id IS NOT NULL THEN
    v_project_run_id := NEW.project_run_id;
    SELECT pr.project_definition_id, pd.name, pd.objective
    INTO v_project_definition_id, v_project_name, v_project_objective
    FROM public.project_runs pr
    LEFT JOIN public.project_definitions pd ON pd.id = pr.project_definition_id
    WHERE pr.id = v_project_run_id;
  ELSE
    SELECT id, name, objective
    INTO v_project_definition_id, v_project_name, v_project_objective
    FROM public.project_definitions
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_project_definition_id IS NULL THEN
      RAISE EXCEPTION 'No project_definitions found. Cannot create project_run.';
    END IF;

    INSERT INTO public.project_runs (project_definition_id)
    VALUES (v_project_definition_id)
    RETURNING id INTO v_project_run_id;
  END IF;

  FOR job_to_dispatch IN
    SELECT * FROM public.jobs
    WHERE is_active = true
      AND schedule_config->>'trigger' = 'on_new_event'
      AND public.jsonb_matches_conditions(event_data, schedule_config->'filters')
  LOOP
    -- Build trigger_context
    WITH expanded_context AS (
      SELECT
        e.id as event_id,
        e.event_type,
        e.payload,
        e.source_table,
        e.source_id,
        CASE
          WHEN e.source_table = 'artifacts' THEN
            jsonb_build_object(
              'artifact_id', a.id,
              'content', a.content,
              'topic', a.topic,
              'status', a.status,
              'created_at', a.created_at
            )
          WHEN e.source_table = 'job_board' THEN
            jsonb_build_object(
              'job_execution_id', jb.id,
              'job_name', jb.job_name,
              'status', jb.status,
              'output', jb.output,
              'created_at', jb.created_at,
              'related_artifacts', (
                SELECT jsonb_agg(jsonb_build_object('id', art.id, 'topic', art.topic, 'content', art.content))
                FROM artifacts art WHERE art.job_id = jb.id
              ),
              'related_job_reports', (
                SELECT jsonb_agg(jsonb_build_object('id', jr.id, 'status', jr.status, 'final_output', jr.final_output))
                FROM job_reports jr WHERE jr.job_id = jb.id
              ),
              'related_memories', (
                SELECT jsonb_agg(jsonb_build_object('id', m.id, 'content', m.content))
                FROM memories m WHERE m.job_id = jb.id
              )
            )
          WHEN e.source_table = 'events' THEN
            jsonb_build_object(
              'parent_event_id', e.parent_event_id,
              'correlation_id', e.correlation_id
            )
          ELSE jsonb_build_object('source_table', e.source_table, 'source_id', e.source_id)
        END as resolved_source_data
      FROM events e
      LEFT JOIN artifacts a ON e.source_table = 'artifacts' AND e.source_id = a.id
      LEFT JOIN job_board jb ON e.source_table = 'job_board' AND e.source_id = jb.id
      WHERE e.id = NEW.id
    )
    SELECT jsonb_build_object(
      'event', jsonb_build_object(
        'id', event_id,
        'type', event_type,
        'payload', payload,
        'source_table', source_table,
        'source_id', source_id
      ),
      'resolved_source', resolved_source_data
    ) INTO trigger_context
    FROM expanded_context;

    -- Build delegated_work_context
    WITH parent_last_run AS (
      SELECT MAX(created_at) as last_run_time
      FROM job_board
      WHERE parent_job_definition_id = job_to_dispatch.id
    ),
    child_work AS (
      SELECT
        jb.id,
        jb.job_name,
        jb.output,
        jb.status,
        jb.updated_at as completion_time,
        jb.job_report_id,
        (
          SELECT jsonb_agg(jsonb_build_object(
            'id', art.id,
            'topic', art.topic,
            'content', CASE
              WHEN length(art.content) > 1000 THEN
                substring(art.content, 1, 1000) || '... [truncated]'
              ELSE art.content
            END
          )) FROM artifacts art WHERE art.job_id = jb.id
        ) as artifacts
      FROM job_board jb
      WHERE jb.parent_job_definition_id = job_to_dispatch.id
      AND jb.updated_at > COALESCE((SELECT last_run_time FROM parent_last_run), '1970-01-01'::timestamptz)
      AND jb.status IN ('COMPLETED', 'FAILED')
    )
    SELECT jsonb_build_object(
      'child_jobs', (
        SELECT jsonb_agg(jsonb_build_object(
          'id', cw.id,
          'name', cw.job_name,
          'output', cw.output,
          'status', cw.status,
          'completion_time', cw.completion_time,
          'artifacts', cw.artifacts,
          'job_report_id', cw.job_report_id
        )) FROM child_work cw
      ),
      'summary', jsonb_build_object(
        'total_child_jobs', (SELECT COUNT(*) FROM child_work),
        'completed', (SELECT COUNT(*) FROM child_work WHERE status = 'COMPLETED'),
        'failed', (SELECT COUNT(*) FROM child_work WHERE status = 'FAILED'),
        'total_artifacts', (SELECT COALESCE(SUM(jsonb_array_length(artifacts)), 0) FROM child_work),
        'last_completion', (SELECT MAX(completion_time) FROM child_work)
      )
    ) INTO delegated_work_context;

    INSERT INTO public.job_board (
      parent_job_definition_id,
      job_name,
      enabled_tools,
      model_settings,
      input,
      status,
      source_event_id,
      project_run_id,
      project_definition_id,
      inbox,
      trigger_context,
      delegated_work_context
    ) VALUES (
      job_to_dispatch.id,
      job_to_dispatch.name,
      job_to_dispatch.enabled_tools,
      job_to_dispatch.model_settings,
      job_to_dispatch.prompt_content,
      'PENDING',
      NEW.id,
      v_project_run_id,
      v_project_definition_id,
      '[]',
      trigger_context,
      delegated_work_context
    );
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Update the universal_event_trigger to use the new function
DROP TRIGGER IF EXISTS universal_event_trigger ON public.events;
CREATE TRIGGER universal_event_trigger
AFTER INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION universal_job_dispatcher_v2();

COMMIT;
