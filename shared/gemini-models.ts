/**
 * Utilities for normalizing Gemini model names across dispatch and execution.
 *
 * Context:
 * - Gemini 3 models are exposed as preview variants (e.g., gemini-3-pro-preview).
 * - Some callers (or legacy jobs) may specify non-preview names like gemini-3-pro,
 *   which can produce 404 errors from the Gemini API / Gemini CLI.
 */

export const DEFAULT_WORKER_MODEL = 'auto-gemini-3';

const MODELS_PREFIX = 'models/';

/**
 * Map legacy / commonly-mistyped model names to the currently valid equivalents.
 * Keep this intentionally small and explicit.
 */
const LEGACY_MODEL_ALIASES: Record<string, string> = {
  'gemini-3-pro': 'gemini-3-pro-preview',
  'gemini-3-pro-latest': 'gemini-3-pro-preview',
  'gemini-3-flash': 'gemini-3-flash-preview',
  'gemini-3-flash-latest': 'gemini-3-flash-preview',
};

export type GeminiModelNormalization = {
  requested: string;
  normalized: string;
  changed: boolean;
  reason?: string;
};

function stripModelsPrefix(model: string): string {
  return model.startsWith(MODELS_PREFIX) ? model.slice(MODELS_PREFIX.length) : model;
}

/**
 * Normalize a Gemini model name for Gemini CLI usage.
 *
 * This:
 * - trims whitespace
 * - removes a leading "models/" prefix if present
 * - upgrades known Gemini 3 legacy names to their preview equivalents
 * - falls back to a safe default when the input is empty
 */
export function normalizeGeminiModel(
  model: string | null | undefined,
  defaultModel: string = DEFAULT_WORKER_MODEL,
): GeminiModelNormalization {
  const requestedRaw = (model ?? '').trim();
  const requested = requestedRaw.length > 0 ? requestedRaw : defaultModel;
  const stripped = stripModelsPrefix(requested);
  const aliasTarget = LEGACY_MODEL_ALIASES[stripped];

  if (aliasTarget) {
    return {
      requested,
      normalized: aliasTarget,
      changed: aliasTarget !== requested,
      reason: `legacy_alias:${stripped}`,
    };
  }

  if (stripped !== requested) {
    return {
      requested,
      normalized: stripped,
      changed: true,
      reason: 'strip_models_prefix',
    };
  }

  return {
    requested,
    normalized: stripped,
    changed: false,
  };
}

