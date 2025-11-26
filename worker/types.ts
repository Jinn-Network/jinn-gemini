/**
 * Shared types for worker modules
 * 
 * These types are used across orchestration, git, metadata, execution, and other worker subsystems.
 */

import type { CodeMetadata } from '../gemini-agent/shared/code_metadata.js';
import type { RecognitionPhaseResult } from './recognition_helpers.js';

/**
 * Final status inferred from execution telemetry and child job states
 */
export interface FinalStatus {
  status: 'COMPLETED' | 'DELEGATING' | 'WAITING' | 'FAILED';
  message: string;
}

/**
 * Execution summary extracted from agent output
 */
export interface ExecutionSummaryDetails {
  heading: string;
  lines: string[];
  text: string;
}

/**
 * Job in the hierarchy (from additionalContext.hierarchy array)
 */
export interface HierarchyJob {
  id?: string;
  requestId?: string;
  name?: string;
  jobName?: string;
  level?: number;
  status?: 'completed' | 'active' | 'failed' | 'delivered' | 'success' | 'error';
  jobId?: string;
  sourceJobDefinitionId?: string;
  summary?: string;
  deliverySummary?: string;
  /** Branch name where this child job worked (for parent review) */
  branchName?: string;
  /** Base branch the child branched from */
  baseBranch?: string;
  artifactRefs?: Array<{
    name?: string;
    topic?: string;
    cid: string;
    id?: string;
    type?: string;
    /** For GIT_BRANCH artifacts, contains headBranch/baseBranch */
    details?: {
      headBranch?: string;
      baseBranch?: string;
      diffSummary?: string;
    };
  }>;
  requestIds?: string[];
}

/**
 * Aggregated summary of job hierarchy
 */
export interface HierarchySummary {
  totalJobs: number;
  completedJobs: number;
  activeJobs: number;
  totalArtifacts?: number;
  hasErrors?: boolean;
}

/**
 * Work Protocol message structure
 */
export interface WorkProtocolMessage {
  content: string;
  to?: string;
  from?: string;
}

/**
 * Completed child run tracking for deterministic context
 */
export interface CompletedChildRun {
  artifacts?: Array<{
    cid?: string;
    id?: string;
  }>;
}

/**
 * Additional context structure attached to IPFS metadata
 * Contains job hierarchy, messages, and legacy compatibility fields
 */
export interface AdditionalContext {
  /** Work Protocol messaging */
  message?: WorkProtocolMessage | string;

  /** Job hierarchy information */
  hierarchy?: HierarchyJob[];

  /** Aggregated summary of job hierarchy */
  summary?: HierarchySummary;

  /** Backward compatibility: blueprint stored in additionalContext (prefer root-level) */
  blueprint?: string;

  /** Backward compatibility: dependencies stored here (prefer root-level) */
  dependencies?: string[];

  /** Additional context from parent jobs */
  objective?: string;
  acceptanceCriteria?: string;

  /** Completed child run tracking */
  completedChildRuns?: CompletedChildRun[];
}

/**
 * Unclaimed request from Ponder/on-chain
 */
export interface UnclaimedRequest {
  id: string;           // on-chain requestId (decimal string or 0x)
  mech: string;         // mech address (0x...)
  requester: string;    // requester address (0x...)
  blockTimestamp?: number;
  ipfsHash?: string;
  delivered?: boolean;
  dependencies?: string[];  // request IDs that must be delivered first
}

/**
 * Fetched IPFS metadata payload
 * Note: blueprint is now the primary job specification (replaces legacy "prompt" field)
 */
export interface IpfsMetadata {
  blueprint?: string;  // Primary job specification
  enabledTools?: string[];
  sourceRequestId?: string;
  sourceJobDefinitionId?: string;
  workstreamId?: string;  // ID of the root job in the hierarchy
  additionalContext?: AdditionalContext;
  lineage?: {
    dispatcherRequestId?: string;
    dispatcherJobDefinitionId?: string;
    parentDispatcherRequestId?: string;
    dispatcherBranchName?: string;
    dispatcherBaseBranch?: string;
  };
  jobName?: string;
  jobDefinitionId?: string;
  codeMetadata?: CodeMetadata;
  model?: string;
  recognition?: RecognitionPhaseResult | null;
  dependencies?: string[];  // Request IDs that must complete first
}

/**
 * Agent execution result
 */
export interface AgentExecutionResult {
  output: string;
  structuredSummary?: string;
  telemetry: any;
  delegated?: boolean;
  artifacts?: Array<{
    cid: string;
    topic: string;
    name?: string;
    type?: string;
    contentPreview?: string;
  }>;
  pullRequestUrl?: string;
}

/**
 * Transaction execution result (for EOA/Safe executors)
 */
export interface ExecutionResult {
  success: boolean;
  txHash?: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Git repository context
 */
export interface RepoContext {
  repoRoot: string;
  remoteUrl?: string;
  branchName?: string;
  baseBranch?: string;
}

/**
 * Git operation result
 */
export interface GitOperationResult {
  success: boolean;
  error?: string;
  branchCreated?: boolean;
  commitMade?: boolean;
  prUrl?: string | null;
}

/**
 * Job metadata combined with execution context
 */
export interface JobContext {
  requestId: string;
  request: UnclaimedRequest;
  metadata: IpfsMetadata;
  workerAddress: string;
}

/**
 * Delivery context for on-chain delivery
 */
export interface DeliveryContext {
  requestId: string;
  result: AgentExecutionResult;
  finalStatus: FinalStatus;
  metadata: IpfsMetadata;
  recognition?: RecognitionPhaseResult | null;
  reflection?: any;
  error?: any;
}

/**
 * Parent dispatch decision
 */
export interface ParentDispatchDecision {
  shouldDispatch: boolean;
  parentJobDefId?: string;
  reason?: string;
}

/**
 * Recognition result (re-exported from recognition_helpers)
 */
export type { RecognitionPhaseResult } from './recognition_helpers.js';
  
/**
 * Reflection result
 */
export interface ReflectionResult {
  output: string;
  telemetry: any;
  artifacts?: Array<{
    cid: string;
    topic: string;
  }>;
}

/**
 * Child job status from Ponder
 */
export interface ChildJobStatus {
  id: string;
  delivered: boolean;
}
