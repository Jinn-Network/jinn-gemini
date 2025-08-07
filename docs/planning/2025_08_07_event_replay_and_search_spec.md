# Feature Spec: Event Replay & Search Engine

- **Date:** 2025-08-07
- **Status:** Proposed
- **ID:** `feat-event-replay-search`

### 1. Background & Goal

The primary goal is to develop a powerful capability for both human mentors and AI agents to "replay" or "search" through sequences of events within the database. This will allow for a clear, traversable picture of how discrete events, jobs, artifacts, and threads are interconnected. The main motivation is to create a tool to understand an entire metacognitive cycle from start to finish, observing how the system reasons, acts, and creates new work for itself.

### 2. Current System State (Context)

Our initial investigation confirmed that the foundational data model required for this feature is **already in place and fully implemented** according to the `universal_traceability_spec.md`. The database schema successfully captures the necessary provenance and context for all key records.

- **Universal Context Injection**: The worker, agent, and MCP tools correctly inject `jobId`, `jobName`, and `threadId` into all operations.
- **Database Schema**: The live database schema, verified via MCP tools, confirms that the following tables contain the necessary context columns, enabling a rich data graph:
    - `artifacts`: Contains `source_job_id`, `source_job_name`, and `thread_id`.
    - `threads`: Contains `source_job_id` and `source_job_name`.
    - `memories`: Contains `source_job_id`, `source_job_name`, and `thread_id`.
    - `job_definitions`: Contains `source_job_id`, `source_job_name`, and `thread_id`.
    - `job_schedules`: Contains `source_job_id`, `source_job_name`, and `thread_id`.
    - `job_reports`: Provides a detailed log of every job's execution, including tool calls, token counts, and final output, linkable via `job_id`.

This existing data structure is the perfect foundation for building the required search and replay functionality.

### 3. Functional Requirements

The new functionality must allow a user (or agent) to:

1.  **Understand Job Causality**: For any job, be able to identify the specific event and schedule that caused its creation. This is the crucial "why" behind every action.
2.  **Trace a Thread's Lifecycle**: Given a `thread_id`, reconstruct the complete, chronological sequence of all associated events, including all jobs run, the schedules that triggered them, artifacts created, and status changes.
3.  **Reconstruct a Job's Impact**: Given a `job_id`, provide a detailed report of its execution (from `job_reports`), identify its source schedule, and trace all the direct consequences of that job (i.e., all records it created or modified).
4.  **Identify Metacognitive Loops**: Search for sequences where a job (Job A) leads to the creation of a new `job_definition` or `job_schedule`, which in turn leads to the execution of a new job (Job B). This is the core of analyzing self-improvement cycles.
5.  **Perform Pattern-Based Searches**: Allow for flexible queries to find event sequences based on a combination of criteria.
6.  **Visualize Event Timelines**: The Frontend Explorer must provide a clear, interactive visualization for the event sequences returned by the new tools.

### 4. High-Level Implementation Specification

To meet these requirements, we will undertake a full-stack implementation, from database enhancements to frontend components.

#### 4.1. Database Schema Enhancement (Prerequisite)

To capture job causality, we will add a new column to the `job_board` table:

- **New Column**: `source_schedule_id` (UUID, FK to `job_schedules.id`, nullable)
- **Action**: A migration script will be created to add this column.
- **Trigger Modification**: The `universal_job_dispatcher` database trigger will be modified to populate this new `source_schedule_id` field with the ID of the matching `job_schedule` whenever it creates a new job on the `job_board`.

#### 4.2. New MCP Tools (for Agent Use)

We will create the following new tools within the `metacog-mcp` package for agent-based analysis:

1.  **`trace_thread`**: Traces the complete history of a thread.
2.  **`reconstruct_job`**: Reconstructs the full context and impact of a single job.
3.  **`search_events`**: Performs a flexible search across the event graph.

#### 4.3. Database Strategy: SQL Functions (for Agent & Frontend)

To provide a performant and unified data access layer for both the MCP tools and the frontend, we will create powerful and optimized PostgreSQL functions.

1.  **`get_thread_timeline(p_thread_id UUID)`**:
    - This function will perform the necessary `JOIN` operations across `job_board`, `job_schedules`, `job_reports`, and `artifacts` to build the complete, ordered timeline.
2.  **`get_job_impact(p_job_id UUID)`**:
    - This function will fetch the detailed `job_report`, the `source_schedule`, and all resulting records.
3.  **`search_system_events(...)`**:
    - A flexible function to power the `search_events` tool and frontend search components.

