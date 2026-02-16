'use server';

import { revalidatePath } from 'next/cache';
import { supabaseMutate, supabaseAdminQuery } from '@/lib/supabase';
import { getWorkstreamActivity } from '@/lib/ventures/service-queries';
import type { JobDefinition } from '@/lib/subgraph';

interface CreateVentureInput {
  name: string;
  slug: string;
  description: string;
  category: string;
  problem: string;
  owner_address: string;
}

export async function createVenture(input: CreateVentureInput) {
  const result = await supabaseMutate<{ id: string; slug: string }>('ventures', 'POST', {
    name: input.name,
    slug: input.slug,
    description: input.description,
    owner_address: input.owner_address,
    status: 'proposed',
    creator_type: 'human',
    blueprint: {
      category: input.category,
      problem: input.problem,
      invariants: [],
    },
  });

  if (result.data) {
    revalidatePath('/');
    revalidatePath(`/ventures/${result.data.slug}`);
  }

  return result;
}

interface UpdateVentureTokenInput {
  token_address: string;
  token_symbol: string;
  token_name: string;
  governance_address: string;
  pool_address: string;
  token_metadata: Record<string, unknown>;
}

export async function updateVentureToken(
  ventureId: string,
  input: UpdateVentureTokenInput
) {
  const result = await supabaseMutate<{ id: string }>('ventures', 'PATCH', {
    ...input,
    token_launch_platform: 'doppler',
    status: 'bonding',
  }, ventureId);

  if (result.data) {
    revalidatePath('/');
  }

  return result;
}

// Social Actions

export async function getLikeStatus(ventureId: string, userAddress: string) {
  const result = await supabaseAdminQuery('likes', {
    select: 'venture_id',
    venture_id: `eq.${ventureId}`,
    user_address: `eq.${userAddress}`,
    limit: '1'
  });
  return result.length > 0;
}

export async function toggleLike(ventureId: string, userAddress: string) {
  // Check if already liked
  const existing = await getLikeStatus(ventureId, userAddress);

  if (existing) {
    // Unlike
    return supabaseMutate('likes', 'DELETE', undefined, undefined, {
      venture_id: `eq.${ventureId}`,
      user_address: `eq.${userAddress}`
    });
  } else {
    // Like
    return supabaseMutate('likes', 'POST', {
      venture_id: ventureId,
      user_address: userAddress
    });
  }
}

export interface Comment {
  id: string;
  venture_id: string;
  user_address: string;
  content: string;
  created_at: string;
}

export async function getComments(ventureId: string) {
  return supabaseAdminQuery<Comment>('comments', {
    select: '*',
    venture_id: `eq.${ventureId}`,
    order: 'created_at.desc'
  });
}

export async function postComment(ventureId: string, userAddress: string, content: string) {
  return supabaseMutate<Comment>('comments', 'POST', {
    venture_id: ventureId,
    user_address: userAddress,
    content
  });
}

// Workstream Activity (for VentureDashboard polling)

export async function fetchWorkstreamActivityAction(workstreamId: string): Promise<{ jobDefinitions: JobDefinition[] }> {
    try {
        return await getWorkstreamActivity(workstreamId);
    } catch (error) {
        console.error('Failed to fetch activity:', error);
        return { jobDefinitions: [] };
    }
}

// Artifact queries (server-side — shared-ui's graphql-request can't resolve env vars in the client bundle)

import { queryRequests, queryArtifacts, getJobName, type Artifact } from '@jinn/shared-ui';

// Operational topics to exclude — internal system artifacts
const OPERATIONAL_TOPICS = ['situation', 'measurement', 'git_branch', 'git/branch', 'service_output'];

export interface ArtifactWithJobName extends Artifact {
  jobName?: string;
}

