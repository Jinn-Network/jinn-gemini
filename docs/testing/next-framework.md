# Next-Generation Test Harness

We are migrating to a new test harness under `tests-next/`. It introduces a clear three-layer pyramid:

1. **Unit** – pure Vitest specs with mocked IO. Lives under `tests-next/unit/`.
2. **Integration** – boundary tests that rely on the env controller but stay in-process. Lives under `tests-next/integration/`.
3. **System** – full-stack scenarios that spin up Tenderly VNets, Ponder, Control API, MCP, and the worker via the process harness. Lives under `tests-next/system/`.

## Prerequisites

- `.env.test` with all required secrets (`TENDERLY_*`, `GITHUB_TOKEN`, `TEST_GITHUB_REPO`, etc.).
- A sanitized `.operate` directory copied into `tests-next/fixtures/operate-profile/` (see `README` in that folder). CI should restore the same archive before running tests.
- Node 22 and Yarn (managed via Volta in this repo).
- A sanitized git repository placed under `tests-next/fixtures/git-template/` for suites that need repo fixtures.

## Key Helpers

- `helpers/env-controller.ts`: loads env files, enforces `RUNTIME_ENVIRONMENT='test'`, points `OPERATE_PROFILE_DIR` at the fixture, and exposes `withTestEnv(async fn)`.
- `helpers/tenderly-runner.ts`: creates/deletes VNets, funds wallets, and wires RPC URLs into the env.
- `helpers/process-harness.ts`: provisions ports, boots Ponder + Control API + worker, waits for health checks, and tears everything down (use `withProcessHarness`).
- `helpers/git-fixture.ts`: clones the repository you place under `tests-next/fixtures/git-template/`, giving every suite a clean worktree to mutate.
- `helpers/assertions.ts`: polling utilities for deliveries, artifacts, job definitions, and requests.
- `helpers/port-utils.ts`: finds open ports so suites can run in parallel.
- `helpers/suite-env.ts`: allocates per-suite IDs, Ponder cache directories, and base ports so multiple system scenarios can run without fighting over resources (`withSuiteEnv`).

## Running Tests

Scripts targeting the new harness will be added incrementally (e.g., `yarn test:unit:next`). For now run Vitest directly:

```bash
npx vitest run --config vitest.config.next.ts --project unit-next
```

We will keep the legacy `tests/` directory running in parallel until all suites migrate. Once the new harness reaches parity, we will remove the old tree and promote the new scripts to the default CI workflow.
