import { Metadata } from 'next'
import { getWorkstreams } from '@/lib/subgraph'
import Link from 'next/link'
import { TruncatedId } from '@/components/truncated-id'
import { SiteHeader } from '@/components/site-header'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
} from '@/components/ui/pagination'

export const metadata: Metadata = {
  title: 'Workstreams',
  description: 'Browse all workstreams - top-level job executions and their downstream graphs',
}

// Force dynamic rendering to avoid build-time data fetching
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

interface PageProps {
  searchParams: Promise<{ after?: string; before?: string }>
}

export default async function WorkstreamsPage({ searchParams }: PageProps) {
  const params = await searchParams
  const { after, before } = params

  const { requests } = await getWorkstreams({
    limit: PAGE_SIZE,
    after,
    before,
  })

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(Number(timestamp) * 1000)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const breadcrumbs = [
    { label: 'Workstreams' }
  ]

  return (
    <>
      <SiteHeader 
        subtitle="Top-level job executions and their entire downstream graphs"
        breadcrumbs={breadcrumbs}
      />
      <div className="p-4 md:p-6">

      {requests.items.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No workstreams found
        </div>
      ) : (
        <>
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job Name</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="text-right">ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.items.map((workstream) => (
                  <TableRow key={workstream.id}>
                    <TableCell>
                      <Link
                        href={`/workstreams/${workstream.id}`}
                        className="text-primary hover:text-primary hover:underline font-medium"
                      >
                        {workstream.jobName || 'Unnamed Workstream'}
                      </Link>
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

          {/* Pagination Controls */}
          {(requests.pageInfo.hasPreviousPage || requests.pageInfo.hasNextPage) && (
            <Pagination className="mt-6">
              <PaginationContent>
                <PaginationItem>
                  {requests.pageInfo.hasPreviousPage ? (
                    <PaginationPrevious
                      href={`/workstreams?before=${requests.pageInfo.startCursor}`}
                    />
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 text-muted-foreground opacity-50 cursor-not-allowed">
                      Previous
                    </span>
                  )}
                </PaginationItem>
                <PaginationItem>
                  <span className="px-4 text-sm text-muted-foreground">
                    {requests.items.length} items
                  </span>
                </PaginationItem>
                <PaginationItem>
                  {requests.pageInfo.hasNextPage ? (
                    <PaginationNext
                      href={`/workstreams?after=${requests.pageInfo.endCursor}`}
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
      )}
      </div>
    </>
  )
}

