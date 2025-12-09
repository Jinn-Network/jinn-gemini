/**
 * Centralized Prompt Building System
 *
 * This module exports the unified blueprint building system that replaces
 * the fragmented GEMINI.md-based prompt construction.
 *
 * Usage:
 *   import { createBlueprintBuilder } from './worker/prompt';
 *   const builder = createBlueprintBuilder();
 *   const prompt = await builder.buildPrompt(requestId, metadata, recognition);
 */

// Core types
export type {
  AssertionCategory,
  BlueprintAssertion,
  BlueprintContext,
  HierarchyContext,
  ProgressContext,
  ArtifactInfo,
  ChildJobInfo,
  UnifiedBlueprint,
  BlueprintMetadata,
  BlueprintBuilderConfig,
  BuildContext,
  ContextProvider,
  AssertionProvider,
  BlueprintBuildResult,
} from './types.js';

// Configuration
export { DEFAULT_BLUEPRINT_CONFIG, createConfigFromEnv } from './config.js';

// Builder
export { BlueprintBuilder, createBlueprintBuilder } from './BlueprintBuilder.js';

// Context providers
export { JobContextProvider } from './providers/context/JobContextProvider.js';
export { ProgressCheckpointProvider } from './providers/context/ProgressCheckpointProvider.js';

// Assertion providers
export { SystemBlueprintProvider } from './providers/assertions/SystemBlueprintProvider.js';
export { JobBlueprintProvider } from './providers/assertions/JobBlueprintProvider.js';
export { RecognitionProvider } from './providers/assertions/RecognitionProvider.js';
export { ChildWorkAssertionProvider } from './providers/assertions/ChildWorkAssertionProvider.js';
export { ProgressAssertionProvider } from './providers/assertions/ProgressAssertionProvider.js';
export { ArtifactAssertionProvider } from './providers/assertions/ArtifactAssertionProvider.js';
export { DelegationDirectiveProvider } from './providers/assertions/DelegationDirectiveProvider.js';
export { VerificationDirectiveProvider } from './providers/assertions/VerificationDirectiveProvider.js';
