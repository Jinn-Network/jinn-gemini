/**
 * ACL Store
 *
 * JSON-backed access control list mapping agent addresses to credential grants.
 * Reads from data/credential-acl.json (or path specified by CREDENTIAL_ACL_PATH).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CredentialACL, CredentialGrant, ConnectionEntry } from './types.js';

const DEFAULT_ACL_PATH = resolve(process.cwd(), 'data/credential-acl.json');

function getAclPath(): string {
  return process.env.CREDENTIAL_ACL_PATH || DEFAULT_ACL_PATH;
}

function loadAcl(): CredentialACL {
  const path = getAclPath();
  if (!existsSync(path)) {
    return { connections: {}, grants: {} };
  }
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as CredentialACL;
}

function saveAcl(acl: CredentialACL): void {
  const path = getAclPath();
  const dir = resolve(path, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(acl, null, 2) + '\n', 'utf-8');
}

/**
 * Get a credential grant for an agent address and provider.
 * Returns null if no grant exists, is inactive, or has expired.
 */
export function getGrant(address: string, provider: string): CredentialGrant | null {
  const acl = loadAcl();
  const normalized = address.toLowerCase();
  const agentGrants = acl.grants[normalized];
  if (!agentGrants) return null;

  const grant = agentGrants[provider];
  if (!grant) return null;
  if (!grant.active) return null;

  if (grant.expiresAt) {
    const expiry = new Date(grant.expiresAt).getTime();
    if (Date.now() > expiry) return null;
  }

  return grant;
}

/**
 * Get connection metadata for a Nango connection ID.
 */
export function getConnection(connectionId: string): ConnectionEntry | null {
  const acl = loadAcl();
  return acl.connections[connectionId] || null;
}

/**
 * Set a credential grant for an agent address and provider.
 */
export function setGrant(
  address: string,
  provider: string,
  grant: CredentialGrant
): void {
  const acl = loadAcl();
  const normalized = address.toLowerCase();
  if (!acl.grants[normalized]) {
    acl.grants[normalized] = {};
  }
  acl.grants[normalized][provider] = grant;
  saveAcl(acl);
}

/**
 * Register a Nango connection in the ACL.
 */
export function setConnection(
  connectionId: string,
  entry: ConnectionEntry
): void {
  const acl = loadAcl();
  acl.connections[connectionId] = entry;
  saveAcl(acl);
}

/**
 * Revoke a credential grant (sets active: false).
 */
export function revokeGrant(address: string, provider: string): boolean {
  const acl = loadAcl();
  const normalized = address.toLowerCase();
  const agentGrants = acl.grants[normalized];
  if (!agentGrants || !agentGrants[provider]) return false;

  agentGrants[provider].active = false;
  saveAcl(acl);
  return true;
}

/**
 * List all active grants for an address.
 */
export function listGrants(address: string): Record<string, CredentialGrant> {
  const acl = loadAcl();
  const normalized = address.toLowerCase();
  const agentGrants = acl.grants[normalized] || {};
  const active: Record<string, CredentialGrant> = {};
  for (const [provider, grant] of Object.entries(agentGrants)) {
    if (grant.active) {
      active[provider] = grant;
    }
  }
  return active;
}
