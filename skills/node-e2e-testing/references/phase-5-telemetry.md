# Phase 5: Telemetry Verification

**Prerequisites**: Phase 3 PASS (at least one telemetry file exists)
**Abort on failure**: Continue

Parse telemetry files from Phases 3 and/or 4 to verify the agent used the required tools.

## Steps

### 1. Parse worker telemetry (Phase 3)

```bash
yarn test:e2e:parse-telemetry '/tmp/jinn-telemetry-worker/telemetry-*.json' \
  --required-tools google_web_search,get_file_contents,create_artifact,create_measurement,venture_query,dispatch_new_job
```

The script exits 0 if all required tools were called, 1 otherwise.

### 2. Parse rotation telemetry (Phase 4, if available)

Phase 4 processes the child job (dispatched by the parent in Phase 3). The child has a simpler blueprint:

```bash
yarn test:e2e:parse-telemetry '/tmp/jinn-telemetry-rotation/telemetry-*.json' \
  --required-tools google_web_search,create_artifact
```

### 3. Cross-check with Docker output

Also check the Docker worker stdout captured during Phases 3/4 for tool evidence:
- `google_web_search` — agent searched the web
- `get_file_contents` — agent fetched from GitHub via operator GITHUB_TOKEN (GitHub API error acceptable)
- `create_artifact` — agent created an artifact with results
- `create_measurement` — agent measured GOAL-001 invariant
- `venture_query` — agent queried venture registry (Supabase credentials worked)
- `dispatch_new_job` — agent dispatched a child job (delegation worked)
- `web_fetch` — agent fetched a URL

## Expected Output

The parse-telemetry script outputs:
- **Model**: Which Gemini model was used
- **Core tools enabled**: Should be non-empty (e.g., `google_web_search,web_fetch,...`)
- **Tool calls**: List with function_name, success status, duration
- **Required tool verification**: `[PASS]` or `[FAIL]` per required tool
- **Token usage**: input/output/total token counts
- **Event summary**: Count of each event type

## On Failure

- **No telemetry files found**: Check if `/tmp/jinn-telemetry-worker/` or `/tmp/jinn-telemetry-rotation/` exists. The Docker `--telemetry` flag mounts `/tmp/jinn-telemetry:/tmp`.
- **core_tools_enabled is empty**: Native tools were never configured. The Gemini CLI reads tool config from `settings.tools.core`.
- **Required tools not called**: Agent may have answered from memory without using tools. This is a genuine test failure — the blueprint invariants require tool use.
- **venture_query not called**: Supabase credentials may not have reached the Docker container. Check the `--env` flags in the Phase 3 Docker command. If Supabase was unconfigured, `venture_query` uses a mock client and may have errored silently.
- **dispatch_new_job not called**: Agent may have decided not to delegate. Check the blueprint invariant DELEGATE-001 — it should mandate delegation.
- **Parse errors**: The telemetry file format is concatenated JSON objects. The parser handles this, but if the file is truncated (container killed mid-write), some events may be lost.

## CHECKPOINT: Phase 5 — Telemetry Verification

### Phase 3 (Parent — Full Infrastructure)
- [PASS|FAIL] Telemetry file(s) found and parseable
- [PASS|FAIL] `core_tools_enabled` is non-empty
- [PASS|FAIL] `google_web_search` called at least once
- [PASS|FAIL] `get_file_contents` called at least once (operator GITHUB_TOKEN)
- [PASS|FAIL] `create_artifact` called at least once
- [PASS|FAIL] `create_measurement` called at least once
- [PASS|FAIL] `venture_query` called at least once (credential-dependent)
- [PASS|FAIL] `dispatch_new_job` called at least once (delegation)
- [PASS|FAIL] Token usage reported (input + output > 0)

### Phase 4 (Child — Rotation Pickup)
- [PASS|FAIL] Telemetry file(s) found and parseable
- [PASS|FAIL] `google_web_search` called at least once
- [PASS|FAIL] `create_artifact` called at least once
- [PASS|FAIL] Token usage reported (input + output > 0)
