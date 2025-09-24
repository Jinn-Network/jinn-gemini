# On-Chain Job & Artifact System

This document provides a comprehensive overview of the system for dispatching, managing, and tracking on-chain jobs and their outputs (artifacts). It covers the core tools, the end-to-end data flow, the subgraph indexing logic, and the underlying data models.

## Core Components

The system is composed of several key components that work together:

1.  **MCP Tools**: A set of command-line and programmatic tools for interacting with the system.
    *   `dispatch_new_job`: Creates a new job definition and dispatches a request to the marketplace.
    *   `dispatch_existing_job`: Dispatches a new request for a pre-existing job definition.
    *   `get_details`: Retrieves detailed records for job definitions, requests, deliveries, and artifacts from the subgraph.
2.  **On-chain Contracts**: Smart contracts that handle the logic for requests and deliveries.
    *   `MechMarketplace`: The central contract for posting job requests.
    *   `OlasMech`: The contract that agents/mechs use to deliver results.
3.  **IPFS**: A decentralized storage system used for request and delivery metadata. All prompts, tool configurations, and result artifacts are stored on IPFS.
4.  **Ponder Subgraph**: An indexing service that listens to on-chain events from the contracts, fetches corresponding data from IPFS, and organizes it into a queryable GraphQL API.

## The Tools in Detail

### `dispatch_new_job`

This tool is used to create and dispatch a completely new job.

-   **Inputs**:
    -   `prompt` (string, required): The main instruction or prompt for the job.
    -   `jobName` (string, required): A unique, human-readable name for the job definition.
    -   `enabledTools` (string[], optional): A list of tools that the agent is allowed to use.
    -   `updateExisting` (boolean, optional, default: `false`): A flag to control behavior if a job with the same `jobName` already exists.
-   **Behavior**:
    1.  **Duplicate Check**: It first queries the subgraph to see if a `jobDefinition` with the given `jobName` already exists.
    2.  **Guard Logic**:
        -   If a job exists and `updateExisting` is `false` (the default), the tool will **not** post a new job. Instead, it returns the details of the existing job definition and a message indicating that it already exists.
        -   If a job exists and `updateExisting` is `true`, the tool will reuse the existing `jobDefinitionId`.
        -   If no job with that name exists, it generates a new, unique `jobDefinitionId` (a strict UUID).
    3.  **IPFS Upload & Dispatch**: It constructs a JSON payload containing the `prompt`, `jobName`, `enabledTools`, the determined `jobDefinitionId`, and any parent context (`parentRequestId`). This payload is uploaded to IPFS.
    4.  **Marketplace Request**: It then calls the `MechMarketplace` contract to post a new request, pointing to the metadata on IPFS.
-   **Output**: A JSON object containing the transaction details from the marketplace interaction (e.g., `transaction_hash`, `request_ids`) and a link to the request metadata on the IPFS gateway.

### `dispatch_existing_job`

This tool is used to run a job that has already been defined.

-   **Inputs**:
    -   `jobId` (string, optional): The UUID of the job definition to dispatch.
    -   `jobName` (string, optional): The name of the job definition to dispatch. (Either `jobId` or `jobName` must be provided).
    -   `prompt` (string, optional): An optional new prompt to override the one stored in the job definition.
    -   `enabledTools` (string[], optional): An optional new list of tools to override the ones stored in the job definition.
-   **Behavior**:
    1.  **Subgraph Lookup**: It queries the Ponder subgraph to find the existing job definition using either the `jobId` or `jobName`. If no job is found, it returns an error.
    2.  **Payload Construction**: It uses the retrieved job definition (its ID, name, prompt, and tools) and applies any provided overrides.
    3.  **Dispatch**: It then performs the same IPFS upload and marketplace request as `dispatch_new_job`, but using the existing `jobDefinitionId`.
-   **Output**: A JSON object containing the transaction details and the `jobDefinitionId` that was dispatched.

### `get_details`

This tool is a universal utility for fetching records from the Ponder subgraph.

-   **Inputs**:
    -   `ids` (string[]): An array of IDs to fetch. The tool intelligently partitions IDs based on their format:
        -   **Request ID**: `0x...` (e.g., `0x123abc...`)
        -   **Job Definition ID**: UUID (e.g., `123e4567-e89b-12d3-a456-426614174000`)
        -   **Artifact ID**: `<requestId>:<index>` (e.g., `0x123abc...:0`)
    -   `resolve_ipfs` (boolean, optional, default: `true`): If `true`, the tool will fetch and embed the content of any IPFS hashes found in the records.
-   **Behavior**: It sends GraphQL queries to the Ponder subgraph for each type of ID provided and returns the combined results, maintaining the original order.
-   **Output**: A JSON object containing the `data` (an array of the fetched records) and `meta` information.

---

## End-to-End Data Flow

Here is the step-by-step lifecycle of a job from creation to delivery and artifact indexing.

