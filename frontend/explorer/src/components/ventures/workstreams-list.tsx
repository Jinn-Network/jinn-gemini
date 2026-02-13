'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2 } from 'lucide-react';

interface WorkstreamGroup {
  workstreamId: string;
  jobName: string;
  templateId?: string;
  createdAt: string;
  lastActivity?: string;
  delivered: boolean;
  requestCount: number;
}

interface WorkstreamsListProps {
  ventureId: string;
}

async function fetchVentureWorkstreams(ventureId: string): Promise<WorkstreamGroup[]> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUBGRAPH_URL || 'https://ponder-production-6d16.up.railway.app/graphql'}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query VentureWorkstreams($ventureId: String!) {
          workstreams(
            where: { ventureId: $ventureId }
            orderBy: "lastActivity"
            orderDirection: "desc"
            limit: 50
          ) {
            items {
              id
              jobName
              blockTimestamp
              lastActivity
              childRequestCount
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
  const items: any[] = data?.data?.workstreams?.items || [];

  return items.map(ws => ({
    workstreamId: ws.id,
    jobName: ws.jobName || 'Unnamed',
    createdAt: ws.blockTimestamp,
    lastActivity: ws.lastActivity,
    delivered: ws.delivered,
    requestCount: ws.childRequestCount || 0,
  }));
}

function formatTimeAgo(timestamp: string): string {
  const now = Date.now();
  const diff = now - Number(timestamp) * 1000;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(Number(timestamp) * 1000).toLocaleDateString();
}

function formatDate(timestamp: string): string {
  const date = new Date(Number(timestamp) * 1000);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function WorkstreamsTableSkeleton() {
  return (
    <div className="rounded-md border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Job Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Requests</TableHead>
            <TableHead>Last Activity</TableHead>
            <TableHead>Started</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...Array(3)].map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-4 w-48" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16" /></TableCell>
              <TableCell className="text-right"><Skeleton className="h-4 w-8 ml-auto" /></TableCell>
              <TableCell><Skeleton className="h-4 w-20" /></TableCell>
              <TableCell><Skeleton className="h-4 w-24" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
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
    return <WorkstreamsTableSkeleton />;
  }

  if (workstreams.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No workstreams found
      </div>
    );
  }

  return (
    <div className="rounded-md border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Job Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Requests</TableHead>
            <TableHead>Last Activity</TableHead>
            <TableHead>Started</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {workstreams.map((ws) => (
            <TableRow key={ws.workstreamId} className="cursor-pointer">
              <TableCell>
                <Link
                  href={`/workstreams/${ws.workstreamId}`}
                  className="text-primary hover:underline font-medium"
                >
                  {ws.jobName}
                </Link>
              </TableCell>
              <TableCell>
                {ws.delivered ? (
                  <Badge className="bg-green-500/15 text-green-600 border-green-500/20 hover:bg-green-500/15">
                    Delivered
                  </Badge>
                ) : (
                  <Badge className="bg-yellow-500/15 text-yellow-600 border-yellow-500/20 hover:bg-yellow-500/15">
                    Active
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {ws.requestCount}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {ws.lastActivity ? formatTimeAgo(ws.lastActivity) : '—'}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(ws.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
