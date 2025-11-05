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
}): void {
  const { requestId, jobDefinitionId, baseBranch, mechAddress } = params;
  
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
}

/**
 * Clear job context environment variables
 */
export function clearJobContext(): void {
  delete process.env.JINN_REQUEST_ID;
  delete process.env.JINN_JOB_DEFINITION_ID;
  delete process.env.JINN_BASE_BRANCH;
  delete process.env.JINN_MECH_ADDRESS;
}

/**
 * Snapshot current job context
 */
export function snapshotJobContext(): {
  requestId?: string;
  jobDefinitionId?: string;
  baseBranch?: string;
  mechAddress?: string;
} {
  return {
    requestId: process.env.JINN_REQUEST_ID,
    jobDefinitionId: process.env.JINN_JOB_DEFINITION_ID,
    baseBranch: process.env.JINN_BASE_BRANCH,
    mechAddress: process.env.JINN_MECH_ADDRESS,
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
}): void {
  clearJobContext();
  setJobContext(snapshot);
}

