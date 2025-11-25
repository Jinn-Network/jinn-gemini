const UNIVERSAL_ENABLED_TOOLS = ['get_details', 'search_artifacts'];

function normalizeTools(tools?: string[] | null): string[] {
  if (!Array.isArray(tools)) {
    return [];
  }
  return tools
    .filter((tool): tool is string => typeof tool === 'string' && tool.trim().length > 0);
}

export function ensureUniversalTools(tools?: string[] | null): string[] {
  const merged = [...normalizeTools(tools), ...UNIVERSAL_ENABLED_TOOLS];
  return Array.from(new Set(merged));
}

export function getUniversalTools(): string[] {
  return [...UNIVERSAL_ENABLED_TOOLS];
}


