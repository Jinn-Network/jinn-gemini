create or replace function plan_project(
    p_project_definition jsonb,
    p_project_run jsonb default '{}'::jsonb,
    p_jobs jsonb default '[]'::jsonb
)
returns table (
    project_definition_id uuid,
    project_run_id uuid,
    lead_job_definition_id uuid,
    child_job_definition_ids uuid[]
)
language plpgsql
as $$
declare
    v_project_definition_id uuid;
    v_project_run_id uuid;
    v_lead_job_definition_id uuid;
    v_child_job_definition_ids uuid[];
    v_job_def jsonb;
    v_child_job_def jsonb;
    v_lead_job_record jobs;
    v_child_job_record jobs;
    v_new_event_id uuid;
begin
    -- Upsert project_definition
    -- Use name for conflict resolution; if it exists, do nothing (for now)
    -- In the future, we might want to update it.
    insert into project_definitions (id, name, objective, strategy, kpis, owner_job_definition_id, parent_project_definition_id)
    values (
        coalesce((p_project_definition->>'id')::uuid, gen_random_uuid()),
        p_project_definition->>'name',
        p_project_definition->>'objective',
        p_project_definition->>'strategy',
        p_project_definition->'kpis',
        (p_project_definition->>'owner_job_definition_id')::uuid,
        (p_project_definition->>'parent_project_definition_id')::uuid
    )
    on conflict (name) do nothing
    returning id into v_project_definition_id;

    -- If the definition already existed, we need to fetch its ID
    if v_project_definition_id is null then
        select id into v_project_definition_id from project_definitions where name = p_project_definition->>'name';
    end if;

    -- Create project_run
    insert into project_runs (project_definition_id, status, inputs)
    values (
        v_project_definition_id,
        'PENDING',
        p_project_run
    )
    returning id into v_project_run_id;

    -- If jobs are provided, create them
    if jsonb_array_length(p_jobs) > 0 then
        -- The first job is the lead job
        v_job_def := p_jobs->0;

        insert into jobs (
            name,
            description,
            prompt_content,
            enabled_tools,
            project_definition_id,
            schedule_config,
            is_active
        )
        values (
            v_job_def->>'name',
            v_job_def->>'description',
            v_job_def->>'prompt_content',
            v_job_def->'enabled_tools',
            v_project_definition_id,
            '{"trigger": "manual"}'::jsonb, -- Lead job is dispatched manually right after creation
            true
        )
        returning * into v_lead_job_record;

        v_lead_job_definition_id := v_lead_job_record.id;

        -- Create and dispatch the lead job immediately
        -- 1. Create a source event for the dispatch
        insert into events (event_type, payload, source_table, source_id, project_run_id)
        values (
            'system.project.bootstrapped',
            jsonb_build_object(
                'project_definition_id', v_project_definition_id,
                'project_run_id', v_project_run_id,
                'lead_job_name', v_lead_job_record.name
            ),
            'project_runs',
            v_project_run_id,
            v_project_run_id
        )
        returning id into v_new_event_id;

        -- 2. Insert into job_board to dispatch
        insert into job_board (
            job_definition_id,
            job_name,
            enabled_tools,
            model_settings,
            input,
            status,
            source_event_id,
            project_run_id,
            project_definition_id,
            inbox
        )
        values (
            v_lead_job_record.id,
            v_lead_job_record.name,
            v_lead_job_record.enabled_tools,
            v_lead_job_record.model_settings,
            v_lead_job_record.prompt_content,
            'PENDING',
            v_new_event_id,
            v_project_run_id,
            v_project_definition_id,
            '[]'::jsonb
        );

        -- The rest of the jobs are child jobs that run after the lead job completes
        if jsonb_array_length(p_jobs) > 1 then
            for i in 1 .. jsonb_array_length(p_jobs) - 1 loop
                v_child_job_def := p_jobs->i;

                insert into jobs (
                    name,
                    description,
                    prompt_content,
                    enabled_tools,
                    project_definition_id,
                    schedule_config,
                    is_active
                )
                values (
                    v_child_job_def->>'name',
                    v_child_job_def->>'description',
                    v_child_job_def->>'prompt_content',
                    v_child_job_def->'enabled_tools',
                    v_project_definition_id,
                    jsonb_build_object(
                        'trigger', 'on_new_event',
                        'filters', jsonb_build_object(
                            'event_type', 'job.completed',
                            'job_definition_id', v_lead_job_definition_id
                        )
                    ),
                    true
                )
                returning * into v_child_job_record;

                v_child_job_definition_ids := array_append(v_child_job_definition_ids, v_child_job_record.id);
            end loop;
        end if;
    end if;

    -- Return the created IDs
    project_definition_id := v_project_definition_id;
    project_run_id := v_project_run_id;
    lead_job_definition_id := v_lead_job_definition_id;
    child_job_definition_ids := v_child_job_definition_ids;
    return next;
end;
$$;
