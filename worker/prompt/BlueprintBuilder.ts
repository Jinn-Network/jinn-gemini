/**
 * BlueprintBuilder - Centralized Prompt Building System
 *
 * This class replaces the fragmented GEMINI.md-based prompt building with a
 * unified, provider-based system that outputs a homomorphic blueprint.
 *
 * Two-phase execution:
 * 1. Context providers run first, building the BlueprintContext
 * 2. Assertion providers run second, with access to the built context
 */

import { workerLogger } from '../../logging/index.js';
import { serializeError } from '../logging/errors.js';
import { DEFAULT_BLUEPRINT_CONFIG } from './config.js';
import type {
  BlueprintBuilderConfig,
  BlueprintContext,
  BlueprintAssertion,
  UnifiedBlueprint,
  BuildContext,
  ContextProvider,
  AssertionProvider,
  BlueprintBuildResult,
} from './types.js';
import type { IpfsMetadata } from '../types.js';
import type { RecognitionPhaseResult } from '../recognition_helpers.js';

// Context providers
import { JobContextProvider } from './providers/context/JobContextProvider.js';
import { ProgressCheckpointProvider } from './providers/context/ProgressCheckpointProvider.js';

// Assertion providers
import { SystemBlueprintProvider } from './providers/assertions/SystemBlueprintProvider.js';
import { DelegationDirectiveProvider } from './providers/assertions/DelegationDirectiveProvider.js';
import { JobBlueprintProvider } from './providers/assertions/JobBlueprintProvider.js';
import { RecognitionProvider } from './providers/assertions/RecognitionProvider.js';
import { ChildWorkAssertionProvider } from './providers/assertions/ChildWorkAssertionProvider.js';
import { ProgressAssertionProvider } from './providers/assertions/ProgressAssertionProvider.js';
import { ArtifactAssertionProvider } from './providers/assertions/ArtifactAssertionProvider.js';
import { VerificationDirectiveProvider } from './providers/assertions/VerificationDirectiveProvider.js';
import { MergeConflictAssertionProvider } from './providers/assertions/MergeConflictAssertionProvider.js';

/**
 * BlueprintBuilder constructs unified blueprints from multiple providers
 */
export class BlueprintBuilder {
  private contextProviders: ContextProvider[] = [];
  private assertionProviders: AssertionProvider[] = [];
  private config: BlueprintBuilderConfig;

  constructor(config?: Partial<BlueprintBuilderConfig>) {
    this.config = { ...DEFAULT_BLUEPRINT_CONFIG, ...config };
  }

  /**
   * Register a context provider (Phase 1)
   */
  registerContextProvider(provider: ContextProvider): this {
    this.contextProviders.push(provider);
    return this;
  }

  /**
   * Register an assertion provider (Phase 2)
   */
  registerAssertionProvider(provider: AssertionProvider): this {
    this.assertionProviders.push(provider);
    return this;
  }