#### 4.4. Frontend Integration (for Human Use)

The Frontend Explorer will be enhanced to visually represent the event data retrieved from the new SQL functions.

- **New Page Route**: A new page will be created, potentially at `/explorer/threads/[thread_id]/timeline`, to host the visualization.
- **Timeline Component**: A new React component (`<EventTimeline />`) will be developed to render the sequence of jobs, artifacts, and other events in a clear, chronological, and interactive format.
- **Data Fetching**: The page will use the Supabase client library to make direct RPC calls to the `get_thread_timeline` function.
- **UI Enhancements**: Existing views (e.g., job details, artifact details) will be updated with links to the new timeline view to create a seamless exploration experience.

---
---

## 5. Low-Level Implementation Specification

This section provides a detailed, step-by-step technical implementation plan.

### 5.1. Part 1: Database Layer

#### 5.1.1. Migration: Add `source_schedule_id` to `job_board`

A new migration file will be created to enhance traceability.

- **File Location:** `migrations/add_source_schedule_id_to_job_board.sql`
- **Content:**
  ```sql
  -- Add source_schedule_id to job_board to track job creation causality
  ALTER TABLE public.job_board
  ADD COLUMN source_schedule_id UUID;

  -- Add foreign key constraint to job_schedules table
  ALTER TABLE public.job_board
  ADD CONSTRAINT fk_source_schedule
  FOREIGN KEY (source_schedule_id)
  REFERENCES public.job_schedules(id)
  ON DELETE SET NULL; -- If a schedule is deleted, we want to keep the job record

  -- Add an index for faster lookups
  CREATE INDEX idx_job_board_source_schedule_id ON public.job_board(source_schedule_id);

  -- Add a comment for documentation
  COMMENT ON COLUMN public.job_board.source_schedule_id IS 'The ID of the job_schedule that triggered the creation of this job.';
  ```

#### 5.1.2. Database Function: `get_thread_timeline`

This function will be the primary data source for both the `trace_thread` tool and the new frontend timeline view. It will return a single JSON array of all events related to a thread, ordered chronologically.

- **Function Name:** `public.get_thread_timeline`
- **Parameters:** `p_thread_id UUID`
- **Return Type:** `JSONB`
- **Definition:**
  ```sql
  CREATE OR REPLACE FUNCTION public.get_thread_timeline(p_thread_id UUID)
  RETURNS JSONB AS $$
  DECLARE
      timeline JSONB;
  BEGIN
      WITH events AS (
          -- Select Artifacts
          SELECT
              id,
              'ARTIFACT_CREATED' AS event_type,
              created_at,
              jsonb_build_object(
                  'id', id,
                  'content', content,
                  'topic', topic,
                  'status', status,
                  'source_job_id', source_job_id
              ) AS event_details
          FROM public.artifacts
          WHERE thread_id = p_thread_id

          UNION ALL

          -- Select Jobs
          SELECT
              jb.id,
              'JOB_CREATED' AS event_type,
              jb.created_at,
              jsonb_build_object(
                  'id', jb.id,
                  'name', jb.job_name,
                  'status', jb.status,
                  'source_schedule_id', jb.source_schedule_id,
                  'report_id', jr.id
              ) AS event_details
          FROM public.job_board jb
          LEFT JOIN public.job_reports jr ON jb.id = jr.job_id
          WHERE jb.input_context::jsonb ->> 'thread_id' = p_thread_id::text -- Filter jobs related to the thread

          UNION ALL

          -- Select Thread Creation
          SELECT
              id,
              'THREAD_CREATED' as event_type,
              created_at,
              jsonb_build_object(
                'id', id,
                'title', title,
                'objective', objective,
                'source_job_id', source_job_id
              ) as event_details
          FROM public.threads
          WHERE id = p_thread_id
      )
      SELECT jsonb_agg(e ORDER BY e.created_at ASC)
      INTO timeline
      FROM events e;

      RETURN timeline;
  END;
  $$ LANGUAGE plpgsql;
  ```

### 5.2. Part 2: Backend (MCP Tools)

#### 5.2.1. New Tool: `trace_thread`

This tool will expose the `get_thread_timeline` database function to the agent.

- **File Location:** `packages/metacog-mcp/src/tools/trace-thread.ts`
- **Type Definitions (`types.ts`):**
  ```typescript
  // In a shared types file, e.g., packages/metacog-mcp/src/tools/shared/types.ts
  export const traceThreadParams = z.object({
    thread_id: z.string().uuid().describe('The ID of the thread to trace.'),
  });
  export type TraceThreadParams = z.infer<typeof traceThreadParams>;
  ```
