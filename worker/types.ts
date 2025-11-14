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
 * Unclaimed request from Ponder/on-chain
 */
export interface UnclaimedRequest {
  id: string;           // on-chain requestId (decimal string or 0x)
  mech: string;         // mech address (0x...)
  requester: string;    // requester address (0x...)
  blockTimestamp?: number;
  ipfsHash?: string;
  delivered?: boolean;
}

/**
 * Fetched IPFS metadata payload
 */
export interface IpfsMetadata {
  prompt?: string;
  enabledTools?: string[];
  sourceRequestId?: string;
  sourceJobDefinitionId?: string;
  additionalContext?: any;
  jobName?: string;
  jobDefinitionId?: string;
  codeMetadata?: CodeMetadata;
  model?: string;
  recognition?: RecognitionPhaseResult | null;
}

/**
 * Agent execution result
 */
export interface AgentExecutionResult {
  output: string;
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
