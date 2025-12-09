'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardAction } from '@/components/ui/card'
import { TruncatedId } from '@/components/truncated-id'
import { useSubgraphCollection } from '@/hooks/use-subgraph-collection'
import { getWorkstreams, Workstream } from '@/lib/subgraph'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/status-badge'
import { ArrowRight } from 'lucide-react'

export function DashboardView() {
  const [workstreams, setWorkstreams] = useState<Workstream[]>([])
  const [workstreamsLoading, setWorkstreamsLoading] = useState(true)

  // Fetch job runs (unified requests view)
  const { records: jobRuns, loading: jobRunsLoading } = useSubgraphCollection({
    collectionName: 'requests',
    pageSize: 5,
    enablePolling: true
  })

  const { records: artifacts, loading: artifactsLoading } = useSubgraphCollection({
    collectionName: 'artifacts',
    pageSize: 5,
    enablePolling: true
  })

  const { records: jobDefinitions, loading: jobDefinitionsLoading } = useSubgraphCollection({
    collectionName: 'jobDefinitions',
    pageSize: 5,
    enablePolling: true
  })

  // Fetch workstreams
  useEffect(() => {
    const fetchWorkstreams = async () => {
      setWorkstreamsLoading(true)
      try {
        const { requests } = await getWorkstreams({ limit: 5 })
        setWorkstreams(requests.items)
      } catch (error) {
        console.error('Error fetching workstreams:', error)
      } finally {
        setWorkstreamsLoading(false)
      }
    }
    fetchWorkstreams()
  }, [])

  const formatTimestamp = (timestamp: string | bigint) => {
    const ts = typeof timestamp === 'bigint' ? Number(timestamp) : Number(timestamp)
    const date = new Date(ts * 1000)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // Map job run delivery state to status
  const getJobRunStatus = (delivered?: boolean) => {
    return delivered ? 'COMPLETED' : 'PENDING'
  }

  return (
    <div className="p-4 md:p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
        {/* Workstreams Card */}
        <Card>
          <CardHeader>
            <CardTitle>Workstreams</CardTitle>
            <CardDescription>Complex tasks broken down into coordinated AI agent workflows</CardDescription>
            <CardAction>
              <Link href="/workstreams" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
                View All <ArrowRight className="h-3 w-3" />
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {workstreamsLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : workstreams.length === 0 ? (
              <div className="text-sm text-muted-foreground">No workstreams yet</div>
            ) : (
              <div className="space-y-3">
                {workstreams.map((ws) => (
                  <Link
                    key={ws.id}
                    href={`/workstreams/${ws.id}`}
                    className="block p-3 rounded-md border hover:bg-accent transition-colors"
                  >
                    <div className="font-medium text-sm truncate">{ws.jobName || 'Unnamed'}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatTimestamp(ws.blockTimestamp)}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Job Definitions Card */}
        <Card>
          <CardHeader>
            <CardTitle>Job Definitions</CardTitle>
            <CardDescription>Templates that define what AI agents can do and how they work</CardDescription>
            <CardAction>
              <Link href="/jobDefinitions" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
                View All <ArrowRight className="h-3 w-3" />
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {jobDefinitionsLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : jobDefinitions.length === 0 ? (
              <div className="text-sm text-muted-foreground">No job definitions yet</div>
            ) : (
              <div className="space-y-3">
                {jobDefinitions.slice(0, 5).map((job: any) => (
                  <Link
                    key={job.id}
                    href={`/jobDefinitions/${job.id}`}
                    className="block p-3 rounded-md border hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="font-medium text-sm truncate">{job.name || 'Unnamed Job'}</div>
                      {job.lastStatus && <StatusBadge status={job.lastStatus} />}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <TruncatedId value={job.id} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Job Runs Card (unified requests/deliveries) */}
        <Card>
          <CardHeader>
            <CardTitle>Job Runs</CardTitle>
            <CardDescription>Individual AI agent executions and their results</CardDescription>
            <CardAction>
              <Link href="/requests" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
                View All <ArrowRight className="h-3 w-3" />
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {jobRunsLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : jobRuns.length === 0 ? (
              <div className="text-sm text-muted-foreground">No job runs yet</div>
            ) : (
              <div className="space-y-3">
                {jobRuns.slice(0, 5).map((run: any) => (
                  <Link
                    key={run.id}
                    href={`/requests/${run.id}`}
                    className="block p-3 rounded-md border hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="font-medium text-sm truncate">{run.jobName || 'Unnamed Job'}</div>
                      <StatusBadge status={getJobRunStatus(run.delivered)} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatTimestamp(run.blockTimestamp)}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Artifacts Card */}
        <Card>
          <CardHeader>
            <CardTitle>Artifacts</CardTitle>
            <CardDescription>Content, reports, and outputs produced by AI agents</CardDescription>
            <CardAction>
              <Link href="/artifacts" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
                View All <ArrowRight className="h-3 w-3" />
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {artifactsLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : artifacts.length === 0 ? (
              <div className="text-sm text-muted-foreground">No artifacts yet</div>
            ) : (
              <div className="space-y-3">
                {artifacts.slice(0, 5).map((artifact: any) => (
                  <Link
                    key={artifact.id}
                    href={`/artifacts/${artifact.id}`}
                    className="block p-3 rounded-md border hover:bg-accent transition-colors"
                  >
                    <div className="font-medium text-sm truncate">{artifact.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {artifact.topic}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  )
}
