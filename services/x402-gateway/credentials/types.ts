/**
 * Credential Bridge Types
 *
 * Defines the ACL structure for mapping agent addresses to OAuth credentials.
 * Agents authenticate via ERC-8128 signed HTTP requests; the bridge verifies
 * signer identity and returns fresh OAuth tokens from Nango.
 */

/** Metadata about a Nango OAuth connection */
export interface ConnectionEntry {
  provider: string;
  metadata?: Record<string, string>;
}

/** A grant giving an agent address access to a specific credential */
export interface CredentialGrant {
  nangoConnectionId: string;
  pricePerAccess: string; // wei, "0" = free
  expiresAt: string | null; // ISO timestamp or null = never
  active: boolean;
}

/** Full ACL file structure */
export interface CredentialACL {
  connections: Record<string, ConnectionEntry>;
  grants: Record<string, Record<string, CredentialGrant>>; // address → provider → grant
}

/** Request body for credential access */
export interface CredentialRequest {
  requestId?: string;
}

/** Response from credential endpoint */
export interface CredentialResponse {
  access_token: string;
  expires_in: number;
  provider: string;
}

/** Error response */
export interface CredentialError {
  error: string;
  code: 'INVALID_SIGNATURE' | 'NOT_AUTHORIZED' | 'PAYMENT_REQUIRED' | 'PAYMENT_INVALID' | 'PROVIDER_NOT_FOUND' | 'GRANT_EXPIRED' | 'NANGO_ERROR' | 'NONCE_REUSED' | 'RATE_LIMITED' | 'DUPLICATE_REQUEST' | 'JOB_NOT_ACTIVE' | 'JOB_CLAIM_MISMATCH' | 'JOB_VERIFICATION_UNAVAILABLE';
}
