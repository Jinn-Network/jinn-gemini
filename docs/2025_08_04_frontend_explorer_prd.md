# Frontend Explorer - Product Requirements Document

**Date**: 2025-08-04

## 1. Overview

The goal is to build a web-based interface, named "Explorer", to provide a comprehensive view into the state of the Jinn project's Supabase database. This tool will enable developers to easily browse, inspect, and understand the data flowing through the system, improving observability and debugging capabilities.

The application will be located in `/frontend/explorer` and will treat each database table as a "collection," providing intuitive navigation and data exploration features.

## 2. Key Features & Technologies

- **Framework**: Next.js
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui
- **Development**: Development will be assisted by browser-based automation tools for scaffolding and verification.

## 3. Core Concepts

- **Collection-Based Navigation**: Every current database table (excluding `_history` tables) will be represented as a browsable collection.
- **Index View**: For each collection, an index page (`/[collection]`) will display a list of all records in that table.
- **Show View**: A detail page (`/[collection]/[id]`) will display all available data for a single record.
- **Read-Only**: The initial version will be a read-only explorer.

## 4. Database Schema (Collections)

The Explorer will provide views for the following 10 tables:

1.  `job_board`: The central job queue.
2.  `job_definitions`: Reusable job templates.
3.  `job_schedules`: Rules for triggering jobs.
4.  `prompt_library`: Centralized storage for versioned prompts.
5.  `threads`: Hierarchical threads for organizing work.
6.  `artifacts`: Content generated during thread execution.
7.  `memories`: Vector-based memory storage for semantic search.
8.  `messages`: Inter-agent communication logs.
9.  `system_state`: Global key-value state for the system.
10. `job_reports`: Detailed execution reports and telemetry for jobs.

## 5. Data Access

The frontend application will need access to the Supabase database. Given the existing `metacog-mcp` package, the frontend can either:
a) Connect directly to Supabase using the `supabase-js` client with the `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
b) Leverage the existing MCP server by creating a new API layer that the frontend can call.

For the initial implementation, direct connection (a) is likely simpler, but this should be evaluated for security and scalability. The application will fetch data for the index and show pages.

## 6. High-Level Specification

The solution will consist of the following components:

-   **Next.js Application**:
    -   A new Next.js app located at `/frontend/explorer`.
    -   It will use App Router for routing.
    -   It will include a root layout (`/src/app/layout.tsx`) that sets up the global styles and a sidebar for navigation.
-   **Dynamic Routes**:
    -   `src/app/[collection]/page.tsx`: A dynamic page that fetches and displays a list of all records for the specified `collection` (table name). It will render a simple table view.
    -   `src/app/[collection]/[id]/page.tsx`: A dynamic page that fetches and displays the complete data for a single record, identified by its `id` from the specified `collection`. It will render a key-value view of the record's data.
-   **Data Fetching**:
    -   A utility file (`src/lib/supabase.ts`) will be created to initialize the Supabase client.
    -   Server Components will be used to fetch data directly from Supabase within the page components. This keeps data fetching on the server, enhancing security and performance.
-   **UI Components**:
    -   **Sidebar**: A static sidebar component (`src/components/Sidebar.tsx`) will list links to the index page of each of the 10 collections.
    -   **Data Table**: A reusable table component (`src/components/DataTable.tsx`) will be used on the index pages to display records.
    -   **Detail View**: A component (`src/components/DetailView.tsx`) on the show pages will render the record's data in a structured, readable format.
-   **Styling**:
    -   Tailwind CSS will be used for all styling.
    -   `shadcn/ui` will be used for pre-built components like tables and cards to accelerate UI development.

## 7. Low-Level Specification

### Directory Structure

```
/frontend/explorer
├── /src
│   ├── /app
│   │   ├── /[collection]
│   │   │   ├── /[id]
│   │   │   │   └── page.tsx      // Show view for a single record
│   │   │   └── page.tsx          // Index view for a collection
│   │   ├── layout.tsx            // Root layout with sidebar
│   │   └── page.tsx              // Home page of the explorer
│   ├── /components
│   │   ├── /ui                   // shadcn-generated components
│   │   ├── data-table.tsx        // Reusable table for index view
│   │   ├── detail-view.tsx       // Key-value display for show view
│   │   └── sidebar.tsx           // Navigation sidebar
│   ├── /lib
│   │   ├── supabase.ts           // Supabase client initialization
│   │   └── types.ts              // TypeScript type definitions
│   └── globals.css
├── next.config.mjs
├── package.json
└── tsconfig.json
```

### Type Definitions (`src/lib/types.ts`)

```typescript
// Generic type for any record from the database
export type DbRecord = {
  id: string | number;
  created_at?: string;
  [key: string]: any;
};

