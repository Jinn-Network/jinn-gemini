# Default Behavior: Canonical HTTP client with timeout & retry

## Follows the default behavior

```ts
import { postJson } from '../../http/client';

type ClaimResponse = {
  data: {
    claimRequest: {
      request_id: string;
      status: string;
    };
  };
};

export async function claimRequest(requestId: string): Promise<ClaimResponse> {
  return postJson<ClaimResponse>('https://control.api/graphql', {
    query: `mutation Claim($requestId: String!) { claimRequest(requestId: $requestId) { request_id status } }`,
    variables: { requestId },
  }, {
    timeoutMs: 10000,
    retries: 3,
    headers: {
      'Content-Type': 'application/json',
      'X-Worker-Address': currentWorkerAddress(),
    },
    requestId,
  });
}
```

**Why this follows the behavior:** The call goes through the shared `postJson` helper, so timeouts, retries, logging, and error normalization are handled in one place. The caller only supplies request-specific data.

---

## Violates the default behavior

```ts
export async function claimRequest(requestId: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch('https://control.api/graphql', {
      method: 'POST',
      body: JSON.stringify({
        query: `mutation Claim($requestId: String!) { claimRequest(requestId: $requestId) { request_id status } }`,
        variables: { requestId },
      }),
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Address': currentWorkerAddress(),
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Control API failed: ${res.status}`);
    }

    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}
```

**Why this violates the behavior:** The function calls `fetch` directly and re-implements timeout logic inline. There is no shared retry/backoff, no structured logging, and any future tweaks would need to be duplicated everywhere.


