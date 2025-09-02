
let currentJobContext: { jobId: string; jobName: string; threadId: string | null } | null = null;

export function setJobContext(jobId: string, jobName: string, threadId: string | null) {
  currentJobContext = { jobId, jobName, threadId };
}

export function getJobContext() {
  return currentJobContext;
}

export function clearJobContext() {
  currentJobContext = null;
}


