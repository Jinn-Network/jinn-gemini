import { getRequest, getWorkstreamRequests, getWorkstreamArtifact, fetchIpfsContent, getJobDefinition } from '@/lib/subgraph'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArtifactDetailView } from '@/components/artifact-detail-view'
import { JobGraphView } from '@/components/graph/job-graph-view'
import { JobDefinitionsTable } from '@/components/job-definitions-table'
import { RequestsTable } from '@/components/requests-table'

// Force dynamic rendering to avoid build-time data fetching
export const dynamic = 'force-dynamic'

interface WorkstreamPageProps {
  params: Promise<{ id: string }>
}

export default async function WorkstreamPage({ params }: WorkstreamPageProps) {
  const resolvedParams = await params
  const workstreamId = decodeURIComponent(resolvedParams.id)

  // Fetch root request
  let rootRequest
  try {
    rootRequest = await getRequest(workstreamId)
    if (!rootRequest) {
      notFound()
    }
  } catch {
    notFound()
  }

  // Fetch all jobs in workstream (increase limit to get comprehensive data)
  // Note: getWorkstreamRequests already includes the root request in results
  const { requests: workstreamRequests } = await getWorkstreamRequests(workstreamId, 500)
  
  const allJobs = workstreamRequests.items

  // Fetch launcher briefing artifact
  const briefing = await getWorkstreamArtifact(workstreamId, 'launcher_briefing')
  
  // Fetch briefing content from IPFS if available
  let briefingWithContent: (typeof briefing & { content?: string }) | null = briefing
  if (briefing?.cid) {
    const ipfsContent = await fetchIpfsContent(briefing.cid)
    if (ipfsContent) {
      briefingWithContent = {
        ...briefing,
        content: ipfsContent.content
      }
    }
  }
  
  // Aggregate jobs by jobDefinitionId to create unique job list
  const jobDefinitionMap = new Map<string, {
    id: string
    name: string
    enabledTools: string[]
    lastInteraction: string
    lastStatus: string
    runCount: number
  }>()
  
  for (const job of allJobs) {
    if (job.jobDefinitionId) {
      const existing = jobDefinitionMap.get(job.jobDefinitionId)
      if (existing) {
        existing.runCount++
        // Update with most recent interaction (numeric comparison for timestamps)
        if (BigInt(job.blockTimestamp) > BigInt(existing.lastInteraction)) {
          existing.lastInteraction = job.blockTimestamp
        }
      } else {
        // Fetch job definition to get name and status
        const jobDef = await getJobDefinition(job.jobDefinitionId)
        jobDefinitionMap.set(job.jobDefinitionId, {
          id: job.jobDefinitionId,
          name: jobDef?.name || job.jobName || 'Unnamed Job',
          enabledTools: jobDef?.enabledTools || [],
          lastInteraction: job.blockTimestamp,
          lastStatus: jobDef?.lastStatus || (job.delivered ? 'COMPLETED' : 'PENDING'),
          runCount: 1
        })
      }
    }
  }
  
  // Convert to array for table display
  const uniqueJobDefinitions = Array.from(jobDefinitionMap.values()).map(def => ({
    id: def.id,
    enabledTools: def.enabledTools,
    name: def.name,
    lastInteraction: def.lastInteraction,
    lastStatus: def.lastStatus,
  }))

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

  // const formatRelativeTime = (timestamp: string) => {
  //   const date = new Date(Number(timestamp) * 1000)
  //   const now = new Date()
  //   const diffMs = now.getTime() - date.getTime()
  //   const diffMins = Math.floor(diffMs / 60000)
  //   const diffHours = Math.floor(diffMins / 60)
  //   const diffDays = Math.floor(diffHours / 24)
  //
  //   if (diffMins < 1) return 'just now'
  //   if (diffMins < 60) return `${diffMins}m ago`
  //   if (diffHours < 24) return `${diffHours}h ago`
  //   return `${diffDays}d ago`
  // }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <Link href="/workstreams" className="text-blue-600 hover:text-blue-800 text-sm">
          ← Back to Workstreams
        </Link>
        <h1 className="text-3xl font-bold">
          {rootRequest.jobName || 'Unnamed Workstream'}
        </h1>
        <p className="text-gray-600">
          Started {formatTimestamp(rootRequest.blockTimestamp)}
        </p>
      </div>

      {/* Workstream Graph - Full Width */}
      <Card>
        <CardHeader>
          <CardTitle>Workstream Graph</CardTitle>
        </CardHeader>
        <CardContent className="p-0 border-t">
          <div className="h-[600px] overflow-hidden">
            <JobGraphView rootId={workstreamId} groupByDefinition={true} />
          </div>
        </CardContent>
      </Card>

      {/* Launcher Briefing - Full Width */}
      {briefingWithContent && (
        <Card>
          <CardHeader>
            <CardTitle>Launcher Briefing</CardTitle>
          </CardHeader>
          <CardContent>
            <ArtifactDetailView record={briefingWithContent} />
          </CardContent>
        </Card>
      )}

      {/* Jobs - Full Width */}
      <Card>
        <CardHeader>
          <CardTitle>Jobs ({uniqueJobDefinitions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {uniqueJobDefinitions.length === 0 ? (
            <p className="text-gray-500 text-sm">No job definitions found in this workstream yet</p>
          ) : (
            <JobDefinitionsTable records={uniqueJobDefinitions} />
          )}
        </CardContent>
      </Card>

      {/* Job Runs - Full Width */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Job Runs ({allJobs.length})</CardTitle>
            <Link 
              href={`/requests?workstream=${workstreamId}`}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              See all →
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {allJobs.length === 0 ? (
            <p className="text-gray-500 text-sm">No job runs found in this workstream yet</p>
          ) : (
            <RequestsTable records={allJobs} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

