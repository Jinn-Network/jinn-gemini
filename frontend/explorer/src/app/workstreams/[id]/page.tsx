import { getRequest, getWorkstreamRequests, getWorkstreamArtifact } from '@/lib/subgraph'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { WorkstreamBriefing } from '@/components/workstream-briefing'
import { JobGraphView } from '@/components/graph/job-graph-view'

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

  // Fetch recent jobs in workstream
  const { requests: recentJobs } = await getWorkstreamRequests(workstreamId, 9)
  
  // Add root request to the list (it's the top-level job)
  const allJobs = [rootRequest, ...recentJobs.items]

  // Fetch launcher briefing
  const briefing = await getWorkstreamArtifact(workstreamId, 'launcher_briefing')

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

  const formatRelativeTime = (timestamp: string) => {
    const date = new Date(Number(timestamp) * 1000)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return `${diffDays}d ago`
  }

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

      {/* Launcher Briefing */}
      <Card>
        <CardHeader>
          <CardTitle>Launcher Briefing</CardTitle>
        </CardHeader>
        <CardContent>
          <WorkstreamBriefing 
            rootRequestId={workstreamId} 
            initialBriefing={briefing}
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Job Graph */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Workstream Graph</CardTitle>
            </CardHeader>
            <CardContent className="p-0 border-t">
              <div className="h-[600px] overflow-hidden">
                <JobGraphView rootId={workstreamId} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Jobs */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Recent Jobs</CardTitle>
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
                <p className="text-gray-500 text-sm">No jobs found in this workstream yet</p>
              ) : (
                <div className="space-y-3">
                  {allJobs.map((job) => (
                    <Link 
                      key={job.id} 
                      href={`/requests/${job.id}`}
                      className="block p-3 border rounded-md hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm">
                              {job.jobName || 'Unnamed Job'}
                            </span>
                            {job.delivered && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-green-50 text-green-700 border border-green-200">
                                ✓ Delivered
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatRelativeTime(job.blockTimestamp)}
                          </div>
                        </div>
                        <div className="text-xs text-gray-400 font-mono">
                          {job.id.substring(0, 8)}...
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

