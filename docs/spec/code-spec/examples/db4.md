# Default Behavior: No silent catch

## Follows the default behavior

```ts
import { workerLogger, serializeError } from '../../logging/index';

export async function persistArtifact(requestId: string, artifact: PersistedArtifact): Promise<void> {
  try {
    await apiCreateArtifact(requestId, artifact);
  } catch (error) {
    workerLogger.warn(
      {
        requestId,
        cid: artifact.cid,
        topic: artifact.topic,
        error: serializeError(error),
      },
      'Failed to persist artifact (optional flow)',
    );
  }
}
```

**Why this follows the behavior:** The catch logs the failure with structured context, making the best-effort nature of the operation visible while allowing execution to continue.

---

## Violates the default behavior

```ts
export async function persistArtifact(requestId: string, artifact: PersistedArtifact): Promise<void> {
  try {
    await apiCreateArtifact(requestId, artifact);
  } catch {}
}
```

**Why this violates the behavior:** The empty catch swallows the error entirely, offering no signal that the artifact write failed.


