export type TemplateToolSpec = {
  name: string;
  required?: boolean;
};

export interface TemplateToolPolicy {
  requiredTools: string[];
  availableTools: string[];
}

function normalizeToolName(tool: unknown): string | null {
  if (typeof tool !== 'string') {
    return null;
  }
  const trimmed = tool.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function uniqueOrdered(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

export function parseAnnotatedTools(tools: unknown): TemplateToolPolicy {
  if (!Array.isArray(tools)) {
    return { requiredTools: [], availableTools: [] };
  }

  const requiredTools: string[] = [];
  const availableTools: string[] = [];

  for (const entry of tools) {
    if (typeof entry === 'string') {
      const name = normalizeToolName(entry);
      if (name) {
        availableTools.push(name);
      }
      continue;
    }

    if (entry && typeof entry === 'object') {
      const name = normalizeToolName((entry as TemplateToolSpec).name);
      if (name) {
        availableTools.push(name);
        if ((entry as TemplateToolSpec).required === true) {
          requiredTools.push(name);
        }
      }
    }
  }

  return {
    requiredTools: uniqueOrdered(requiredTools),
    availableTools: uniqueOrdered(availableTools),
  };
}

export function buildAnnotatedTools(policy: TemplateToolPolicy): TemplateToolSpec[] {
  const requiredSet = new Set(policy.requiredTools);
  return policy.availableTools.map((name) => ({
    name,
    ...(requiredSet.has(name) ? { required: true } : {}),
  }));
}

export function extractToolPolicyFromBlueprint(blueprint: any): TemplateToolPolicy {
  const templateMeta = blueprint?.templateMeta && typeof blueprint.templateMeta === 'object'
    ? blueprint.templateMeta
    : null;

  if (templateMeta?.tools) {
    return parseAnnotatedTools(templateMeta.tools);
  }

  if (blueprint?.tools) {
    return parseAnnotatedTools(blueprint.tools);
  }

  return { requiredTools: [], availableTools: [] };
}
