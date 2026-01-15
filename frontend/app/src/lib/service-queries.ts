/**
 * Service Queries
 *
 * Query functions for fetching services and service instances
 * from the Ponder backend.
 */

import {
  getWorkstreams,
  getWorkstream,
  getRequest,
  getJobDefinition,
  queryJobTemplates,
  queryArtifacts,
  type Workstream,
  type JobTemplate,
  type JobDefinition,
  type Artifact
} from '@jinn/shared-ui';
import type { Service, ServiceInstance } from './service-types';

/**
 * Transform a JobTemplate from Ponder to a Service
 */
function toService(template: JobTemplate): Service {
  return {
    id: template.id,
    templateId: template.id,
    name: template.name || 'Unnamed Service',
    description: template.description || '',
    tags: template.tags || [],
    priceUsd: template.priceUsd || '0',
    runCount: template.runCount || 0,
    createdAt: BigInt(template.createdAt || '0'),
  };
}

/**
 * Transform a Workstream from Ponder to a ServiceInstance
 */
function toServiceInstance(workstream: Workstream): ServiceInstance {
  return {
    id: workstream.id,
    workstreamId: workstream.id,
    jobName: workstream.jobName || 'Unnamed Instance',
    sender: workstream.sender,
    mech: workstream.mech,
    blockTimestamp: BigInt(workstream.blockTimestamp),
    lastActivity: BigInt(workstream.lastActivity || workstream.blockTimestamp),
    childRequestCount: workstream.childRequestCount || 0,
    delivered: workstream.delivered || false,
  };
}

/**
 * Fetch all visible services (job templates)
 */
export async function getServices(): Promise<Service[]> {
  const response = await queryJobTemplates();
  return response.items.map(toService);
}

/**
 * Fetch a single service by ID
 */
export async function getService(templateId: string): Promise<Service | null> {
  const response = await queryJobTemplates();
  const template = response.items.find(t => t.id === templateId);
  return template ? toService(template) : null;
}

/**
 * Fetch all service instances (workstreams)
 */
export async function getServiceInstances(): Promise<ServiceInstance[]> {
  const response = await getWorkstreams();
  return response.requests.items.map(toServiceInstance);
}

/**
 * Fetch a single service instance by ID
 */
export async function getServiceInstance(workstreamId: string): Promise<ServiceInstance | null> {
  const response = await getWorkstreams();
  const workstream = response.requests.items.find(w => w.id === workstreamId);
  return workstream ? toServiceInstance(workstream) : null;
}

/**
 * Fetch service instances for a specific service
 */
export async function getServiceInstancesForService(templateId: string): Promise<ServiceInstance[]> {
  // TODO: Filter workstreams by template ID once the relationship is established
  const response = await getWorkstreams();
  return response.requests.items.map(toServiceInstance);
}

/**
 * Get the root job definition for a workstream
 * Flow: workstream.id -> request -> jobDefinitionId -> jobDefinition (with blueprint)
 */
export async function getRootJobDefinition(workstreamId: string): Promise<JobDefinition | null> {
  // The workstream ID is the same as the root request ID
  const rootRequest = await getRequest(workstreamId);
  if (!rootRequest?.jobDefinitionId) {
    return null;
  }
  return getJobDefinition(rootRequest.jobDefinitionId);
}

/**
 * Get MEASUREMENT artifacts for a workstream
 * These are artifacts created by agents when they measure invariants
 */
export async function getMeasurementArtifacts(workstreamId: string): Promise<Artifact[]> {
  const response = await queryArtifacts({
    where: {
      sourceRequestId: workstreamId,
      topic: 'MEASUREMENT'
    },
    orderBy: 'blockTimestamp',
    orderDirection: 'desc',
    limit: 100
  });
  return response.items;
}
