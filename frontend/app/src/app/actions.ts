'use server';

import { revalidatePath } from 'next/cache';
import { request as gqlRequest } from 'graphql-request';
import { supabaseMutate, supabaseAdminQuery } from '@/lib/supabase';
import { getWorkstreamActivity } from '@/lib/ventures/service-queries';
import type { JobDefinition } from '@/lib/subgraph';

interface CreateVentureInput {
  name: string;
  slug: string;
  owner_address: string;
  template: {
    sources: string[];
    lookbackPeriod: string;
    outputTopic: string;
    contentBrief: string;
    formatBrief: string;
    outputFormat: string;
    dispatchCron?: string;
    formatRules?: {
      minWords?: number;
      maxWords?: number;
      requiredSections?: string[];
      requiredCitations?: number;
    };
  };
}

const CONTENT_VENTURE_TEMPLATE_ID = '2942d6f6-2d03-4ae1-8189-5f78fd60cee3';
const CONTENT_TEMPLATE_SLUG = 'content-template';
const CONTENT_TEMPLATE_UUID = '26fcfe77-7281-4556-9a3d-7b05cf4f6b0b';

export async function createVenture(input: CreateVentureInput) {
  const dispatchCron = input.template.dispatchCron?.trim();
  const dispatchSchedule = dispatchCron ? [{
    id: crypto.randomUUID(),
    templateId: CONTENT_TEMPLATE_UUID,
    cron: dispatchCron,
    input: {
      name: input.name,
      sources: input.template.sources,
      lookbackPeriod: input.template.lookbackPeriod,
      outputTopic: input.template.outputTopic,
      contentBrief: input.template.contentBrief,
      formatBrief: input.template.formatBrief,
      outputFormat: input.template.outputFormat,
      ...(input.template.formatRules ? { formatRules: input.template.formatRules } : {}),
    },
    label: 'Content cadence',
    enabled: true,
  }] : [];

  // Deduplicate slug: check if it exists, append suffix if needed
  let slug = input.slug;
  const existing = await supabaseAdminQuery<{ id: string }>('ventures', {
    select: 'id',
    slug: `eq.${slug}`,
    limit: '1',
  });
  if (existing.length > 0) {
    slug = `${slug}-${Date.now().toString(36)}`;
  }

  const payload = {
    name: input.name,
    slug,
    description: `Content agent: ${input.template.contentBrief}`,
    owner_address: input.owner_address,
    status: 'proposed',
    creator_type: 'human',
    venture_template_id: CONTENT_VENTURE_TEMPLATE_ID,
    dispatch_schedule: dispatchSchedule,
    blueprint: {
      category: 'Content',
      templateId: CONTENT_TEMPLATE_SLUG,
      templateConfig: {
        name: input.name,
        sources: input.template.sources,
        lookbackPeriod: input.template.lookbackPeriod,
        outputTopic: input.template.outputTopic,
        contentBrief: input.template.contentBrief,
        formatBrief: input.template.formatBrief,
        outputFormat: input.template.outputFormat,
        ...(input.template.formatRules ? { formatRules: input.template.formatRules } : {}),
      },
    },
  };

  console.log('[createVenture] Creating venture:', slug);

  const result = await supabaseMutate<{ id: string; slug: string }>('ventures', 'POST', payload);

  if (result.error) {
    console.error('[createVenture] Failed:', result.error);
    return result;
  }

  if (!result.data?.id) {
    console.error('[createVenture] No data returned after insert');
    return { error: 'Venture creation failed — no data returned.' };
  }

  console.log('[createVenture] Success:', result.data.id, result.data.slug);
  revalidatePath('/');
  revalidatePath(`/ventures/${result.data.slug}`);

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
const OPERATIONAL_TOPICS = [
  'situation',
  'measurement',
  'git_branch',
  'git/branch',
  'service_output',
  'memory',
  'venture_ooda_situation',
  'debug',
  'heartbeat',
  'heartbeat-check',
];

export interface ArtifactWithJobName extends Artifact {
  jobName?: string;
}

function isOperationalTopic(topic: string): boolean {
  const normalized = topic.toLowerCase();
  return (
    OPERATIONAL_TOPICS.includes(normalized) ||
    normalized.startsWith('heartbeat') ||
    normalized.startsWith('debug')
  );
}

function sortArtifactsNewestFirst(artifacts: Artifact[]): Artifact[] {
  return [...artifacts].sort((a, b) => Number(b.blockTimestamp || 0) - Number(a.blockTimestamp || 0));
}

async function attachJobNames(artifacts: Artifact[]): Promise<ArtifactWithJobName[]> {
  const jobDefIds = [...new Set(
    artifacts
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

  return artifacts.map(artifact => ({
    ...artifact,
    jobName: artifact.sourceJobDefinitionId
      ? jobNameMap.get(artifact.sourceJobDefinitionId) || undefined
      : undefined,
  }));
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

    const contentArtifacts = sortArtifactsNewestFirst(
      allArtifacts.filter((a) => !isOperationalTopic(a.topic))
    );

    return attachJobNames(contentArtifacts);
  } catch (error) {
    console.error('Failed to fetch workstream artifacts:', error);
    return [];
  }
}

export async function fetchWorkstreamRootArtifactsAction(workstreamId: string): Promise<ArtifactWithJobName[]> {
  try {
    const response = await queryArtifacts({
      where: { requestId: workstreamId },
      orderBy: 'blockTimestamp',
      orderDirection: 'desc',
      limit: 200,
    });

    const contentArtifacts = sortArtifactsNewestFirst(
      response.items.filter((artifact) => !isOperationalTopic(artifact.topic))
    );

    return attachJobNames(contentArtifacts);
  } catch (error) {
    console.error('Failed to fetch root workstream artifacts:', error);
    return [];
  }
}

export interface StreamFeedItem extends ArtifactWithJobName {
  ventureName?: string;
  ventureSlug?: string;
}

interface StreamFeedArtifact extends Artifact {
  ventureId?: string | null;
  workstreamId?: string | null;
}

const STREAM_FEED_ARTIFACTS_QUERY = `
  query StreamFeedArtifacts($limit: Int!) {
    artifacts(
      limit: $limit
      orderBy: "blockTimestamp"
      orderDirection: "desc"
      where: { ventureId_not: null }
    ) {
      items {
        id
        requestId
        sourceRequestId
        sourceJobDefinitionId
        ventureId
        workstreamId
        name
        cid
        topic
        contentPreview
        blockTimestamp
      }
    }
  }
`;

export async function fetchStreamFeedAction(): Promise<StreamFeedItem[]> {
  try {
    const { getVentures } = await import('@/lib/ventures');
    const ventures = await getVentures(500);
    const ventureById = new Map(
      ventures.map((venture) => [venture.id, { name: venture.name, slug: venture.slug }] as const)
    );

    const subgraphUrl = process.env.NEXT_PUBLIC_SUBGRAPH_URL || 'https://indexer.jinn.network/graphql';
    const response = await gqlRequest<{ artifacts: { items: StreamFeedArtifact[] } }>(
      subgraphUrl,
      STREAM_FEED_ARTIFACTS_QUERY,
      { limit: 500 }
    );

    const dedupedSorted = [...new Map(
      response.artifacts.items
        .filter((artifact) => !isOperationalTopic(artifact.topic))
        .map((artifact) => {
          const venture = artifact.ventureId ? ventureById.get(artifact.ventureId) : undefined;
          return [artifact.id, {
            ...artifact,
            ventureName: venture?.name,
            ventureSlug: venture?.slug,
          } satisfies StreamFeedItem] as const;
        })
    ).values()]
      .sort((a, b) => Number(b.blockTimestamp || 0) - Number(a.blockTimestamp || 0))
      .slice(0, 150);

    const ventureMetaByArtifactId = new Map(
      dedupedSorted.map((artifact) => [
        artifact.id,
        {
          ventureName: artifact.ventureName,
          ventureSlug: artifact.ventureSlug,
        },
      ])
    );

    const withJobNames = await attachJobNames(dedupedSorted as Artifact[]);
    return withJobNames.map((artifact) => {
      const ventureMeta = ventureMetaByArtifactId.get(artifact.id);
      return {
        ...artifact,
        ventureName: ventureMeta?.ventureName,
        ventureSlug: ventureMeta?.ventureSlug,
      };
    });
  } catch (error) {
    console.error('Failed to fetch stream feed:', error);
    return [];
  }
}

export async function fetchArtifactByCidAction(cid: string): Promise<ArtifactWithJobName | null> {
  try {
    const result = await queryArtifacts({ where: { cid }, limit: 1 });
    const artifact = result.items[0];
    if (!artifact) return null;
    const jobName = artifact.sourceJobDefinitionId
      ? await getJobName(artifact.sourceJobDefinitionId).catch(() => null)
      : null;
    return { ...artifact, jobName: jobName || undefined };
  } catch {
    return null;
  }
}

export async function fetchWorkstreamRootArtifactByCidAction(
  workstreamId: string,
  cid: string
): Promise<ArtifactWithJobName | null> {
  try {
    const result = await queryArtifacts({
      where: { cid, requestId: workstreamId },
      limit: 1,
    });
    const artifact = result.items[0];
    if (!artifact || isOperationalTopic(artifact.topic)) return null;

    const jobName = artifact.sourceJobDefinitionId
      ? await getJobName(artifact.sourceJobDefinitionId).catch(() => null)
      : null;

    return { ...artifact, jobName: jobName || undefined };
  } catch {
    return null;
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
