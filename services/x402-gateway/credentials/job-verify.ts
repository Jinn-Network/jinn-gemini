/**
 * Job Claim Verification for Credential Bridge
 *
 * Verifies that credential requests are coming from agents actively
 * working on claimed jobs, preventing unauthorized direct access.
 *
 * Queries Control API to check:
 * 1. Request is claimed
 * 2. Claim is held by the requesting agent (X-Worker-Address match)
 * 3. Request is in-progress (not completed)
 */

const CONTROL_API_URL = process.env.CONTROL_API_URL || 'http://localhost:4001/graphql';

export interface JobVerifyResult {
  valid: boolean;
  error?: string;
}

interface RequestClaim {
  request_id: string;
  worker_address: string;
  status: string;
  claimed_at: string;
  completed_at?: string;
}

interface GraphQLResponse {
  data?: {
    getRequestClaim?: RequestClaim | null;
  };
  errors?: Array<{ message: string }>;
}

/**
 * Verify that the agent holds an active claim for the given requestId.
 *
 * @param requestId - The on-chain request ID (JINN_JOB_ID)
 * @param agentAddress - The agent's wallet address (from signature)
 * @returns JobVerifyResult with valid status and optional error message
 */
export async function verifyJobClaim(
  requestId: string,
  agentAddress: string
): Promise<JobVerifyResult> {
  const query = `query GetClaim($requestId: String!) {
    getRequestClaim(requestId: $requestId) {
      request_id
      worker_address
      status
      claimed_at
    }
  }`;

  try {
    const response = await fetch(CONTROL_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { requestId } }),
    });

    if (!response.ok) {
      console.error('[credential-bridge] Control API returned', response.status);
      // Fail open if Control API unreachable
      return { valid: true };
    }

    const data = await response.json() as GraphQLResponse;

    if (data.errors?.length) {
      console.error('[credential-bridge] Control API error:', data.errors[0].message);
      // Fail open on GraphQL errors
      return { valid: true };
    }

    const claim = data?.data?.getRequestClaim;

    if (!claim) {
      return { valid: false, error: `Request ${requestId} not claimed` };
    }

    // Verify claim is held by this agent
    if (claim.worker_address?.toLowerCase() !== agentAddress.toLowerCase()) {
      return { valid: false, error: 'Request claimed by different agent' };
    }

    // Verify still in progress
    if (claim.status === 'COMPLETED' || claim.status === 'FAILED') {
      return { valid: false, error: `Request ${requestId} already ${claim.status.toLowerCase()}` };
    }

    return { valid: true };
  } catch (err) {
    // Fail open if Control API unreachable
    console.error('[credential-bridge] Control API verification failed:', err);
    return { valid: true };
  }
}
