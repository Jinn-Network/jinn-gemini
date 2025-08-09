'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { MarkdownField } from '@/components/markdown-field'
import { IdLink } from '@/components/id-link'
import { createClient } from '@/lib/supabase'
import { DbRecord } from '@/lib/types'

interface ArtifactDetailViewProps {
  record: DbRecord
}

interface TriggeredJob {
  id: string
  job_name: string
  status: string
  created_at: string
  job_report_id?: string
}

function humanizeFieldName(fieldName: string): string {
  return fieldName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function ObjectViewer({ data }: { data: unknown }) {
  if (data === null || data === undefined) {
    return <span className="text-gray-400 italic">null</span>
  }

  if (typeof data === 'object') {
    return (
      <div className="space-y-2">
        <pre className="text-sm bg-gray-50 p-3 rounded overflow-auto max-h-96">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    )
  }

  return <span>{String(data)}</span>
}

function TriggeredJobsList({ artifactId }: { artifactId: string }) {
  const [triggeredJobs, setTriggeredJobs] = useState<TriggeredJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchTriggeredJobs = async () => {
      try {
        const supabase = createClient()
        const { data, error } = await supabase
          .from('job_board')
          .select('id, job_name, status, created_at, job_report_id')
          .eq('source_artifact_id', artifactId)
          .order('created_at', { ascending: false })

        if (error) throw error

        setTriggeredJobs(data || [])
      } catch (err) {
        console.error('Error fetching triggered jobs:', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetchTriggeredJobs()
  }, [artifactId])

  if (loading) {
    return <div className="text-sm text-gray-500">Loading triggered jobs...</div>
  }

  if (error) {
    return <div className="text-sm text-red-500">Error loading triggered jobs: {error}</div>
  }

  if (triggeredJobs.length === 0) {
    return <div className="text-sm text-gray-500">No jobs were triggered by this artifact.</div>
  }

  return (
    <div className="space-y-3">
      {triggeredJobs.map((job) => (
        <div key={job.id} className="border rounded-lg p-3 bg-gray-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IdLink collection="job_board" id={job.id} />
              <span className="font-medium">{job.job_name}</span>
              <span className={`px-2 py-1 rounded text-xs font-medium ${
                job.status === 'COMPLETED' ? 'bg-green-100 text-green-800' :
                job.status === 'FAILED' ? 'bg-red-100 text-red-800' :
                job.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-800' :
                'bg-yellow-100 text-yellow-800'
              }`}>
                {job.status}
              </span>
            </div>
            <div className="text-xs text-gray-500">
              {new Date(job.created_at).toLocaleString()}
            </div>
          </div>
          {job.job_report_id && (
            <div className="mt-2 text-sm">
              Report: <IdLink id={job.job_report_id} fieldName="job_report_id" />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export function ArtifactDetailView({ record }: ArtifactDetailViewProps) {
  if (!record) {
    return null
  }

  // Extract the main content fields
  const { 
    content, 
    topic,
    status,
    source_job_name,
    thread_id,
    created_at,
    updated_at,
    id,
    ...otherFields 
  } = record

  // Fields to hide from the detail view
  const hiddenFields = ['id', 'content'] // Content is shown separately
  
  // Prepare details for the right sidebar
  const detailFields = {
    topic,
    status,
    source_job_name,
    thread_id,
    created_at,
    updated_at,
    ...otherFields
  }

  // Filter out hidden fields and null/undefined values
  const visibleDetailFields = Object.entries(detailFields).filter(([key, value]) => 
    !hiddenFields.includes(key) && value !== null && value !== undefined
  )

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* Main Content Area - spans 3 columns */}
      <div className="lg:col-span-3 space-y-6">
        {/* Content Card - Top Priority */}
        {content && (
          <Card>
            <CardHeader>
              <CardTitle>Content</CardTitle>
            </CardHeader>
            <CardContent>
              <MarkdownField content={typeof content === 'string' ? content : JSON.stringify(content, null, 2)} />
            </CardContent>
          </Card>
        )}

        {/* Triggered Jobs Card */}
        <Card>
          <CardHeader>
            <CardTitle>Jobs Triggered by This Artifact</CardTitle>
          </CardHeader>
          <CardContent>
            <TriggeredJobsList artifactId={String(id)} />
          </CardContent>
        </Card>
      </div>

      {/* Details Sidebar - Right aligned */}
      <div className="lg:col-span-1">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {visibleDetailFields.map(([key, value]) => (
                <div key={key} className="border-b border-gray-100 pb-3 last:border-b-0 last:pb-0">
                  <div className="font-medium text-gray-900 text-sm mb-1" title={`Field: ${key}`}>
                    {humanizeFieldName(key)}:
                  </div>
                  <div className="text-sm">
                    {/* Special handling for thread_id */}
                    {key === 'thread_id' && value ? (
                      <IdLink id={value} fieldName="thread_id" />
                    ) : /* Special handling for different data types */
                    typeof value === 'boolean' ? (
                      <span className={`inline-flex items-center px-2 py-1 rounded text-xs ${
                        value 
                          ? 'text-green-600 bg-green-50 border border-green-200' 
                          : 'text-red-600 bg-red-50 border border-red-200'
                      }`}>
                        {value ? '✓ true' : '✗ false'}
                      </span>
                    ) : typeof value === 'number' ? (
                      <span className="font-mono">
                        {value.toLocaleString()}
                      </span>
                    ) : typeof value === 'object' && value !== null ? (
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" className="text-xs">
                            View {Array.isArray(value) ? 'Array' : 'Object'}
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>{humanizeFieldName(key)}</DialogTitle>
                          </DialogHeader>
                          <ObjectViewer data={value} />
                        </DialogContent>
                      </Dialog>
                    ) : (
                      <span className="break-words">
                        {String(value)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}