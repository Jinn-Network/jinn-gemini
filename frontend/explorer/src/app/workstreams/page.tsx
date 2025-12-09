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

export const metadata: Metadata = {
  title: 'Workstreams',
  description: 'Browse all workstreams - top-level job executions and their downstream graphs',
}

// Force dynamic rendering to avoid build-time data fetching
export const dynamic = 'force-dynamic'

export default async function WorkstreamsPage() {
  const { requests } = await getWorkstreams({ limit: 50 })

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
      )}
      </div>
    </>
  )
}