// List of all explorable table names
export const collectionNames = [
  'job_board',
  'job_definitions',
  'job_schedules',
  'prompt_library',
  'threads',
  'artifacts',
  'memories',
  'messages',
  'system_state',
  'job_reports',
] as const;

export type CollectionName = typeof collectionNames[number];

// Props for the main collection page (index view)
export interface CollectionPageProps {
  params: {
    collection: CollectionName;
  };
}

// Props for the record detail page (show view)
export interface RecordPageProps {
  params: {
    collection: CollectionName;
    id: string;
  };
}
```

### Component Pseudocode

#### `src/lib/supabase.ts`
```typescript
// IMPORTS: createBrowserClient from @supabase/ssr
//
// FUNCTION createClient():
//   // Reads SUPABASE_URL and SUPABASE_ANON_KEY from environment variables
//   // Initializes and returns the Supabase client
// END FUNCTION
```

#### `src/app/layout.tsx`
```typescript
// IMPORTS: React, Sidebar component
//
// FUNCTION RootLayout({ children }):
//   RETURN (
//     <html>
//       <body>
//         <div className="flex">
//           <Sidebar />
//           <main className="flex-grow p-6">
//             {children}
//           </main>
//         </div>
//       </body>
//     </html>
//   )
// END FUNCTION
```

#### `src/components/sidebar.tsx`
```typescript
// IMPORTS: React, Link from next/link, collectionNames from types
//
// FUNCTION Sidebar():
//   RETURN (
//     <aside className="w-64 p-4 border-r">
//       <h2 className="text-lg font-bold mb-4">Explorer</h2>
//       <nav>
//         <ul>
//           // MAP over collectionNames:
//           //   CREATE <li> with <Link href={`/${collectionName}`}>
//           //     {collectionName}
//           //   </Link></li>
//           // END MAP
//         </ul>
//       </nav>
//     </aside>
//   )
// END FUNCTION
```

#### `src/app/[collection]/page.tsx` (Index View)
```typescript
// IMPORTS: React, supabase client, DataTable component, CollectionPageProps
//
// ASYNC FUNCTION CollectionPage({ params }: CollectionPageProps):
//   // FETCH data from Supabase:
//   //   const { data: records, error } = await supabase
//   //     .from(params.collection)
//   //     .select('*')
//   //     .limit(100); // Add pagination later
//
//   // HANDLE error state
//
//   RETURN (
//     <div>
//       <h1 className="text-2xl font-bold mb-4">Collection: {params.collection}</h1>
//       <DataTable records={records || []} collectionName={params.collection} />
//     </div>
//   )
// END FUNCTION
```

#### `src/app/[collection]/[id]/page.tsx` (Show View)
```typescript
// IMPORTS: React, supabase client, DetailView component, RecordPageProps
//
// ASYNC FUNCTION RecordPage({ params }: RecordPageProps):
//   // FETCH data from Supabase:
//   //   const { data: record, error } = await supabase
//   //     .from(params.collection)
//   //     .select('*')
//   //     .eq('id', params.id)
//   //     .single();
//
//   // HANDLE error or not found state
//
//   RETURN (
//     <div>
//       <h1 className="text-2xl font-bold mb-4">
//         Record: {params.id} in {params.collection}
//       </h1>
//       <DetailView record={record} />
//     </div>
//   )
// END FUNCTION
```

#### `src/components/data-table.tsx`
```typescript
// IMPORTS: React, Link, shadcn Table components
//
// FUNCTION DataTable({ records, collectionName }):
//   // IF records is empty, show message
//
//   // GET headers from Object.keys(records[0])
//
//   RETURN (
//     <Table>
//       <TableHeader>
//         // MAP headers to <TableHead>
//       </TableHeader>
//       <TableBody>
//         // MAP records to <TableRow>
//         //   MAP record values to <TableCell>
//         //   For 'id' cell, render as a Link to the show page:
//         //   <Link href={`/${collectionName}/${record.id}`}>{record.id}</Link>
//         // END MAP
//       </TableBody>
//     </Table>
//   )
// END FUNCTION
```

#### `src/components/detail-view.tsx`
```typescript
// IMPORTS: React, shadcn Card components
//
// FUNCTION DetailView({ record }):
//   // IF no record, return null
//
//   RETURN (
//     <Card>
//       <CardContent>
//         // MAP Object.entries(record) to display key-value pairs
//         //   <div className="flex">
//         //     <strong className="w-1/4">{key}:</strong>
//         //     <span className="w-3/4">{JSON.stringify(value, null, 2)}</span>
//         //   </div>
//         // END MAP
//       </CardContent>
//     </Card>
//   )
// END FUNCTION
```
## 8. Development Plan (Vertical Slicing)

This plan breaks down the project into end-to-end user-facing features. Each slice delivers a complete piece of functionality.

### Slice 1: Project Setup & Core Layout
**Goal**: Establish the foundational structure of the application.
1.  **Initialize Project**: Run `yarn create next-app` in `frontend/explorer` with TypeScript, Tailwind, ESLint, and App Router.
2.  **Setup Dependencies**: Install `shadcn-ui` and initialize it.
3.  **Create Root Layout**: Implement `src/app/layout.tsx` to define the main page structure.
4.  **Implement Sidebar**: Create the static `Sidebar` component (`src/components/sidebar.tsx`) with hardcoded links to each collection's future index page. This provides the main navigation from day one.
5.  **Homepage**: Create a simple homepage (`src/app/page.tsx`) that welcomes the user.

### Slice 2: View `job_board` Collection (Index & Show)
**Goal**: Implement the first end-to-end collection view. This slice proves out the core data fetching and display logic.
1.  **Supabase Client**: Create `src/lib/supabase.ts` and configure the Supabase client. Create a `.env.local` file with the required `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2.  **Define Types**: Create `src/lib/types.ts` with the initial `DbRecord` and `CollectionName` types.
3.  **Collection Index Page**: Implement the dynamic route `src/app/[collection]/page.tsx`. It will fetch all records from the `job_board` table and display them.
4.  **Data Table Component**: Create the `DataTable` component (`src/components/data-table.tsx`) to render the fetched `job_board` records in a table. The `id` column should link to the show page.
5.  **Record Show Page**: Implement the dynamic route `src/app/[collection]/[id]/page.tsx`. It will fetch a single record from `job_board` by its ID.
6.  **Detail View Component**: Create the `DetailView` component (`src/components/detail-view.tsx`) to render the single `job_board` record's data.

