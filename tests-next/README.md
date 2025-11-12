# Tests Next

This directory hosts the next-generation test harness for the Jinn codebase. It starts clean from the legacy `tests/` tree so we can iterate on environment control, Tenderly orchestration, and the system harness without breaking existing suites.

## Structure

- `helpers/` – shared utilities such as the env controller, Tenderly runner, process harness, git fixtures, and assertion helpers.
- `fixtures/` – deterministic data used by the harness (e.g., `.operate-test`, git templates).
- `unit/` – pure Vitest specs with no global setup.
- `integration/` – boundary tests that exercise modules end-to-end with mocked infrastructure.
- `system/` – scenario files that spin up the real worker stack via the process harness.

As the new harness stabilizes we'll migrate suites from `tests/` into this tree and eventually retire the legacy setup.
