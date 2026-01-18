import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { NavHeader } from '@/components/nav-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExplorerLink } from '@/components/explorer-link';
import { InvariantList, HealthSummary, ServiceOutputCard } from '@/components/dashboard';
import { getServiceInstance, getRootJobDefinition, getMeasurementArtifacts, getRootRequest, getServiceOutputs } from '@/lib/service-queries';
import { parseInvariants, matchInvariantsWithMeasurements, countByStatus } from '@/lib/invariant-utils';
import { fetchIpfsContent } from '@/lib/ipfs';
import { formatRelativeTime, truncateAddress, type Artifact } from '@jinn/shared-ui';
import type { ServiceOutput } from '@/lib/service-types';

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

  // Fetch blueprint, measurements, and outputs
  const [rootJobDef, rootRequest, measurementArtifacts, outputArtifacts] = await Promise.all([
    getRootJobDefinition(id),
    getRootRequest(id),
    getMeasurementArtifacts(id),
    getServiceOutputs(id)
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
        // Extract blueprint (new architecture) or fall back to prompt (legacy)
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
      // If it's a string, try to parse it as JSON
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">{instance.jobName}</h1>
          <p className="mt-2 text-muted-foreground">
            Created by {truncateAddress(instance.sender)}
          </p>
        </div>
        <Badge variant={status === 'active' ? 'default' : 'secondary'} className="text-sm">
          {status}
        </Badge>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Created
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {formatRelativeTime(instance.blockTimestamp)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Requests
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{instance.childRequestCount}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Mech
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-mono">{truncateAddress(instance.mech)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Service Output - only show if we have outputs */}
      {/* Service Output - only show if we have outputs */}
      {primaryOutput && (
        <ServiceOutputCard output={primaryOutput} />
      )}

      {/* Health Summary */}
      {invariants.length > 0 && (
        <HealthSummary counts={statusCounts} />
      )}

      {/* Invariants List */}
      {invariants.length > 0 && (
        <InvariantList invariants={invariantsWithMeasurements} />
      )}

      {/* No Blueprint Message */}
      {invariants.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No blueprint invariants found for this workstream
          </CardContent>
        </Card>
      )}

      {/* Explorer Link */}
      <div className="flex justify-center pt-4">
        <Button variant="outline" size="lg" asChild>
          <ExplorerLink type="workstream" id={instance.workstreamId} className="no-underline hover:no-underline">
            View Full Details in Explorer
          </ExplorerLink>
        </Button>
      </div>
    </div>
  );
}

function InstanceDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="h-9 w-64 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-5 w-48 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-6 w-20 animate-pulse rounded bg-muted" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <div className="h-4 w-16 animate-pulse rounded bg-muted" />
            </CardHeader>
            <CardContent>
              <div className="h-8 w-24 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Health Summary Skeleton */}
      <Card>
        <CardContent className="py-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="h-6 w-32 animate-pulse rounded bg-muted" />
              <div className="mt-2 h-4 w-48 animate-pulse rounded bg-muted" />
            </div>
            <div className="flex gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="text-center">
                  <div className="h-8 w-8 mx-auto animate-pulse rounded bg-muted" />
                  <div className="mt-1 h-3 w-12 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Invariants Skeleton */}
      <Card>
        <CardHeader>
          <div className="h-6 w-24 animate-pulse rounded bg-muted" />
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-5 w-20 animate-pulse rounded bg-muted" />
                      <div className="h-5 w-16 animate-pulse rounded bg-muted" />
                    </div>
                    <div className="h-4 w-full animate-pulse rounded bg-muted" />
                  </div>
                  <div className="h-8 w-12 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default async function InstancePage({ params }: InstancePageProps) {
  const { id } = await params;

  return (
    <div className="flex min-h-screen flex-col">
      <NavHeader />

      <div className="flex-1 py-8">
        <div className="container mx-auto px-4">
          {/* Back Link */}
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Services
          </Link>

          <Suspense fallback={<InstanceDetailSkeleton />}>
            <InstanceDetail id={id} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