export async function fetchWorkstreamArtifactsAction(workstreamId: string): Promise<ArtifactWithJobName[]> {
  try {
    const requestsResponse = await queryRequests({ where: { workstreamId }, limit: 200 });
    const requestIds = [workstreamId, ...requestsResponse.items.map((r: { id: string }) => r.id)];

    // Fetch artifacts for all requests in parallel (batches of 20 to avoid overwhelming Ponder)
    const BATCH_SIZE = 20;
    const allArtifacts: Artifact[] = [];
    for (let i = 0; i < requestIds.length; i += BATCH_SIZE) {
      const batch = requestIds.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(requestId =>
          queryArtifacts({
            where: { requestId },
            orderBy: 'blockTimestamp',
            orderDirection: 'desc',
            limit: 50,
          }).catch(() => ({ items: [] as Artifact[] }))
        )
      );
      for (const r of results) allArtifacts.push(...r.items);
    }

    // Sort newest first
    allArtifacts.sort((a, b) => Number(b.blockTimestamp || 0) - Number(a.blockTimestamp || 0));

    // Filter out operational topics
    const contentArtifacts = allArtifacts.filter(
      (a) => !OPERATIONAL_TOPICS.includes(a.topic.toLowerCase())
    );

    // Resolve job names in parallel (deduplicate IDs first)
    const jobDefIds = [...new Set(
      contentArtifacts
        .map(a => a.sourceJobDefinitionId)
        .filter((id): id is string => !!id)
    )];
    const jobNameMap = new Map<string, string>();
    const nameResults = await Promise.all(
      jobDefIds.map(async id => {
        const name = await getJobName(id).catch(() => null);
        return [id, name] as const;
      })
    );
    for (const [id, name] of nameResults) {
      if (name) jobNameMap.set(id, name);
    }

    return contentArtifacts.map(artifact => ({
      ...artifact,
      jobName: artifact.sourceJobDefinitionId
        ? jobNameMap.get(artifact.sourceJobDefinitionId) || undefined
        : undefined,
    }));
  } catch (error) {
    console.error('Failed to fetch workstream artifacts:', error);
    return [];
  }
}

export async function fetchArtifactContentAction(
  cid: string,
): Promise<{ content: string; contentType: string } | null> {
  const gateways = ['https://gateway.autonolas.tech/ipfs/', 'https://ipfs.io/ipfs/'];

  for (const gateway of gateways) {
    try {
      const url = `${gateway}${cid}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        cache: 'no-store',
      });
      if (!response.ok) continue;

      const text = await response.text();
      const contentType = response.headers.get('content-type') || 'text/plain';

      // Extract .content field if it exists (standard artifact format)
      try {
        const parsed = JSON.parse(text);
        const content = parsed.content || text;
        return {
          content: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
          contentType: 'application/json',
        };
      } catch {
        return { content: text, contentType };
      }
    } catch {
      continue;
    }
  }

  return null;
}

// KPI Management

export interface KPIInvariant {
  id: string;
  type: 'FLOOR' | 'CEILING' | 'RANGE' | 'BOOLEAN';
  metric?: string;
  condition?: string;
  min?: number;
  max?: number;
  assessment: string;
}

export async function updateVentureKPIs(
  ventureId: string,
  invariants: KPIInvariant[],
  userAddress: string
) {
  // Verify ownership
  const ventures = await supabaseAdminQuery<{ id: string; owner_address: string; blueprint: Record<string, unknown> | null }>(
    'ventures',
    {
      select: 'id,owner_address,blueprint',
      id: `eq.${ventureId}`,
      limit: '1',
    }
  );

  const venture = ventures[0];
  if (!venture) return { error: 'Venture not found' };
  if (venture.owner_address.toLowerCase() !== userAddress.toLowerCase()) {
    return { error: 'Only the venture owner can update KPIs' };
  }

  const existingBlueprint = (venture.blueprint || {}) as Record<string, unknown>;
  const result = await supabaseMutate('ventures', 'PATCH', {
    blueprint: {
      ...existingBlueprint,
      invariants,
    },
  }, ventureId);

  if (!result.error) {
    revalidatePath('/');
    revalidatePath(`/ventures/`);
  }

  return result;
}
