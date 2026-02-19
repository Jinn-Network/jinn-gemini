import Link from 'next/link';
import { TruncatedId } from '@/components/truncated-id';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
} from '@/components/ui/pagination';
import type { Workstream } from '@/lib/subgraph';

function getStatusDisplay(workstream: Workstream): { label: string; className: string } {
  // Prefer lastStatus from Ponder (available after schema deploy with actual delivery status)
  const status = workstream.lastStatus;
  if (status) {
    switch (status.toUpperCase()) {
      case 'COMPLETED':
        return { label: 'Completed', className: 'bg-green-500/10 text-green-500 border-green-500/20' };
      case 'FAILED':
        return { label: 'Failed', className: 'bg-red-500/10 text-red-500 border-red-500/20' };
      case 'DELEGATING':
        return { label: 'Delegating', className: 'bg-blue-500/10 text-blue-500 border-blue-500/20' };
      case 'WAITING':
        return { label: 'Waiting', className: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' };
      default:
        return { label: status, className: 'bg-muted text-muted-foreground border-muted' };
    }
  }
  // Fallback: delivered just means root request got an on-chain Deliver event,
  // NOT that all jobs completed. Show neutral, not green.
  if (workstream.delivered) {
    return { label: 'Delivered', className: 'bg-muted text-muted-foreground border-muted' };
  }
  return { label: 'In Progress', className: 'bg-blue-500/10 text-blue-500 border-blue-500/20' };
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(Number(timestamp) * 1000);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface WorkstreamsTableProps {
  workstreams: Workstream[];
  pagination?: {
    hasPreviousPage: boolean;
    hasNextPage: boolean;
    startCursor?: string;
    endCursor?: string;
    itemCount: number;
  };
}

export function WorkstreamsTable({ workstreams, pagination }: WorkstreamsTableProps) {
  if (workstreams.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No workstreams found
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Started</TableHead>
              <TableHead className="text-right">ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workstreams.map((workstream) => (
              <TableRow key={workstream.id}>
                <TableCell>
                  <Link
                    href={`/workstreams/${workstream.id}`}
                    className="text-primary hover:text-primary hover:underline font-medium"
                  >
                    {workstream.jobName || 'Unnamed Workstream'}
                  </Link>
                </TableCell>
                <TableCell>
                  {(() => {
                    const { label, className } = getStatusDisplay(workstream);
                    return <Badge variant="outline" className={className}>{label}</Badge>;
                  })()}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatTimestamp(workstream.blockTimestamp)}
                </TableCell>
                <TableCell className="text-right">
                  <TruncatedId value={workstream.id} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {pagination &&
        (pagination.hasPreviousPage || pagination.hasNextPage) && (
          <Pagination className="mt-6">
            <PaginationContent>
              <PaginationItem>
                {pagination.hasPreviousPage ? (
                  <PaginationPrevious
                    href={`/workstreams?before=${pagination.startCursor ?? ''}`}
                  />
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 text-muted-foreground opacity-50 cursor-not-allowed">
                    Previous
                  </span>
                )}
              </PaginationItem>
              <PaginationItem>
                <span className="px-4 text-sm text-muted-foreground">
                  {pagination.itemCount} items
                </span>
              </PaginationItem>
              <PaginationItem>
                {pagination.hasNextPage ? (
                  <PaginationNext
                    href={`/workstreams?after=${pagination.endCursor ?? ''}`}
                  />
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 text-muted-foreground opacity-50 cursor-not-allowed">
                    Next
                  </span>
                )}
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
    </>
  );
}
