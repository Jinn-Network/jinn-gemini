'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import { RequestsTable } from './requests-table'
import { RequestsTableSkeleton } from './loading-skeleton'
import { getRequest, queryRequests, type Request } from '@/lib/subgraph'

interface JobDefinition {
  id: string
  name: string
  enabledTools?: string[]
  promptContent?: string
  blueprint?: string
  sourceJobDefinitionId?: string
  sourceRequestId?: string
}

interface JobDefinitionDetailLayoutProps {
  record: JobDefinition
}

export function JobDefinitionDetailLayout({ record }: JobDefinitionDetailLayoutProps) {
  const [workstreamId, setWorkstreamId] = useState<string | null>(null)
  const [loadingWorkstream, setLoadingWorkstream] = useState(true)
  const [jobRuns, setJobRuns] = useState<Request[]>([])
  const [loadingRuns, setLoadingRuns] = useState(true)

  // Fetch runs and workstream once on mount
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch all runs for this job definition
        const runsResponse = await queryRequests({
          where: { jobDefinitionId: record.id },
          orderBy: 'blockTimestamp',
          orderDirection: 'desc',
        })
        
        setJobRuns(runsResponse.items)
        setLoadingRuns(false)

        // Find workstream by traversing to root
        if (runsResponse.items.length > 0) {
          const latestRun = runsResponse.items[0]
          let currentRequestId = latestRun.id
          let sourceRequestId = latestRun.sourceRequestId || null
          
          // Keep traversing up until we find a request with no source (the root)
          while (sourceRequestId) {
            try {
              const parentRequest = await getRequest(sourceRequestId)
              if (!parentRequest) {
                break
              }

              currentRequestId = sourceRequestId
              sourceRequestId = parentRequest.sourceRequestId || null

              if (!sourceRequestId) {
                break
              }
            } catch (parentError) {
              console.error('Error fetching parent request:', parentError)
              break
            }
          }
          
          setWorkstreamId(currentRequestId)
        }
      } catch (error) {
        console.error('Error fetching job runs:', error)
        setLoadingRuns(false)
      } finally {
        setLoadingWorkstream(false)
      }
    }

    fetchData()
  }, [record.id])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Main Content Area - 8/12 columns */}
      <div className="lg:col-span-8 space-y-6">
        {/* Blueprint Card */}
        <Card>
          <CardHeader>
            <CardTitle>Blueprint</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Blueprint Content */}
            <div>
              <div className="text-sm font-medium text-gray-700 mb-2">Blueprint</div>
              {record.blueprint || record.promptContent ? (
                <div className="prose prose-sm max-w-none bg-gray-50 p-4 rounded border">
                  <ReactMarkdown>{record.blueprint || record.promptContent || ''}</ReactMarkdown>
                </div>
              ) : (
                <div className="text-gray-500">[No blueprint content available]</div>
              )}
            </div>

            {/* Enabled Tools */}
            {record.enabledTools && record.enabledTools.length > 0 && (
              <div>
                <div className="text-sm font-medium text-gray-700 mb-2">Enabled Tools</div>
                <div className="flex flex-wrap gap-2">
                  {record.enabledTools.map((tool, index) => (
                    <Badge key={index} variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                      {tool}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Runs Card */}
        <Card>
          <CardHeader>
            <CardTitle>Runs</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingRuns ? (
              <RequestsTableSkeleton />
            ) : jobRuns.length > 0 ? (
              <RequestsTable records={jobRuns} />
            ) : (
              <div className="text-center py-8 text-gray-500">
                No runs found for this job definition
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sidebar - 4/12 columns */}
      <div className="lg:col-span-4">
        <Card>
          <CardHeader>
            <CardTitle>Info</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Job Definition ID */}
              <div>
                <div className="text-sm font-medium text-gray-700 mb-1">ID</div>
                <div className="text-sm text-gray-600 font-mono break-all">
                  {record.id}
                </div>
              </div>

              {/* Workstream Link */}
              {loadingWorkstream ? (
                <div>
                  <div className="text-sm font-medium text-gray-700 mb-1">Workstream</div>
                  <div className="text-sm text-gray-500">Loading...</div>
                </div>
              ) : workstreamId ? (
                <div>
                  <div className="text-sm font-medium text-gray-700 mb-1">Workstream</div>
                  <Link
                    href={`/workstreams/${workstreamId}`}
                    className="text-blue-600 hover:text-blue-800 hover:underline text-sm break-all"
                  >
                    {workstreamId.substring(0, 16)}...
                  </Link>
                </div>
              ) : null}

              {/* Source Job Definition */}
              {record.sourceJobDefinitionId && (
                <div>
                  <div className="text-sm font-medium text-gray-700 mb-1">Source Job Definition</div>
                  <Link
                    href={`/jobDefinitions/${record.sourceJobDefinitionId}`}
                    className="text-blue-600 hover:text-blue-800 hover:underline text-sm break-all"
                  >
                    {record.sourceJobDefinitionId.substring(0, 16)}...
                  </Link>
                </div>
              )}

              {/* Source Request */}
              {record.sourceRequestId && (
                <div>
                  <div className="text-sm font-medium text-gray-700 mb-1">Source Job Execution</div>
                  <Link
                    href={`/requests/${record.sourceRequestId}`}
                    className="text-blue-600 hover:text-blue-800 hover:underline text-sm break-all"
                  >
                    {record.sourceRequestId.substring(0, 16)}...
                  </Link>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