1.  **Dispatching a Job**: A user calls `dispatch_new_job`. The tool creates a `jobDefinitionId`, and posts a `MarketplaceRequest`. The request's metadata (containing the `jobDefinitionId`) is uploaded to IPFS.

2.  **Subgraph Indexes Request**: The Ponder subgraph, which is constantly listening to the blockchain, detects the `MarketplaceRequest` event. It then:
    -   Fetches the corresponding metadata JSON from IPFS using the hash from the event.
    -   Creates a new record in its `jobDefinition` table using the `jobDefinitionId`, `jobName`, etc., from the IPFS content.
    -   Creates a new record in its `request` table, linking it to the job definition via `sourceJobDefinitionId`.

3.  **Worker Execution**: An autonomous agent (a "mech" or "worker") picks up the job request from the marketplace.

4.  **Delivering Results**: The worker executes the job. Upon completion, it:
    -   Creates one or more artifacts (e.g., a text summary, a generated image).
    -   Constructs a final **delivery JSON payload**. This payload is crucial and contains:
        -   The `jobDefinitionId` and other job fields (for redundancy and backfilling).
        -   An `artifacts` array, where each object contains the artifact's `name`, `topic`, `cid` (its IPFS hash), and an optional `contentPreview`.
    -   Uploads this delivery JSON to IPFS.
    -   Calls the `deliver` function on the `OlasMech` smart contract, passing the IPFS hash of the delivery JSON.

5.  **Subgraph Indexes Delivery & Artifacts**: The Ponder subgraph detects the `OlasMech:Deliver` event. It then:
    -   Fetches the delivery JSON from IPFS.
    -   Creates a `delivery` record.
    -   Updates the original `request` record to mark it as `delivered`.
    -   Updates the `jobDefinition` record if any new information is present in the delivery payload.
    -   Iterates through the `artifacts` array in the payload and creates a new `artifact` record in its database for each one, linking it back to the request and job definition via `sourceRequestId` and `sourceJobDefinitionId`.

---

## Subgraph Data Models

The Ponder subgraph organizes the data into several tables. Here are the key fields:

#### `jobDefinition` Table
-   `id`: `string` (UUID, Primary Key)
-   `name`: `string` (The human-readable job name)
-   `enabledTools`: `string[]`
-   `promptContent`: `string`
-   `sourceJobDefinitionId`: `string` (The `id` of the parent job definition, establishing a hierarchy)
-   `sourceRequestId`: `string` (The `id` of the request that created this job definition)

#### `request` Table
-   `id`: `string` (On-chain request ID, Primary Key)
-   `sender`: `string` (Address of the requester)
-   `ipfsHash`: `string` (CID of the request metadata)
-   `deliveryIpfsHash`: `string` (CID of the delivery metadata)
-   `delivered`: `boolean`
-   `sourceJobDefinitionId`: `string` (Links to the `jobDefinition`)
-   `sourceRequestId`: `string` (Links to a parent `request`)

#### `delivery` Table
-   `id`: `string` (On-chain request ID, Primary Key)
-   `ipfsHash`: `string` (CID of the delivery metadata)
-   `sourceJobDefinitionId`: `string` (Links to the `jobDefinition`)
-   `sourceRequestId`: `string` (Links to the `request`)

#### `artifact` Table
-   `id`: `string` (Composite key: `<requestId>:<index>`, Primary Key)
-   `name`: `string`
-   `topic`: `string` (A category for the artifact)
-   `cid`: `string` (The IPFS hash of the artifact's content)
-   `contentPreview`: `string`
-   `sourceJobDefinitionId`: `string` (Links to the `jobDefinition`)
-   `sourceRequestId`: `string` (Links to the `request`)

---

## For Mech & Worker Developers

To ensure your agent's outputs are correctly indexed, the delivery payload you upload to IPFS is critical. It **must** follow this structure:

```json
{
  "jobDefinitionId": "123e4567-e89b-12d3-a456-426614174000",
  "jobName": "Example Research Job",
  "enabledTools": ["google_web_search"],
  "prompt": "Summarize the latest AI news.",
  "result": "The final answer from the agent...",
  "artifacts": [
    { 
      "name": "summary.md", 
      "topic": "result.summary", 
      "cid": "bafybeigdyrzt5sfp7udm7hu76uh7y26...", 
      "contentPreview": "Recent advancements in AI include..." 
    },
    { 
      "name": "sources.json", 
      "topic": "result.sources", 
      "cid": "bafybeihdwdpcsd5q2plwoty2rvff36...", 
      "contentPreview": "[{\"url\": \"https://...\"}]" 
    }
  ]
}
```

-   The top-level job fields (`jobDefinitionId`, `jobName`, etc.) are used by the indexer to reliably link the delivery back to the correct job definition.
-   The `artifacts` array must contain objects, each with a `name`, `topic`, and `cid`. The `contentPreview` is optional but highly recommended.
