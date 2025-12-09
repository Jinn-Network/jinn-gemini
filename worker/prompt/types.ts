/**
 * Centralized Prompt Building Types
 *
 * This module defines the core types for the homomorphic blueprint system
 * that replaces the fragmented GEMINI.md-based prompt building.
 */

import type { IpfsMetadata } from '../types.js';
import type { RecognitionPhaseResult } from '../recognition_helpers.js';

// Re-export AdditionalContext types for provider access
export type {
  HierarchyJob,
  HierarchySummary,
  WorkProtocolMessage,
  CompletedChildRun,
  AdditionalContext,
} from '../types.js';

// =============================================================================
// Assertion Types
// =============================================================================

/**
 * Categories for assertions (instructions only)
 * - system: Protocol, identity, behavioral rules (from system-blueprint.json)
 * - context: Dynamic assertions that embed specific context data
 * - recognition: Prescriptive learnings from similar jobs
 * - job: Work requirements from the job blueprint
 */
export type AssertionCategory = 'system' | 'context' | 'recognition' | 'job';

/**
 * A blueprint assertion - an instruction, rule, or requirement
 *
 * All assertions share this homomorphic structure, whether static (from
 * system-blueprint.json) or dynamic (generated from context data).
 */
export interface BlueprintAssertion {
  /** Unique identifier (e.g., "SYS-IDENTITY-001", "CTX-CHILD-001") */
  id: string;

  /** Source category */
  category: AssertionCategory;

  /** The requirement, principle, or instruction */
  assertion: string;

  /** Examples of correct and incorrect application */
  examples: {
    do: string[];
    dont: string[];
  };

  /** Human-readable context explaining the rationale */
  commentary: string;
}

// =============================================================================
// Context Types
// =============================================================================

/**
 * Child job information in the hierarchy
 */
export interface ChildJobInfo {
  requestId: string;
  jobName?: string;
  status: 'COMPLETED' | 'ACTIVE' | 'FAILED';
  summary?: string;
  /** Branch name where this child job worked (for parent review) */
  branchName?: string;
  /** Base branch the child branched from */
  baseBranch?: string;
}

/**
 * Job hierarchy context
 */
export interface HierarchyContext {
  totalJobs: number;
  completedJobs: number;
  activeJobs: number;
  children: ChildJobInfo[];
}

/**
 * Progress context from prior runs
 */
export interface ProgressContext {
  /** AI-generated summary of prior work */
  summary: string;
  /** Phases that have been completed */
  completedPhases?: string[];
}

/**
 * Artifact information
 */
export interface ArtifactInfo {
  name: string;
  cid: string;
  type?: string;
}

/**
 * Structured context - factual state information (not instructions)
 *
 * This data is available for reference; context-aware assertions
 * embed specific values from this structure into actionable instructions.
 */
export interface BlueprintContext {
  /** Job hierarchy information */
  hierarchy?: HierarchyContext;

  /** Progress from prior runs in this workstream */
  progress?: ProgressContext;

  /** Available artifacts with CIDs */
  artifacts?: ArtifactInfo[];
}

// =============================================================================
// Unified Blueprint
// =============================================================================

/**
 * Metadata about how the blueprint was built
 */
export interface BlueprintMetadata {
  /** When the blueprint was generated */
  generatedAt: string;

  /** The request ID this blueprint is for */
  requestId: string;

  /** Which providers contributed to this blueprint */
  providers: string[];

  /** Workspace path for file operations (write_file needs absolute paths) */
  workspacePath?: string;
}

/**
 * The unified blueprint sent to the agent
 *
 * This is the final output of the BlueprintBuilder - a single JSON structure
 * containing all instructions (assertions) and reference data (context).
 */
export interface UnifiedBlueprint {
  /** Instructions and requirements (homomorphic format) */
  assertions: BlueprintAssertion[];

  /** Factual state information (structured data) */
  context: BlueprintContext;

  /** Build metadata */
  metadata: BlueprintMetadata;
}

// =============================================================================
// Provider Types
// =============================================================================

/**
 * Configuration for the BlueprintBuilder
 */
export interface BlueprintBuilderConfig {
  // Assertion provider toggles
  /** Enable static system assertions from system-blueprint.json */
  enableSystemBlueprint: boolean;

  /** Enable dynamic context-aware assertions */
  enableContextAssertions: boolean;

  /** Enable prescriptive learnings from similar jobs */
  enableRecognitionLearnings: boolean;

  // Context provider toggles
  /** Enable job hierarchy context */
  enableJobContext: boolean;

  /** Enable progress checkpoint context */
  enableProgressCheckpoint: boolean;

  // Debugging
  /** Enable debug mode */
  debug: boolean;

  /** Log providers to console */
  logProviders: boolean;
}

/**
 * Context passed to providers during build
 */
export interface BuildContext {
  /** The request ID */
  requestId: string;

  /** IPFS metadata for this job */
  metadata: IpfsMetadata;

  /** Recognition phase result (if available) */
  recognition?: RecognitionPhaseResult | null;

  /** Builder configuration */
  config: BlueprintBuilderConfig;
}

/**
 * Context provider interface (Phase 1)
 *
 * Context providers run first and populate the BlueprintContext
 * with structured factual data.
 */
export interface ContextProvider {
  /** Provider name for logging/debugging */
  name: string;

  /** Check if this provider is enabled */
  enabled: (config: BlueprintBuilderConfig) => boolean;

  /** Provide context data */
  provide: (ctx: BuildContext) => Promise<Partial<BlueprintContext>>;
}

/**
 * Assertion provider interface (Phase 2)
 *
 * Assertion providers run second and have access to the built context.
 * They can generate static assertions or dynamic context-aware assertions.
 */
export interface AssertionProvider {
  /** Provider name for logging/debugging */
  name: string;

  /** The category of assertions this provider generates */
  category: AssertionCategory;

  /** Check if this provider is enabled */
  enabled: (config: BlueprintBuilderConfig) => boolean;

  /** Provide assertions (with access to built context) */
  provide: (
    ctx: BuildContext,
    builtContext: BlueprintContext
  ) => Promise<BlueprintAssertion[]>;
}

// =============================================================================
// Build Result
// =============================================================================

/**
 * Result of building a blueprint
 */
export interface BlueprintBuildResult {
  /** The unified blueprint */
  blueprint: UnifiedBlueprint;

  /** Time taken to build (ms) */
  buildTime: number;
}
