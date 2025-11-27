/**
 * SystemBlueprintProvider - Provides static system assertions
 *
 * This provider loads the system-blueprint.json file which contains
 * the core protocol assertions that replace GEMINI.md.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  AssertionProvider,
  BuildContext,
  BlueprintContext,
  BlueprintBuilderConfig,
  BlueprintAssertion,
} from '../../types.js';

// Load system blueprint once at module initialization
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface SystemBlueprintJson {
  assertions: BlueprintAssertion[];
}

let cachedSystemBlueprint: SystemBlueprintJson | null = null;

/**
 * Find the system blueprint JSON file
 * Tries multiple paths to be resilient to build output changes
 */
function findSystemBlueprintPath(): string {
  const possiblePaths = [
    // Relative to this file (compiled output)
    join(__dirname, '../../system-blueprint.json'),
    // Relative to worker/prompt directory
    join(__dirname, '../../../worker/prompt/system-blueprint.json'),
    // From process.cwd()
    join(process.cwd(), 'worker/prompt/system-blueprint.json'),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  throw new Error(
    `Could not find system-blueprint.json. Tried paths: ${possiblePaths.join(', ')}`
  );
}

/**
 * Load the system blueprint JSON file
 */
function loadSystemBlueprint(): SystemBlueprintJson {
  if (cachedSystemBlueprint) {
    return cachedSystemBlueprint;
  }

  const blueprintPath = findSystemBlueprintPath();
  const content = readFileSync(blueprintPath, 'utf8');
  cachedSystemBlueprint = JSON.parse(content);
  return cachedSystemBlueprint!;
}

/**
 * SystemBlueprintProvider loads static system assertions from system-blueprint.json
 */
export class SystemBlueprintProvider implements AssertionProvider {
  name = 'system-blueprint';
  category = 'system' as const;

  enabled(config: BlueprintBuilderConfig): boolean {
    return config.enableSystemBlueprint;
  }

  async provide(
    ctx: BuildContext,
    _builtContext: BlueprintContext
  ): Promise<BlueprintAssertion[]> {
    const blueprint = loadSystemBlueprint();

    let assertions = blueprint.assertions.map((assertion) => ({
      ...assertion,
      category: 'system' as const,
    }));

    // If this is an artifact-only job (no code metadata), exclude coding-specific system assertions
    // that mandate git workflows (branches, commits, process_branch)
    if (!ctx.metadata.codeMetadata) {
      const CODING_ASSERTIONS = ['SYS-GIT-001', 'SYS-PARENT-ROLE-001'];
      assertions = assertions.filter((a) => !CODING_ASSERTIONS.includes(a.id));
    }

    return assertions;
  }
}

/**
 * Clear the cached system blueprint (for testing)
 * @internal
 */
export function _clearSystemBlueprintCache(): void {
  cachedSystemBlueprint = null;
}
