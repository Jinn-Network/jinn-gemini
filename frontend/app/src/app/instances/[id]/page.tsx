import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Globe, HeartPulse, Info } from 'lucide-react';
import { NavHeader } from '@/components/nav-header';
import { SiteHeader } from '@/components/site-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ExplorerLink } from '@/components/explorer-link';
import {
  getServiceInstance,
  getRootJobDefinition,
  getRootRequest,
  getMeasurementArtifacts,
  getServiceOutputs,
  getWorkstreamActivity
} from '@/lib/service-queries';
import { parseInvariants, matchInvariantsWithMeasurements, countByStatus } from '@/lib/invariant-utils';
import { fetchIpfsContent } from '@/lib/ipfs';
import { truncateAddress, type Request } from '@jinn/shared-ui';
import { LiveOutputView } from '@/components/live-output-view';
import { ActivityFeed } from '@/components/activity-feed';
import { InvariantList, HealthSummary, ServiceOutputCard } from '@/components/dashboard';
import type { ServiceOutput } from '@/lib/service-types';
import type { Artifact } from '@jinn/shared-ui';

/**
 * Parse SERVICE_OUTPUT artifact contentPreview to get output metadata
 */
function parseServiceOutput(artifact: Artifact): ServiceOutput | null {
  if (!artifact.contentPreview) return null;
  try {
    const parsed = JSON.parse(artifact.contentPreview);
    if (parsed.url && typeof parsed.url === 'string') {
      return {
        type: parsed.type || 'website',
        url: parsed.url,
        label: parsed.label,
        primary: parsed.primary
      };
    }
  } catch {
    // Not valid JSON, ignore
  }
  return null;
}

interface InstancePageProps {
  params: Promise<{ id: string }>;
}

