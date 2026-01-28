import { workerLogger } from '../../logging/index.js';
import {
  getOptionalGeminiApiKey,
  getOptionalGeminiQuotaBackoffMs,
  getOptionalGeminiQuotaCheckModel,
  getOptionalGeminiQuotaCheckTimeoutMs,
  getOptionalGeminiQuotaMaxBackoffMs,
} from '../../config/index.js';
import { serializeError } from '../logging/errors.js';
import { DEFAULT_WORKER_MODEL, normalizeGeminiModel } from '../../shared/gemini-models.js';

type QuotaCheckOptions = {
  model?: string;
  timeoutMs?: number;
};

type QuotaCheckResult = {
  ok: boolean;
  checked: boolean;
  isQuotaError: boolean;
  status?: number;
  detail?: string;
  retryAfterMs?: number;
};

type QuotaWaitOptions = {
  reason?: string;
  requestId?: string;
  jobName?: string;
  model?: string;
};

const DEFAULT_MODEL = DEFAULT_WORKER_MODEL;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_BACKOFF_MS = 60_000;
const DEFAULT_MAX_BACKOFF_MS = 10 * 60_000;

let loggedMissingKey = false;
let loggedNonQuotaFailure = false;

function normalizeModel(model: string): string {
  const trimmed = model.trim();
  return trimmed.startsWith('models/') ? trimmed.slice('models/'.length) : trimmed;
}

function resolveModel(preferred?: string): string {
  const configuredModel = getOptionalGeminiQuotaCheckModel();
  if (configuredModel && configuredModel.trim().length > 0) {
    return normalizeModel(configuredModel);
  }
  if (preferred && preferred.startsWith('gemini-')) {
    return normalizeModel(preferred);
  }
  return DEFAULT_MODEL;
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.floor(seconds * 1000));
  }
  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }
  return undefined;
}

function computeBackoffMs(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  const jitter = Math.floor(exponential * 0.2 * Math.random());
  return Math.min(maxMs, exponential + jitter);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function isQuotaText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('resource_exhausted') ||
    lower.includes('terminalquotaerror') ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('limit reached') ||
    lower.includes('insufficient_quota') ||
    lower.includes('429')
  );
}

export function isGeminiQuotaError(error: unknown): boolean {
  if (!error) return false;
  const parts: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      parts.push(value);
    }
  };

  if (typeof error === 'string') {
    push(error);
  } else if (error instanceof Error) {
    push(error.message);
    push((error as any).stderr);
  }

  if (typeof error === 'object' && error !== null) {
    const err = error as any;
    push(err.message);
    push(err.stderr);
    push(err.error?.message);
    push(err.error?.stderr);
    push(err.telemetry?.errorMessage);
    push(err.telemetry?.raw?.stderrWarnings);
    push(err.telemetry?.raw?.stderr);
    push(err.telemetry?.raw?.error);
  }

  if (parts.length === 0) return false;
  return isQuotaText(parts.join('\n'));
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function checkGeminiQuota(
  options: QuotaCheckOptions = {}
): Promise<QuotaCheckResult> {
  const apiKey = getOptionalGeminiApiKey() || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      ok: true,
      checked: false,
      isQuotaError: false,
      detail: 'GEMINI_API_KEY not set',
    };
  }

  const model = normalizeGeminiModel(resolveModel(options.model), DEFAULT_WORKER_MODEL).normalized;
  const timeoutMs = options.timeoutMs ?? getOptionalGeminiQuotaCheckTimeoutMs() ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: 'ping' }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 1,
          temperature: 0,
        },
      }),
      signal: controller.signal,
    });

    if (response.ok) {
      return {
        ok: true,
        checked: true,
        isQuotaError: false,
        status: response.status,
      };
    }

    const text = await response.text();
    const isQuotaError = isQuotaText(text) || response.status === 429;
    return {
      ok: !isQuotaError,
      checked: true,
      isQuotaError,
      status: response.status,
      detail: text ? truncate(text, 240) : undefined,
      retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
    };
  } catch (error: any) {
    const isQuotaError = isGeminiQuotaError(error);
    return {
      ok: !isQuotaError,
      checked: true,
      isQuotaError,
      detail: truncate(serializeError(error), 240),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function waitForGeminiQuota(options: QuotaWaitOptions = {}): Promise<void> {
  const baseBackoffMs = getOptionalGeminiQuotaBackoffMs() ?? DEFAULT_BACKOFF_MS;
  const maxBackoffMs = getOptionalGeminiQuotaMaxBackoffMs() ?? DEFAULT_MAX_BACKOFF_MS;
  const model = resolveModel(options.model);

  let attempt = 0;
  for (;;) {
    const result = await checkGeminiQuota({ model });
    if (!result.checked) {
      if (!loggedMissingKey) {
        loggedMissingKey = true;
        workerLogger.info({ model }, 'Skipping Gemini quota check (GEMINI_API_KEY not set)');
      }
      return;
    }

    if (result.ok) {
      if (result.detail && !loggedNonQuotaFailure) {
        loggedNonQuotaFailure = true;
        workerLogger.warn({ model, detail: result.detail }, 'Gemini quota check failed; continuing without wait');
      }
      return;
    }

    const waitMs = result.retryAfterMs && result.retryAfterMs > 0
      ? Math.min(maxBackoffMs, result.retryAfterMs)
      : computeBackoffMs(attempt, baseBackoffMs, maxBackoffMs);

    workerLogger.warn({
      reason: options.reason,
      requestId: options.requestId,
      jobName: options.jobName,
      model,
      attempt: attempt + 1,
      waitMs,
      status: result.status,
      detail: result.detail,
    }, 'Gemini quota exhausted; waiting before retry');

    await sleep(waitMs);
    attempt += 1;
  }
}
