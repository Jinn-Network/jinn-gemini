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
  const { requests: recentJobs } = await getWorkstreamRequests(workstreamId, 10)

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
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Link href="/workstreams" className="hover:text-blue-600">
            Workstreams
          </Link>
          <span>→</span>
          <span className="text-gray-900">{rootRequest.jobName || 'Unnamed Workstream'}</span>
        </div>
        <h1 className="text-3xl font-bold">
          {rootRequest.jobName || 'Unnamed Workstream'}
        </h1>
        <p className="text-gray-600">
          Started {formatTimestamp(rootRequest.blockTimestamp)}
        </p>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3">
        <Link href={`/graph/job/${workstreamId}`}>
          <button className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            View Job Graph
          </button>
        </Link>
        <Link href={`/requests?workstream=${workstreamId}`}>
          <button className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors">
            View All Jobs
          </button>
        </Link>
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

      {/* Job Graph */}
      <Card>
        <CardHeader>
          <CardTitle>Workstream Graph</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="h-[600px]">
            <JobGraphView rootId={workstreamId} />
          </div>
        </CardContent>
      </Card>

      {/* Recent Jobs */}
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
          {recentJobs.items.length === 0 ? (
            <p className="text-gray-500 text-sm">No jobs found in this workstream yet</p>
          ) : (
            <div className="space-y-3">
              {recentJobs.items.map((job) => (
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
  )
}