- **Tool Implementation:**
  ```typescript
  import { supabase } from './shared/supabase.js';
  import { traceThreadParams, TraceThreadParams } from './shared/types.js';

  export const traceThreadSchema = {
    description: 'Traces the complete history of a thread, returning a chronological timeline of all associated jobs and artifacts.',
    inputSchema: traceThreadParams.shape,
  };

  export async function traceThread(params: TraceThreadParams) {
    const { thread_id } = traceThreadParams.parse(params);
    try {
      const { data, error } = await supabase.rpc('get_thread_timeline', { p_thread_id: thread_id });
      if (error) throw error;
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error tracing thread: ${e.message}` }] };
    }
  }
  ```
- **Registration (`packages/metacog-mcp/src/server.ts`):** The new `traceThread` tool will be imported and added to the `serverTools` array.

### 5.3. Part 3: Frontend (Explorer)

#### 5.3.1. New Page Route & Component Structure

A new page will be created to display the event timeline.

- **New Directory:** `frontend/explorer/src/app/threads/[id]/timeline/`
- **New Page File:** `page.tsx` within the new directory.
- **New Component:** `frontend/explorer/src/components/event-timeline.tsx`

#### 5.3.2. Type Definitions

New types will be added to `frontend/explorer/src/lib/types.ts`.

```typescript
export interface TimelineEvent {
  id: string;
  event_type: 'ARTIFACT_CREATED' | 'JOB_CREATED' | 'THREAD_CREATED';
  created_at: string;
  event_details: {
    id: string;
    // ... other properties depending on event_type
    [key: string]: any;
  };
}
```

#### 5.3.3. Data Fetching Logic

The new page will fetch data directly from the Supabase function.

- **File:** `frontend/explorer/src/app/threads/[id]/timeline/page.tsx`
- **Implementation Detail:**
  ```typescript
  import { createClient } from '@/lib/supabase/server'; // Assuming server-side client
  import EventTimeline from '@/components/event-timeline';
  import { TimelineEvent } from '@/lib/types';

  export default async function ThreadTimelinePage({ params }: { params: { id: string } }) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc('get_thread_timeline', { p_thread_id: params.id });

    if (error) {
      // Handle error display
      return <div>Error loading timeline: {error.message}</div>;
    }
    const events: TimelineEvent[] = data || [];

    return (
      <div className="container mx-auto p-4">
        <h1 className="text-2xl font-bold mb-4">Timeline for Thread {params.id}</h1>
        <EventTimeline events={events} />
      </div>
    );
  }
  ```

#### 5.3.4. New UI Component: `EventTimeline`

This component will be responsible for rendering the timeline.

- **File:** `frontend/explorer/src/components/event-timeline.tsx`
- **Implementation Sketch:**
  ```typescript
  import { TimelineEvent } from '@/lib/types';
  import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
  import { IdLink } from './id-link'; // Re-use existing component

  // A helper to render specific details for each event type
  const renderEventDetails = (event: TimelineEvent) => {
    switch (event.event_type) {
      case 'ARTIFACT_CREATED':
        return (
          <>
            <p>Topic: {event.event_details.topic}</p>
            <p>Status: {event.event_details.status}</p>
            <IdLink collection="artifacts" id={event.event_details.id} />
          </>
        );
      case 'JOB_CREATED':
        return (
          <>
            <p>Job Name: {event.event_details.name}</p>
            <p>Status: {event.event_details.status}</p>
            <IdLink collection="jobs" id={event.event_details.id} />
          </>
        );
      case 'THREAD_CREATED':
         return <p>Objective: {event.event_details.objective}</p>;
      default:
        return <p>{JSON.stringify(event.event_details)}</p>;
    }
  };

  export default function EventTimeline({ events }: { events: TimelineEvent[] }) {
    return (
      <div className="relative border-l-2 border-gray-200">
        {events.map((event, index) => (
          <div key={index} className="mb-8 ml-4">
            <div className="absolute w-3 h-3 bg-gray-300 rounded-full -left-1.5 mt-1.5"></div>
            <Card>
              <CardHeader>
                <CardTitle>{event.event_type}</CardTitle>
                <time className="text-sm text-gray-500">{new Date(event.created_at).toLocaleString()}</time>
              </CardHeader>
              <CardContent>
                {renderEventDetails(event)}
              </CardContent>
            </Card>
          </div>
        ))}
      </div>
    );
  }
  ```
- **Styling**: The component will use a combination of `Card` components from `shadcn/ui` and some custom CSS to create the vertical timeline line.
- **Linking**: The `IdLink` component will be reused to provide direct navigation to the detail pages for jobs and artifacts from within the timeline.

---
---

## 6. Detailed Development Plan (Vertical Slicing)

This section provides a vertically-sliced development plan that breaks down the implementation into three logical, end-to-end features. Each slice delivers complete functionality from the database layer to the user interface.

### **Vertical Slice 1: Thread Timeline View (Core Read-Only Feature)**

**Goal:** Implement the primary user-facing feature: the ability to view a complete, chronological timeline of all events associated with a specific thread.

1.  **Database Layer**
    *   [x] **Alter `job_board` Table:** The `source_schedule_id` column has been added to capture job causality.
    *   [x] **Create `get_thread_timeline` Function:** The SQL function to query and aggregate all thread-related events is now in place.

2.  **Backend - MCP Tool (For Agent Use)**
    *   **Create `trace-thread.ts`:** Create the new tool file in `packages/metacog-mcp/src/tools/`.
    *   **Define `traceThread` Logic:** Implement the function that calls the `get_thread_timeline` RPC.
    *   **Add Types:** Add the Zod schema for `traceThreadParams` to a shared types file.
    *   **Register Tool:** Import and add `traceThread` to the `serverTools` array in `packages/metacog-mcp/src/server.ts`.

3.  **Frontend - Explorer (For Human Use)**
    *   **Define Types:** Add the `TimelineEvent` interface to `frontend/explorer/src/lib/types.ts`.
    *   **Create Page Route:** Create the file `frontend/explorer/src/app/threads/[id]/timeline/page.tsx`.
    *   **Implement Data Fetching:** In the new page file, use the Supabase client to call the `get_thread_timeline` RPC and pass the data to a client component.
    *   **Create `<EventTimeline />` Component:** Build the new component in `frontend/explorer/src/components/event-timeline.tsx`. This component will receive the events and render them as a vertical timeline using `Card` components.
    *   **Add Navigation:** Modify the `thread-details-sidebar.tsx` component to add a "View Timeline" button or link that navigates to the new page.

---

### **Vertical Slice 2: Job Reconstruction View**

**Goal:** Allow a user to select any job from the timeline (or other views) and see a detailed breakdown of its execution and direct impact.

1.  **Database Layer**
    *   **Create `get_job_impact` Function:** Create a new SQL function that takes a `job_id`, fetches its `job_report`, looks up its `source_schedule`, and finds all records in other tables that list the `job_id` as their `source_job_id`.

2.  **Backend - MCP Tool**
    *   **Create `reconstruct_job.ts`:** Create the new tool file.
    *   **Implement `reconstruct_job` Logic:** Implement the function to call the `get_job_impact` RPC.
    *   **Add Types & Register:** Add the necessary types and register the tool in the MCP server.

3.  **Frontend - Explorer**
    *   **Create Page Route:** Create the file `frontend/explorer/src/app/jobs/[id]/impact/page.tsx`.
    *   **Create `<JobImpactView />` Component:** Build a component that neatly displays the full job report and lists all the artifacts, threads, or other records that were created by this job.
    *   **Add Navigation:** In the `<EventTimeline />` component, make the `JOB_CREATED` event cards link to this new job impact page.

---

### **Vertical Slice 3: System-Wide Event Search**

**Goal:** Provide a powerful, flexible search interface for finding events across the entire system, enabling more advanced analysis.

1.  **Database Layer**
    *   **Create `search_system_events` Function:** Create a highly flexible SQL function that accepts a JSON object with various optional filters (e.g., `event_type`, `status`, `job_name`, `topic`, `time_range`).

2.  **Backend - MCP Tool**
    *   **Create `search_events.ts`:** Create the final tool file.
    *   **Implement `search_events` Logic:** Implement the function to call the `search_system_events` RPC.
    *   **Add Types & Register:** Add types for the flexible search parameters and register the tool.

3.  **Frontend - Explorer**
    *   **Create Page Route:** Create a new page at `frontend/explorer/src/app/search/page.tsx`.
    *   **Create `<EventSearchForm />` Component:** Build a form with input fields for the various search filters.
    *   **Create `<SearchResultsList />` Component:** Build a component to render the list of events returned by the search function.

This vertically-sliced plan ensures that we build the feature incrementally, with each step delivering a usable and testable piece of the final product. We will begin with Slice 1.