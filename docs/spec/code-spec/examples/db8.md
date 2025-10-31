# db8 — Validate staged content before auto-commit

## ✅ Canonical helper

```ts
import { gitGuard } from '../git/guard.js';

export async function finalizeBranch(message: string) {
  await git.add({ all: true });
  await gitGuard.ensureSafeStagedTree();
  await git.commit({ message });
}
```

- Guard runs after staging but before `git commit`, so blocked files never reach history.
- Any violation throws with a descriptive error that halts the workflow.

## ❌ Violation

```ts
export async function finalizeBranch(message: string) {
  await git.add({ all: true });
  await git.commit({ message });
}
```

- No staged-tree validation; whatever was added (including secrets) is committed.
- Breaks db8 by bypassing the guard after staging changes.
