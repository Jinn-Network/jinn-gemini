# Default Behavior: Structured logging only

## Follows the default behavior

```ts
import { logger } from '../../logging/index';
import { serializeError } from '../../worker/utils/serializeError';

const workerLogger = logger.child({ component: 'WORKER' });

export async function deliverSafeJob(jobId: string) {
  workerLogger.info({ jobId }, 'Preparing Safe delivery');
  try {
    const txHash = await submitDelivery(jobId);
    workerLogger.info({ jobId, txHash }, 'Safe delivery submitted');
    return txHash;
  } catch (error) {
    workerLogger.warn({ jobId, error: serializeError(error) }, 'Safe delivery failed');
    throw error;
  }
}
```

**Why this follows the behavior:** The function logs exclusively through the shared logger, uses structured metadata for every entry, and redacts error details with `serializeError`.

---

## Violates the default behavior

```ts
export async function deliverSafeJob(jobId: string) {
  console.log(`Preparing Safe delivery for job ${jobId}`);
  try {
    const txHash = await submitDelivery(jobId);
    console.log(`Safe delivery submitted: ${txHash}`);
    return txHash;
  } catch (error) {
    console.error('Safe delivery failed', error);
    throw error;
  }
}
```

**Why this violates the behavior:** Logs go straight to `console.*`, omitting structured metadata, redaction, and the shared logger pipeline.