### Slice 3: Generalize for All Collections
**Goal**: Extend the functionality from Slice 2 to work for all 10 collections.
1.  **Refactor Dynamic Pages**: Ensure `[collection]/page.tsx` and `[collection]/[id]/page.tsx` work dynamically for any valid `CollectionName` passed in the URL parameters.
2.  **Update Sidebar**: Ensure the `Sidebar` links are generated dynamically from the `collectionNames` array in `types.ts`.
3.  **Testing**: Manually test each collection link in the sidebar to ensure both the index and show pages render correctly for all 10 tables.

### Slice 4: UI Polish and Refinements
**Goal**: Improve the user experience and visual presentation.
1.  **Improve Data Display**: In `DetailView` and `DataTable`, format different data types more elegantly (e.g., format timestamps, render JSONB in a collapsible tree, handle long text).
2.  **Add Error Handling**: Implement more robust error states for data fetching failures (e.g., show a toast or an error message component).
3.  **Add Loading States**: Show loading spinners or skeletons while data is being fetched on the index and show pages.
4.  **Implement Pagination**: Add "Next" and "Previous" buttons to the `DataTable` component to paginate through large record sets instead of limiting to the first 100.
5.  **Add Search/Filter (Optional)**: If time permits, add a simple search bar to the index page to filter records.