  /**
   * Build a unified blueprint for the given request
   *
   * @param requestId - The request ID
   * @param metadata - IPFS metadata for the job
   * @param recognition - Recognition phase result (optional)
   * @returns The built blueprint with timing info
   */
  async build(
    requestId: string,
    metadata: IpfsMetadata,
    recognition?: RecognitionPhaseResult | null
  ): Promise<BlueprintBuildResult> {
    const startTime = Date.now();
    const providers: string[] = [];

    // Create the build context
    const buildContext: BuildContext = {
      requestId,
      metadata,
      recognition,
      config: this.config,
    };

    // Phase 1: Build context from context providers
    const context: BlueprintContext = {};
    for (const provider of this.contextProviders) {
      if (!provider.enabled(this.config)) {
        if (this.config.logProviders) {
          workerLogger.debug({ provider: provider.name }, 'Context provider disabled, skipping');
        }
        continue;
      }

      try {
        const providerContext = await provider.provide(buildContext);
        if (providerContext && Object.keys(providerContext).length > 0) {
          Object.assign(context, providerContext);
          providers.push(provider.name);

          if (this.config.logProviders) {
            workerLogger.debug(
              { provider: provider.name, keys: Object.keys(providerContext) },
              'Context provider contributed'
            );
          }
        }
      } catch (error) {
        workerLogger.warn(
          {
            provider: provider.name,
            error: serializeError(error),
          },
          'Context provider failed, skipping'
        );
      }
    }

    // Log hierarchy status for verification (plan step 5)
    if (context.hierarchy?.children && context.hierarchy.children.length > 0) {
      const completedChildren = context.hierarchy.children.filter(c => c.status === 'COMPLETED');
      workerLogger.info(
        {
          totalChildren: context.hierarchy.children.length,
          completedChildren: completedChildren.length,
          completedIds: completedChildren.map(c => ({ id: c.requestId.slice(0, 8), name: c.jobName }))
        },
        'Hierarchy status verification: completed children detected'
      );
    }

    // Phase 2: Build assertions from assertion providers (with access to context)
    const assertions: BlueprintAssertion[] = [];
    for (const provider of this.assertionProviders) {
      if (!provider.enabled(this.config)) {
        if (this.config.logProviders) {
          workerLogger.debug({ provider: provider.name }, 'Assertion provider disabled, skipping');
        }
        continue;
      }

      try {
        const providerAssertions = await provider.provide(buildContext, context);
        if (providerAssertions && providerAssertions.length > 0) {
          assertions.push(...providerAssertions);
          providers.push(provider.name);

          if (this.config.logProviders) {
            workerLogger.debug(
              { provider: provider.name, count: providerAssertions.length },
              'Assertion provider contributed'
            );
          }

          // Log CTX assertions from ChildWorkAssertionProvider (plan step 6)
          if (provider.name === 'child-work-assertions') {
            const ctxAssertions = providerAssertions.filter(a => a.id.startsWith('CTX-CHILD-'));
            if (ctxAssertions.length > 0) {
              workerLogger.info(
                {
                  ctxAssertionCount: ctxAssertions.length,
                  assertionIds: ctxAssertions.map(a => a.id)
                },
                'CTX-CHILD assertions generated for completed children'
              );
            }
          }
        }
      } catch (error) {
        workerLogger.warn(
          {
            provider: provider.name,
            error: serializeError(error),
          },
          'Assertion provider failed, skipping'
        );
      }
    }

    // Assemble the unified blueprint
    const blueprint: UnifiedBlueprint = {
      assertions,
      context,
      metadata: {
        generatedAt: new Date().toISOString(),
        requestId,
        providers,
        // Expose workspace path for file operations (write_file needs absolute paths)
        workspacePath: process.env.JINN_WORKSPACE_DIR || process.env.CODE_METADATA_REPO_ROOT || undefined,
      },
    };

    const buildTime = Date.now() - startTime;

    if (this.config.logProviders) {
      workerLogger.info(
        {
          requestId,
          assertionCount: assertions.length,
          contextKeys: Object.keys(context),
          providerCount: providers.length,
          buildTime,
        },
        'Blueprint built'
      );
    }

    return { blueprint, buildTime };
  }

  /**
   * Build and serialize to a JSON string (for agent consumption)
   */
  async buildPrompt(
    requestId: string,
    metadata: IpfsMetadata,
    recognition?: RecognitionPhaseResult | null
  ): Promise<string> {
    const { blueprint } = await this.build(requestId, metadata, recognition);
    const promptString = JSON.stringify(blueprint, null, 2);
    
    // Verify assertions reach agent prompt (plan step 7)
    const ctxAssertions = blueprint.assertions.filter(a => a.id.startsWith('CTX-CHILD-'));
    if (ctxAssertions.length > 0) {
      workerLogger.info(
        {
          requestId,
          ctxAssertionCount: ctxAssertions.length,
          promptLength: promptString.length,
          sample: ctxAssertions[0]?.assertion.slice(0, 80)
        },
        'Blueprint prompt contains CTX-CHILD assertions for agent'
      );
    }
    
    return promptString;
  }

  /**
   * Get the current configuration
   */
  getConfig(): BlueprintBuilderConfig {
    return { ...this.config };
  }

  /**
   * Update the configuration
   */
  updateConfig(config: Partial<BlueprintBuilderConfig>): this {
    this.config = { ...this.config, ...config };
    return this;
  }
}

/**
 * Create a BlueprintBuilder with all default providers registered
 *
 * This is the main factory function for creating a fully-configured builder.
 * Import and call this to get a ready-to-use builder with all providers.
 *
 * Provider registration order matters:
 * - Context providers run first (Phase 1), building the BlueprintContext
 * - Assertion providers run second (Phase 2), with access to the built context
 *
 * Within each phase, providers run in registration order.
 */
export function createBlueprintBuilder(
  config?: Partial<BlueprintBuilderConfig>
): BlueprintBuilder {
  const builder = new BlueprintBuilder(config);

  // Phase 1: Context providers (build BlueprintContext)
  builder.registerContextProvider(new JobContextProvider());
  builder.registerContextProvider(new ProgressCheckpointProvider());

  // Phase 2: Assertion providers (have access to built context)
  // Order: system first, then job, then dynamic context-aware assertions
  builder.registerAssertionProvider(new SystemBlueprintProvider());
  builder.registerAssertionProvider(new DelegationDirectiveProvider()); // Inject early if high assertion count
  builder.registerAssertionProvider(new VerificationDirectiveProvider()); // Inject if verificationRequired
  builder.registerAssertionProvider(new MergeConflictAssertionProvider()); // Inject if merge conflicts exist
  builder.registerAssertionProvider(new JobBlueprintProvider());
  builder.registerAssertionProvider(new RecognitionProvider());
  builder.registerAssertionProvider(new ChildWorkAssertionProvider());
  builder.registerAssertionProvider(new ProgressAssertionProvider());
  builder.registerAssertionProvider(new ArtifactAssertionProvider());

  return builder;
}
