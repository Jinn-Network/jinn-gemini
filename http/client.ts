import { logger } from '../logging/index.js';

const httpLogger = logger.child({ component: 'HTTP' });

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string,
    public context: Record<string, any>
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  maxRetries?: number;
  headers?: Record<string, string>;
  context?: Record<string, any>; // For structured logging (requestId, jobId, etc.)
}

/**
 * Core HTTP fetch with timeout and retry logic.
 *
 * @param url - The URL to fetch
 * @param init - Standard fetch RequestInit options
 * @param options - Additional options for timeout, retries, and logging context
 * @returns Response object
 * @throws HttpError on failure after all retries
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: FetchOptions = {}
): Promise<Response> {
  const {
    timeoutMs = 10000,
    maxRetries = 1,
    headers = {},
    context = {}
  } = options;

  const mergedHeaders = {
    ...init.headers,
    ...headers
  };

  let lastError: any;
  const startTime = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const attemptStart = Date.now();

    try {
      httpLogger.debug({
        url,
        method: init.method || 'GET',
        attempt: attempt + 1,
        maxAttempts: maxRetries + 1,
        ...context
      }, 'HTTP request attempt');

      const response = await fetch(url, {
        ...init,
        headers: mergedHeaders,
        signal: controller.signal
      } as any);

      clearTimeout(timeout);

      const duration = Date.now() - attemptStart;

      if (!response.ok) {
        const body = await response.text().catch(() => '');

        httpLogger.debug({
          url,
          method: init.method || 'GET',
          status: response.status,
          statusText: response.statusText,
          attempt: attempt + 1,
          duration,
          ...context
        }, 'HTTP request failed (non-2xx status)');

        // Don't retry on client errors (4xx), only server errors (5xx) and network issues
        if (response.status >= 400 && response.status < 500) {
          throw new HttpError(
            `HTTP ${response.status}: ${response.statusText}`,
            response.status,
            body,
            { url, method: init.method, ...context }
          );
        }

        lastError = new HttpError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          body,
          { url, method: init.method, ...context }
        );
      } else {
        httpLogger.info({
          url,
          method: init.method || 'GET',
          status: response.status,
          attempt: attempt + 1,
          duration,
          totalDuration: Date.now() - startTime,
          ...context
        }, 'HTTP request succeeded');

        return response;
      }
    } catch (err: any) {
      clearTimeout(timeout);

      const duration = Date.now() - attemptStart;

      // If it's already an HttpError from non-2xx response, re-throw immediately
      if (err instanceof HttpError && err.status >= 400 && err.status < 500) {
        throw err;
      }

      httpLogger.debug({
        url,
        method: init.method || 'GET',
        error: err?.message || String(err),
        attempt: attempt + 1,
        duration,
        ...context
      }, 'HTTP request failed (exception)');

      lastError = err;
    }

    // If we have retries left, wait with exponential backoff
    if (attempt < maxRetries) {
      const backoffMs = Math.pow(2, attempt) * 500;
      httpLogger.debug({
        url,
        backoffMs,
        nextAttempt: attempt + 2,
        ...context
      }, 'Retrying HTTP request after backoff');

      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }

  // All retries exhausted
  const totalDuration = Date.now() - startTime;

  httpLogger.error({
    url,
    method: init.method || 'GET',
    attempts: maxRetries + 1,
    totalDuration,
    error: lastError?.message || String(lastError),
    ...context
  }, 'HTTP request failed after all retries');

  if (lastError instanceof HttpError) {
    throw lastError;
  }

  throw new HttpError(
    `Request failed after ${maxRetries + 1} attempts: ${lastError?.message || String(lastError)}`,
    0,
    '',
    { url, method: init.method, attempts: maxRetries + 1, ...context }
  );
}

/**
 * POST JSON data and parse JSON response.
 *
 * @param url - The URL to POST to
 * @param body - JavaScript object to JSON.stringify
 * @param options - Fetch options
 * @returns Parsed JSON response
 */
export async function postJson<T>(
  url: string,
  body: any,
  options: FetchOptions = {}
): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  const response = await fetchWithRetry(url, {
    method: 'POST',
    body: JSON.stringify(body)
  }, {
    ...options,
    headers
  });

  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new HttpError(
      'Failed to parse JSON response',
      response.status,
      text,
      { url, parseError: err }
    );
  }
}

/**
 * GET JSON data and parse response.
 *
 * @param url - The URL to GET
 * @param options - Fetch options
 * @returns Parsed JSON response
 */
export async function getJson<T>(
  url: string,
  options: FetchOptions = {}
): Promise<T> {
  const response = await fetchWithRetry(url, {
    method: 'GET'
  }, options);

  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new HttpError(
      'Failed to parse JSON response',
      response.status,
      text,
      { url, parseError: err }
    );
  }
}

/**
 * Execute a GraphQL request with proper error handling.
 *
 * @param opts - GraphQL request options
 * @returns Parsed response data (the `data` field from GraphQL response)
 * @throws HttpError if request fails or GraphQL returns errors
 */
export async function graphQLRequest<T>(opts: {
  url: string;
  query: string;
  variables?: Record<string, any>;
  headers?: Record<string, string>;
  context?: Record<string, any>;
  timeoutMs?: number;
  maxRetries?: number;
}): Promise<T> {
  const response = await postJson<{ data?: T; errors?: Array<{ message: string }> }>(
    opts.url,
    {
      query: opts.query,
      variables: opts.variables || {}
    },
    {
      headers: opts.headers,
      context: opts.context,
      timeoutMs: opts.timeoutMs,
      maxRetries: opts.maxRetries
    }
  );

  // GraphQL can return 200 OK with errors in the response body
  if (response.errors && response.errors.length > 0) {
    const errorMessages = response.errors.map(e => e.message).join('; ');
    throw new HttpError(
      `GraphQL errors: ${errorMessages}`,
      200,
      JSON.stringify(response),
      { url: opts.url, graphqlErrors: response.errors, ...opts.context }
    );
  }

  if (!response.data) {
    throw new HttpError(
      'GraphQL response missing data field',
      200,
      JSON.stringify(response),
      { url: opts.url, ...opts.context }
    );
  }

  return response.data;
}
