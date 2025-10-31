# db7 — Keep ephemeral secret fixtures out of tracked repos

## ✅ Canonical pattern

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function createTestOperateDir(): string {
  const prefix = join(tmpdir(), 'jinn-operate-test-');
  const operateDir = mkdtempSync(prefix);

  // populate operateDir/services/... and operateDir/keys/... here

  return operateDir;
}
```

- Directory lives under the OS temp directory instead of the repository
- Tests pass the absolute path via `OPERATE_HOME`, so git never sees the files

## ❌ Violation

```ts
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function createTestOperateDir(): string {
  const operateDir = join(process.cwd(), '.operate-test');
  mkdirSync(operateDir, { recursive: true });
  return operateDir;
}
```

- Secrets end up inside the git worktree where `git add --all` can stage them
- Breaks the default behavior by relying on `process.cwd()` instead of the shared temp workspace
