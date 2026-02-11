'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { GitBranch, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import type { Request } from '@/lib/subgraph';

interface WorkstreamGroup {
  workstreamId: string;
  jobName: string;
  templateId?: string;
  createdAt: string;
  delivered: boolean;
  requestCount: number;
}

interface WorkstreamsListProps {
  ventureId: string;
}

async function fetchVentureWorkstreams(ventureId: string): Promise<WorkstreamGroup[]> {
  // Use the server action pattern — fetch requests from the API
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUBGRAPH_URL || 'https://ponder-production-6d16.up.railway.app/graphql'}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query VentureWorkstreams($ventureId: String!) {
          requests(
            where: { ventureId: $ventureId }
            orderBy: "blockTimestamp"
            orderDirection: "desc"
            limit: 200
          ) {
            items {
              id
              workstreamId
              jobName
              templateId
              blockTimestamp
              delivered
            }
          }
        }`,
        variables: { ventureId },
      }),
    }
  );

  if (!response.ok) return [];

  const data = await response.json();
  const requests: any[] = data?.data?.requests?.items || [];

  // Group by workstreamId
  const groups = new Map<string, WorkstreamGroup>();
  for (const req of requests) {
    const wsId = req.workstreamId || req.id;
    if (!groups.has(wsId)) {
      groups.set(wsId, {
        workstreamId: wsId,
        jobName: req.jobName || 'Unnamed',
        templateId: req.templateId,
        createdAt: req.blockTimestamp,
        delivered: req.delivered,
        requestCount: 0,
      });
    }
    const group = groups.get(wsId)!;
    group.requestCount++;
    // Root request (workstreamId === id) has the canonical job name
    if (req.id === wsId && req.jobName) {
      group.jobName = req.jobName;
    }
  }

  return Array.from(groups.values()).sort(
    (a, b) => Number(b.createdAt) - Number(a.createdAt)
  );
}

function formatTimestamp(ts: string): string {
  const date = new Date(Number(ts) * 1000);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function WorkstreamsList({ ventureId }: WorkstreamsListProps) {
  const [workstreams, setWorkstreams] = useState<WorkstreamGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchVentureWorkstreams(ventureId).then((ws) => {
      setWorkstreams(ws);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [ventureId]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading workstreams...
        </CardContent>
      </Card>
    );
  }

  if (workstreams.length === 0) {
    return null; // Don't show if no workstreams
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <GitBranch className="h-4 w-4" />
          Workstreams ({workstreams.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2">
          {workstreams.map((ws) => (
            <div
              key={ws.workstreamId}
              className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/30"
            >
              <div className="flex items-center gap-3 min-w-0">
                {ws.delivered ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                ) : (
                  <Clock className="h-4 w-4 text-yellow-500 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{ws.jobName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatTimestamp(ws.createdAt)}
                    {ws.requestCount > 1 && ` · ${ws.requestCount} requests`}
                  </p>
                </div>
              </div>
              <Badge variant={ws.delivered ? 'secondary' : 'outline'} className="text-xs shrink-0">
                {ws.delivered ? 'Delivered' : 'Active'}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
