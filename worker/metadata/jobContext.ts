/**
 * Job context management: setting and clearing JINN_* environment variables
 */

/**
 * Set job context environment variables
 */
export function setJobContext(params: {
  requestId?: string;
  jobDefinitionId?: string | null;
  baseBranch?: string;
  mechAddress?: string;
  workstreamId?: string;
}): void {
  const { requestId, jobDefinitionId, baseBranch, mechAddress, workstreamId } = params;
  
  if (requestId) {
    process.env.JINN_REQUEST_ID = requestId;
  }
  
  if (jobDefinitionId) {
    process.env.JINN_JOB_DEFINITION_ID = jobDefinitionId;
  }
  
  if (baseBranch) {
    process.env.JINN_BASE_BRANCH = baseBranch;
  }
  
  if (mechAddress) {
    process.env.JINN_MECH_ADDRESS = mechAddress;
  }
  
  if (workstreamId) {
    process.env.JINN_WORKSTREAM_ID = workstreamId;
  }
}

/**
 * Clear job context environment variables
 */
export function clearJobContext(): void {
  delete process.env.JINN_REQUEST_ID;
  delete process.env.JINN_JOB_DEFINITION_ID;
  delete process.env.JINN_BASE_BRANCH;
  delete process.env.JINN_MECH_ADDRESS;
  delete process.env.JINN_WORKSTREAM_ID;
}

/**
 * Snapshot current job context
 */
export function snapshotJobContext(): {
  requestId?: string;
  jobDefinitionId?: string;
  baseBranch?: string;
  mechAddress?: string;
  workstreamId?: string;
} {
  return {
    requestId: process.env.JINN_REQUEST_ID,
    jobDefinitionId: process.env.JINN_JOB_DEFINITION_ID,
    baseBranch: process.env.JINN_BASE_BRANCH,
    mechAddress: process.env.JINN_MECH_ADDRESS,
    workstreamId: process.env.JINN_WORKSTREAM_ID,
  };
}

/**
 * Restore job context from snapshot
 */
export function restoreJobContext(snapshot: {
  requestId?: string;
  jobDefinitionId?: string;
  baseBranch?: string;
  mechAddress?: string;
  workstreamId?: string;
}): void {
  clearJobContext();
  setJobContext(snapshot);
}

