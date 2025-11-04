---
title: "Documentation"
---

# Documentation
This is how the implementation CURRENTLY works, in plain text.

### Jobs

#### Runs

##### Worker Loop

The worker loop is implemented in `worker/mech_worker.ts`. It is responsible for fetching, claiming, executing, and delivering jobs.

The main loop in `main()` function continuously calls `processOnce()` function.

The `processOnce()` function performs the following steps:

1.  **Fetch Unclaimed Requests**: It fetches a list of recent, unclaimed, and undelivered job requests from the Ponder indexer. The indexer gets the data from the `MechMarketplace` and `OlasMech` smart contracts.

2.  **Claim Request**: It iterates through the unclaimed requests and attempts to claim one using the Control API. The Control API ensures that only one worker can claim a specific job.

3.  **Fetch IPFS Metadata**: Once a job is claimed, the worker fetches the job metadata from IPFS. The metadata is a JSON object that contains the prompt, the model to be used, and the list of enabled tools.

4.  **Recognition Phase**: Before executing the agent, the worker runs a "recognition phase". In this phase, it creates a "situation" artifact that represents the current job. It then uses this situation to find similar past jobs by performing a vector search. The learnings from similar past jobs are then used to enhance the prompt for the current job.

5.  **Run Agent**: The worker then creates an `Agent` instance and calls the `run()` method with the prompt and the enabled tools. The `Agent` class is responsible for running the Gemini CLI in a separate process.

6.  **Store Report**: After the agent finishes, the worker stores a job report in the Control API. The report includes the status of the job (e.g., `COMPLETED`, `FAILED`), the output of the agent, and telemetry data.

7.  **Reflection Phase**: After storing the report, the worker runs a "reflection phase". In this phase, it prompts the agent to create `MEMORY` artifacts if any valuable learnings were discovered during the job execution.

8.  **Create Situation Artifact**: The worker then creates a "situation" artifact that captures the complete context of the job run, including the job details, the execution trace, and the final status.

9.  **Deliver Result**: Finally, the worker delivers the result on-chain via a Safe multisig wallet. The delivery includes the output of the agent, the telemetry data, and a list of created artifacts.