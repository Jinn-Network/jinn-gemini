import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ExternalLink, User, Bot } from 'lucide-react';
import { getVentureBySlug } from '@/lib/ventures';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { PoolStatusBadge } from '@/components/pool-status-badge';
import { AddressRow } from '@/components/address-row';
import { BondingProgress } from '@/components/bonding-progress';
import { LaunchTokenCard } from '@/components/launch-token-card';
import { CommentSection } from '@/components/comment-section';
import { LikeButton } from '@/components/like-button';
import { ShareButton } from '@/components/share-button';
import { KPIEditor } from '@/components/kpi-editor';
import { VentureDashboard } from '@/components/ventures/venture-dashboard';
import type { KPIInvariant } from '@/app/actions';
import { fetchWorkstreamActivityAction, fetchWorkstreamArtifactsAction } from '@/app/actions';
import { getServiceInstance, getRootJobDefinition, getRootRequest, getMeasurementArtifacts, getServiceOutputs, getWorkstreamActivity } from '@/lib/ventures/service-queries';
import type { ServiceOutput } from '@/lib/ventures/service-types';
import { fetchIpfsContent } from '@/lib/subgraph';
import { parseInvariants, matchInvariantsWithMeasurements, countByStatus } from '@jinn/shared-ui';

export const revalidate = 30;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const venture = await getVentureBySlug(slug);
  if (!venture) return {};

  const description = venture.description
    ? venture.description.slice(0, 160)
    : 'A venture on Jinn';
  const blueprint = venture.blueprint as { category?: string } | null;
  const status = venture.status === 'active' && venture.token_address ? 'graduated' : venture.status;

  const ogParams = new URLSearchParams({
    name: venture.name,
    description: description,
    status: status,
    ...(venture.token_symbol && { symbol: venture.token_symbol }),
    ...(blueprint?.category && { category: blueprint.category }),
  });

  const ogImage = `/api/og?${ogParams.toString()}`;

  return {
    title: venture.name,
    description,
    openGraph: {
      title: venture.name,
      description,
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: venture.name,
      description,
      images: [ogImage],
    },
  };
}

/** Format large token supply numbers compactly */
function formatSupply(raw: unknown): string | null {
  const n = Number(raw);
  if (!raw || isNaN(n) || n <= 0) return null;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return n.toLocaleString();
}

/** Dashboard skeleton shown during Suspense loading */
function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Skeleton className="h-10 w-28" />
        <Skeleton className="h-10 w-28" />
        <Skeleton className="h-10 w-28" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Skeleton className="h-[500px] w-full rounded-lg" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-60 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/** Server component that fetches all dashboard data */
