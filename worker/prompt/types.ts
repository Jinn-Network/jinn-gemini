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
// Invariant Types
// =============================================================================

/**
 * An invariant - a property that should hold
 * 
 * Minimal schema: id + invariant statement, with optional measurement and examples.
 * Layer (ACTION/JOB/PROTOCOL) is derived from ID prefix in BlueprintBuilder.
 */
export interface Invariant {
  /** Unique identifier (e.g., "SYS-001", "JOB-001", "COORD-001") */
  id: string;

  /** The invariant statement itself - what must hold */
  invariant: string;

  /** Natural language guidance on how to measure/verify this invariant */
  measurement?: string;

  /** Examples of correct and incorrect application */
  examples?: {
    do: string[];
    dont: string[];
  };
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
  /** Whether the child's work is already integrated into parent (commits merged or rejected) */
  isIntegrated?: boolean;
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
}

/**
 * The unified blueprint sent to the agent
 *
 * This is the final output of the BlueprintBuilder - a single JSON structure
 * containing all invariants and reference data (context).
 */
export interface UnifiedBlueprint {
  /** Invariants - properties that should hold (homomorphic format) */
  invariants: Invariant[];

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

  /** Enable beads issue tracking assertions for coding jobs */
  enableBeadsAssertions: boolean;

  /** Master switch for Recognition, Reflection, Progress phases */
  enableContextPhases: boolean;

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
 * Invariant provider interface (Phase 2)
 *
 * Invariant providers run second and have access to the built context.
 * They generate invariants - properties that should hold.
 * Layer ordering is derived from ID prefix in BlueprintBuilder.
 */
export interface InvariantProvider {
  /** Provider name for logging/debugging */
  name: string;

  /** Check if this provider is enabled */
  enabled: (config: BlueprintBuilderConfig) => boolean;

  /** Provide invariants (with access to built context) */
  provide: (
    ctx: BuildContext,
    builtContext: BlueprintContext
  ) => Promise<Invariant[]>;
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