async function InstanceDetail({ id }: { id: string }) {
  const instance = await getServiceInstance(id);

  if (!instance) {
    notFound();
  }

  // Fetch all data in parallel
  const [rootJobDef, rootRequest, measurementArtifacts, outputArtifacts, activityData] = await Promise.all([
    getRootJobDefinition(id),
    getRootRequest(id),
    getMeasurementArtifacts(id),
    getServiceOutputs(id),
    getWorkstreamActivity(id)
  ]);

  // Parse service outputs from artifacts
  const serviceOutputs = outputArtifacts
    .map(parseServiceOutput)
    .filter((o): o is ServiceOutput => o !== null);
  const primaryOutput = serviceOutputs.find(o => o.primary) || serviceOutputs[0];

  // Parse invariants from blueprint
  let blueprintJson: unknown = null;
  let rawBlueprintContent: string | null = null;

  // Try to fetch from IPFS first (source of truth)
  if (rootRequest?.ipfsHash) {
    try {
      const ipfsResult = await fetchIpfsContent(rootRequest.ipfsHash);
      if (ipfsResult) {
        const parsed = JSON.parse(ipfsResult.content);
        rawBlueprintContent = parsed.blueprint || parsed.prompt || ipfsResult.content;
      }
    } catch (e) {
      console.error('Failed to fetch/parse IPFS content', e);
    }
  }

  // Fallback to subgraph blueprint if IPFS failed or missing
  if (!rawBlueprintContent && rootJobDef?.blueprint) {
    rawBlueprintContent = rootJobDef.blueprint;
  }

  if (rawBlueprintContent) {
    try {
      blueprintJson = typeof rawBlueprintContent === 'string'
        ? JSON.parse(rawBlueprintContent)
        : rawBlueprintContent;
    } catch {
      // Invalid JSON, might be raw text, ignore for invariants
    }
  }

  const invariants = parseInvariants(blueprintJson);
  const invariantsWithMeasurements = matchInvariantsWithMeasurements(invariants, measurementArtifacts);
  const statusCounts = countByStatus(invariantsWithMeasurements);

  const status = instance.delivered ? 'completed' : 'active';

  // Use SERVICE_OUTPUT URL if available, otherwise fallback to hardcoded
  const LIVE_OUTPUT_URL = primaryOutput?.url || "https://blog-the-long-run-production.up.railway.app/";

  return (
    <div className="flex flex-col h-full gap-6">
      {/* Main Dashboard Grid with Tabs */}

      {/* Main Dashboard Grid with Tabs */}
      <Tabs defaultValue="output" className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-fit">
          <TabsTrigger value="output" className="gap-2">
            <Globe className="h-4 w-4" />
            Live Output
          </TabsTrigger>
          <TabsTrigger value="health" className="gap-2">
            <HeartPulse className="h-4 w-4" />
            Health ({invariants.length})
          </TabsTrigger>
          <TabsTrigger value="details" className="gap-2">
            <Info className="h-4 w-4" />
            Details
          </TabsTrigger>
        </TabsList>

        {/* Live Output Tab */}
        <TabsContent value="output" className="flex-1 min-h-0 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
            {/* Left Column: Live Output (Takes up 2/3) */}
            <div className="lg:col-span-2 flex flex-col min-h-0 bg-muted/10 rounded-xl border-dashed border-2 border-border/50 p-1">
              <LiveOutputView url={LIVE_OUTPUT_URL} />
            </div>

            {/* Right Column: Activity Feed (Takes up 1/3) */}
            <div className="lg:col-span-1 flex flex-col min-h-0">
              <ActivityFeed initialData={activityData} workstreamId={id} />
            </div>
          </div>
        </TabsContent>

        {/* Health Tab */}
        <TabsContent value="health" className="flex-1 min-h-0 mt-4 overflow-auto">
          <div className="space-y-6">
            {/* Service Output Card */}
            {primaryOutput && (
              <ServiceOutputCard output={primaryOutput} />
            )}

            {/* Health Summary */}
            {invariants.length > 0 && (
              <HealthSummary counts={statusCounts} />
            )}

            {/* Invariants List */}
            {invariants.length > 0 ? (
              <InvariantList invariants={invariantsWithMeasurements} />
            ) : (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  No blueprint invariants found for this workstream
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Details Tab */}
        <TabsContent value="details" className="flex-1 min-h-0 mt-4 overflow-auto">
          <div className="max-w-2xl space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Instance Details</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">Instance ID</p>
                    <p className="text-sm font-mono truncate" title={id}>{id}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">Created By</p>
                    <p className="text-sm font-mono truncate" title={instance.sender}>{truncateAddress(instance.sender)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">Created At</p>
                    <p className="text-sm text-foreground">
                      {new Date(Number(instance.blockTimestamp) * 1000).toLocaleString()}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">Status</p>
                    <Badge variant={status === 'active' ? 'default' : 'secondary'} className="text-xs uppercase">
                      {status}
                    </Badge>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Debug</p>
                  <ExplorerLink type="workstream" id={instance.workstreamId} className="no-underline hover:no-underline">
                    <span className="text-sm text-primary underline hover:text-foreground transition-colors flex items-center gap-1 w-fit">
                      View Debug Config in Explorer
                    </span>
                  </ExplorerLink>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InstanceDetailSkeleton() {
  return (
    <div className="space-y-6">
      {/* Removed header skeleton */}
      <div className="h-10 w-64 animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[500px]">
        <div className="lg:col-span-2 bg-muted/20 animate-pulse rounded-xl" />
        <div className="lg:col-span-1 bg-muted/20 animate-pulse rounded-xl" />
      </div>
    </div>
  );
}

export default async function InstancePage({ params }: InstancePageProps) {
  const { id } = await params;
  const instance = await getServiceInstance(id);

  if (!instance) {
    notFound();
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader
        breadcrumbs={[
          { label: 'Jinn', href: '/' },
          { label: instance.jobName }
        ]}
      />

      <main className="flex-1 py-6 flex flex-col min-h-0">
        <div className="container mx-auto px-4 flex-1 flex flex-col min-h-0">
          <Suspense fallback={<InstanceDetailSkeleton />}>
            <InstanceDetail id={id} />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