async function VentureDashboardSection({
  workstreamId,
  venture,
}: {
  workstreamId: string;
  venture: {
    token_address: string | null;
    token_symbol: string | null;
    token_name: string | null;
    token_launch_platform: string | null;
    governance_address: string | null;
    pool_address: string | null;
    token_metadata: Record<string, unknown> | null;
  };
}) {
  // Fetch all data in parallel
  const [rootJobDef, rootRequest, measurementArtifacts, outputArtifacts, activityData] = await Promise.all([
    getRootJobDefinition(workstreamId),
    getRootRequest(workstreamId),
    getMeasurementArtifacts(workstreamId),
    getServiceOutputs(workstreamId),
    getWorkstreamActivity(workstreamId),
  ]);

  // Parse blueprint from IPFS if available
  let blueprintText = rootJobDef?.blueprint || '';
  if (!blueprintText && rootRequest?.ipfsHash) {
    try {
      const content = await fetchIpfsContent(rootRequest.ipfsHash, rootRequest.id);
      if (content) {
        const parsed = JSON.parse(content.content);
        blueprintText = typeof parsed.blueprint === 'string'
          ? parsed.blueprint
          : JSON.stringify(parsed.blueprint || parsed);
      }
    } catch {
      // Ignore IPFS fetch errors
    }
  }

  // Parse invariants and match with measurements
  const rawInvariants = parseInvariants(blueprintText);
  const invariants = matchInvariantsWithMeasurements(rawInvariants, measurementArtifacts);
  const statusCounts = countByStatus(invariants);

  // Parse service outputs for live output URL
  let liveOutputUrl: string | null = null;
  let telegramUrl: string | null = null;
  let primaryOutput: ServiceOutput | null = null;

  for (const artifact of outputArtifacts) {
    if (artifact.contentPreview) {
      try {
        const output: ServiceOutput = JSON.parse(artifact.contentPreview);
        if (output.type === 'website' && output.primary) {
          liveOutputUrl = output.url;
          primaryOutput = output;
        }
        if (output.label?.toLowerCase().includes('telegram')) {
          telegramUrl = output.url;
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  // Token info
  const tokenInfo = venture.token_address ? {
    token_address: venture.token_address,
    token_symbol: venture.token_symbol,
    token_name: venture.token_name,
    token_launch_platform: venture.token_launch_platform,
    governance_address: venture.governance_address,
    pool_address: venture.pool_address,
    token_metadata: venture.token_metadata,
  } : null;

  return (
    <VentureDashboard
      liveOutputUrl={liveOutputUrl}
      telegramUrl={telegramUrl}
      activityData={activityData}
      workstreamId={workstreamId}
      invariants={invariants}
      statusCounts={statusCounts}
      primaryOutput={primaryOutput}
      fetchActivity={fetchWorkstreamActivityAction}
      fetchArtifacts={fetchWorkstreamArtifactsAction}
      tokenInfo={tokenInfo}
    />
  );
}

export default async function VentureDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const venture = await getVentureBySlug(slug);

  if (!venture) {
    notFound();
  }

  const hasWorkstream = !!venture.root_workstream_id;

  const meta = venture.token_metadata ?? {};
  const supply = formatSupply(meta.totalSupply);
  const timelock = typeof meta.timelock === 'string' ? meta.timelock : null;

  const statusLabel = venture.status === 'proposed'
    ? 'proposed'
    : venture.status === 'bonding'
      ? 'bonding'
      : venture.status === 'active' && venture.token_address
        ? 'graduated'
        : 'unknown';

  const blueprint = venture.blueprint as { category?: string; problem?: string; invariants?: KPIInvariant[] } | null;
  const invariants: KPIInvariant[] = blueprint?.invariants ?? [];

  return (
    <div className={`mx-auto px-4 py-8 space-y-6 ${hasWorkstream ? 'max-w-7xl' : 'max-w-3xl'}`}>
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{venture.name}</h1>
          {venture.token_symbol && (
            <Badge variant="secondary" className="font-mono">${venture.token_symbol}</Badge>
          )}
          <PoolStatusBadge status={statusLabel} />
          {blueprint?.category && (
            <Badge variant="outline" className="text-xs">{blueprint.category}</Badge>
          )}
        </div>
        {venture.description && (
          <p className="text-muted-foreground">{venture.description}</p>
        )}
        {!hasWorkstream && blueprint?.problem && (
          <p className="text-sm text-muted-foreground mt-1">
            <span className="font-medium text-foreground">Problem:</span> {blueprint.problem}
          </p>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {venture.creator_type === 'delegate' ? (
              <Bot className="h-3 w-3" />
            ) : (
              <User className="h-3 w-3" />
            )}
            <span>Created by</span>
            <a
              href={`https://basescan.org/address/${venture.owner_address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-primary hover:underline"
            >
              {venture.owner_address.slice(0, 6)}...{venture.owner_address.slice(-4)}
              <ExternalLink className="inline h-3 w-3 ml-0.5" />
            </a>
          </div>
          <div className="flex items-center gap-2">
            <LikeButton
              ventureId={venture.id}
              initialCount={venture.likes?.[0]?.count || 0}
            />
            <ShareButton
              url={`https://app.jinn.network/ventures/${venture.slug}`}
              title={venture.name}
              status={venture.status}
            />
          </div>
        </div>
      </div>

      {/* Launched venture: Full Dashboard */}
      {hasWorkstream && (
        <Suspense fallback={<DashboardSkeleton />}>
          <VentureDashboardSection
            workstreamId={venture.root_workstream_id!}
            venture={venture}
          />
        </Suspense>
      )}

      {/* Pre-launch venture: Simple view */}
      {!hasWorkstream && (
        <>
          {/* KPI Editor for proposed ventures */}
          {venture.status === 'proposed' && (
            <KPIEditor
              ventureId={venture.id}
              ownerAddress={venture.owner_address}
              initialInvariants={invariants}
            />
          )}

          {/* Launch token CTA for proposed ventures */}
          {venture.status === 'proposed' && !venture.token_address && (
            <LaunchTokenCard
              ventureId={venture.id}
              ventureName={venture.name}
              kpiCount={invariants.length}
            />
          )}

          {/* Bonding progress */}
          {venture.token_address && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Pool Status</CardTitle>
              </CardHeader>
              <CardContent>
                <BondingProgress tokenAddress={venture.token_address} />
              </CardContent>
            </Card>
          )}

          {/* Token info */}
          {venture.token_address && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Token Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {venture.token_name && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Name</span>
                    <span className="font-medium">{venture.token_name}</span>
                  </div>
                )}
                {supply && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Supply</span>
                    <span className="font-mono text-xs">{supply}</span>
                  </div>
                )}

                {/* Allocation bar */}
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Allocation</span>
                    <span className="text-[11px] text-muted-foreground">
                      10% curve · 10% vested · 80% treasury
                    </span>
                  </div>
                  <div className="flex h-1.5 w-full rounded-full overflow-hidden bg-muted">
                    <div className="bg-emerald-500" style={{ width: '10%' }} />
                    <div className="bg-blue-500" style={{ width: '10%' }} />
                    <div className="bg-purple-500" style={{ width: '80%' }} />
                  </div>
                </div>

                <Separator />

                {/* Contract addresses */}
                <AddressRow label="Contract" address={venture.token_address} />
                {venture.governance_address && (
                  <AddressRow label="Governor" address={venture.governance_address} />
                )}
                {timelock && (
                  <AddressRow label="Treasury" address={timelock} />
                )}
                {venture.pool_address && (
                  <AddressRow label="Pool" address={venture.pool_address} />
                )}
              </CardContent>
            </Card>
          )}

          {/* Comments */}
          <Separator />
          <CommentSection ventureId={venture.id} />

          {/* Explorer link */}
          {venture.root_workstream_id && (
            <Card>
              <CardContent className="py-4">
                <a
                  href={`https://explorer.jinn.network/instances/${venture.root_workstream_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline flex items-center gap-1"
                >
                  View workstream on Explorer
                  <ExternalLink className="h-3 w-3" />
                </a>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
