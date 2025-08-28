'use client'

import Link from 'next/link'
import { DbRecord, CollectionName } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase'
import { useState, useEffect } from 'react'
import { MarkdownField } from '@/components/markdown-field'
import { IdLink } from '@/components/id-link'
import { JobReportDetailView } from '@/components/job-report-detail-view'
import { ArtifactDetailView } from '@/components/artifact-detail-view'

interface DetailViewProps {
  record: DbRecord
  collectionName: CollectionName
}

// Function to convert field names to human-readable labels
function humanizeFieldName(fieldName: string): string {
  return fieldName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

export function DetailView({ record, collectionName }: DetailViewProps) {
  const [promptData, setPromptData] = useState<{ id: string, content: string } | null>(null)
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(false)

  // Fetch prompt content if this is a job with prompt_ref
  useEffect(() => {
    if (collectionName === 'jobs' && record.prompt_ref) {
      const fetchPrompt = async () => {
        setIsLoadingPrompt(true)
        const supabase = createClient()
        
        // Parse prompt_ref (e.g., "analyst@1")
        const [name, versionStr] = record.prompt_ref.split('@')
        const version = versionStr ? parseInt(versionStr, 10) : 1 // Default to version 1 if not specified

        let query = supabase
          .from('prompt_library')
          .select('id, content')
          .eq('name', name)

        if (!isNaN(version)) {
          query = query.eq('version', version)
        }

        const { data } = await query.single()
        
        if (data) {
          setPromptData({ id: data.id, content: data.content })
        }
        setIsLoadingPrompt(false)
      }
      fetchPrompt()
    }
    
    // For unified jobs table, the prompt_content is directly available
    if (collectionName === 'jobs' && record.prompt_content) {
      setPromptData({ id: String(record.id), content: record.prompt_content })
    }
  }, [collectionName, record.prompt_ref, record.prompt_content, record.id])

  // Use specialized views for specific collection types
  if (collectionName === 'job_reports') {
    return <JobReportDetailView record={record} />
  }

  if (collectionName === 'artifacts') {
    return <ArtifactDetailView record={record} />
  }
  
  // If no record, return null
  if (!record) {
    return null
  }

  // Fields to hide from the detail view (including source_job_id since we show it separately)
  const hiddenFields = ['worker_id', 'source_job_id']
  
  // Filter out hidden fields
  const visibleFields = Object.entries(record).filter(([key]) => 
    !hiddenFields.includes(key)
  )

  // Reorder fields to show name first, then other fields
  const reorderedFields = visibleFields.sort(([keyA], [keyB]) => {
    if (keyA === 'name') return -1
    if (keyB === 'name') return 1
    return 0
  })
  
  // Check if this record has job creation tracking
  const hasJobCreationInfo = 'source_job_id' in record && record.source_job_id

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record Details</CardTitle>
      </CardHeader>
              <CardContent>
          <div className="space-y-6">
            {/* Show basic job information first */}
          {reorderedFields.map(([key, value]) => (
            <div key={key} className="border-b border-gray-100 pb-4 last:border-b-0 last:pb-0">
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                <div className="lg:col-span-1">
                  <span className="text-sm font-medium text-gray-900">{key}</span>
                </div>
                <div className="lg:col-span-3">
                  <ValueDisplay 
                    value={value} 
                    fieldName={key}
                    promptData={key === 'prompt_ref' ? promptData : undefined}
                    isLoadingPrompt={key === 'prompt_ref' ? isLoadingPrompt : false}
                  />
                </div>
              </div>
            </div>
          ))}

          {/* Show Job Executions and Child Jobs for job records */}
          {collectionName === 'jobs' && (
            <>
              <div className="border-b border-gray-100 pb-4">
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                  <div className="lg:col-span-1">
                    <span className="text-sm font-medium text-gray-900">Job Executions:</span>
                  </div>
                  <div className="lg:col-span-3">
                    <JobExecutions jobDefinitionId={String(record.id)} />
                  </div>
                </div>
              </div>
              <div className="border-b border-gray-100 pb-4">
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                  <div className="lg:col-span-1">
                    <span className="text-sm font-medium text-gray-900">Child Jobs:</span>
                  </div>
                  <div className="lg:col-span-3">
                    <ChildJobs jobDefinitionId={String(record.id)} />
                  </div>
                </div>
              </div>
              <div className="border-b border-gray-100 pb-4">
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                  <div className="lg:col-span-1">
                    <span className="text-sm font-medium text-gray-900">Parent Information:</span>
                  </div>
                  <div className="lg:col-span-3">
                    <ParentJobInfo jobRecord={record} />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// Component to handle different types of values
interface ValueDisplayProps {
  value: unknown
  fieldName: string
  promptData?: { id: string, content: string } | null
  isLoadingPrompt?: boolean
}

function ValueDisplay({ value, fieldName, promptData, isLoadingPrompt }: ValueDisplayProps) {
  if (value === null || value === undefined) {
    return <span className="text-gray-400 italic">null</span>
  }

  // Fields that should be rendered as markdown
  const markdownFields = [
    'input_prompt', 
    'output', 
    'content', 
    'prompt', 
    'description',
    'message',
    'summary',
    'notes',
    'instructions'
  ]

  // Check if this field should be rendered as markdown
  const shouldRenderAsMarkdown = typeof value === 'string' && 
    markdownFields.includes(fieldName.toLowerCase()) &&
    value.length > 100 && // Only use markdown for longer content
    (value.includes('\n') || value.includes('**') || value.includes('#') || value.includes('*'))

  if (shouldRenderAsMarkdown) {
    return <MarkdownField content={value} />
  }
  
  if (typeof value === 'boolean') {
    return (
      <span className={`inline-flex items-center px-2 py-1 rounded text-xs ${
        value 
          ? 'text-green-600 bg-green-50 border border-green-200' 
          : 'text-red-600 bg-red-50 border border-red-200'
      }`}>
        {value ? '✓ true' : '✗ false'}
      </span>
    )
  }

  if (typeof value === 'number') {
    return (
      <span className="font-mono text-sm">
        {value.toLocaleString()}
      </span>
    )
  }

  if (typeof value === 'string') {
    // Check if it's a stringified JSON object first
    if (value.trim().startsWith('{') && value.trim().endsWith('}') || 
        value.trim().startsWith('[') && value.trim().endsWith(']')) {
      try {
        const parsed = JSON.parse(value)
        // If parsing succeeds, recursively display the parsed object/array
        return (
          <div className="space-y-2">
            <div className="text-xs text-gray-500">Parsed JSON ({typeof parsed === 'object' && Array.isArray(parsed) ? 'Array' : 'Object'})</div>
            <ValueDisplay value={parsed} fieldName={fieldName} />
          </div>
        )
      } catch {
        // If parsing fails, continue with string handling below
      }
    }

    // Handle prompt_ref specially for job_definitions
    if (fieldName === 'prompt_ref') {
      if (isLoadingPrompt) {
        return <div className="text-sm text-gray-500">Loading prompt...</div>
      }
      if (promptData) {
        return (
          <div className="space-y-3">
            <div className="text-sm">
              <Link 
                href={`/prompt_library/${promptData.id}`}
                className="text-blue-600 hover:text-blue-800 underline font-mono"
              >
                {value}
              </Link>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-medium text-blue-900 mb-2">Resolved Prompt Content:</h4>
              <div className="text-sm text-blue-800 whitespace-pre-wrap">
                {promptData.content}
              </div>
            </div>
          </div>
        )
      }
      return <span className="text-sm font-mono">{value}</span>
    }

    // Check if it's a UUID - show as link if it's a foreign key field
    if (value.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      // Check if this is a foreign key field that should be linked
      if (fieldName.endsWith('_id') || fieldName === 'thread_id') {
        return <IdLink id={value} fieldName={fieldName} showFullId={true} />
      }
      
      return (
        <div className="font-mono text-sm break-all text-gray-700">{value}</div>
      )
    }

    // Check if it's a date string (ISO format) - improved timestamp display
    if (value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
      const date = new Date(value)
      const isValid = !isNaN(date.getTime())
      
      if (isValid) {
        return (
          <div 
            className="text-sm cursor-help" 
            title={`Technical format: ${value}`}
          >
            {date.toLocaleString('en-US', {
              weekday: 'short',
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              timeZoneName: 'short'
            })}
          </div>
        )
      }
      return <span className="text-red-600 text-sm">Invalid Date: {value}</span>
    }

    // Check if it's a URL
    if (value.match(/^https?:\/\//)) {
      return (
        <a 
          href={value} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 underline break-all"
        >
          {value}
        </a>
      )
    }

    // Check if it's an email
    if (value.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      return (
        <a 
          href={`mailto:${value}`}
          className="text-blue-600 hover:text-blue-800 underline"
        >
          {value}
        </a>
      )
    }

    // For long strings, show in a scrollable area with word count
    if (value.length > 200) {
      const wordCount = value.split(/\s+/).length
      return (
        <div className="space-y-2">
          <div className="text-xs text-gray-500">
            {value.length} characters, ~{wordCount} words
          </div>
          <div className="max-h-32 overflow-auto bg-muted p-3 rounded border text-sm">
            {value}
          </div>
        </div>
      )
    }

    return <span className="break-words text-sm">{value}</span>
  }

  // Handle arrays - show by default
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-gray-400 italic text-sm">Empty array</span>
    }

    return (
      <div className="space-y-2">
        <div className="text-xs text-gray-500">Array ({value.length} items)</div>
        <div className="bg-muted rounded border overflow-hidden">
          <div className="max-h-64 overflow-auto p-3">
            <ul className="space-y-1">
              {value.map((item, index) => (
                <li key={index} className="flex items-start gap-2 text-sm">
                  <span className="text-gray-400 font-mono text-xs mt-0.5">{index + 1}.</span>
                  <span className="flex-1">
                    {typeof item === 'object' ? (
                      <pre className="text-xs text-gray-600 whitespace-pre-wrap">
                        {JSON.stringify(item, null, 2)}
                      </pre>
                    ) : (
                      String(item)
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    )
  }

  // Handle objects - use table format
  if (typeof value === 'object') {
    const keys = Object.keys(value)
    if (keys.length === 0) {
      return <span className="text-gray-400 italic text-sm">Empty object</span>
    }

    return (
      <div className="space-y-2">
        <div className="text-xs text-gray-500">Object ({keys.length} properties)</div>
        <div className="bg-muted border rounded overflow-hidden">
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-700 text-xs">Property</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-700 text-xs">Value</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key, index) => (
                  <tr key={key} className={index % 2 === 0 ? 'bg-card' : 'bg-muted'}>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600 border-r border-gray-200">
                      {key}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {typeof value === 'object' && value !== null && key in value && typeof (value as Record<string, unknown>)[key] === 'object' ? (
                        <pre className="whitespace-pre-wrap text-gray-600">
                          {JSON.stringify((value as Record<string, unknown>)[key], null, 2)}
                        </pre>
                      ) : (
                        String(typeof value === 'object' && value !== null && key in value ? (value as Record<string, unknown>)[key] : '')
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  return <span className="font-mono text-sm">{String(value)}</span>
}

function CreatedRecords({ jobExecutionId }: { jobExecutionId: string }) {
  const [artifacts, setArtifacts] = useState<Array<{ id: string; topic: string; created_at: string }>>([])
  const [messages, setMessages] = useState<Array<{ id: string; content: string; created_at: string }>>([])
  const [memories, setMemories] = useState<Array<{ id: string; content: string; created_at: string }>>([])
  const [jobDefs, setJobDefs] = useState<Array<{ id: string; name: string; created_at: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    const fetchCreatedRecords = async () => {
      setLoading(true)
      setError(null)

      try {
        // Fetch artifacts created by this job execution
        const { data: artifactsData } = await supabase
          .from('artifacts')
          .select('id, topic, created_at')
          .eq('source_job_id', jobExecutionId)
          .order('created_at', { ascending: false })
          .limit(5)

        // Fetch messages created by this job execution
        const { data: messagesData } = await supabase
          .from('messages')
          .select('id, content, created_at')
          .eq('source_job_id', jobExecutionId)
          .order('created_at', { ascending: false })
          .limit(5)

        // Fetch memories created by this job execution
        const { data: memoriesData } = await supabase
          .from('memories')
          .select('id, content, created_at')
          .eq('source_job_id', jobExecutionId)
          .order('created_at', { ascending: false })
          .limit(5)

        // Fetch job definitions created by this job execution
        const { data: jobDefsData } = await supabase
          .from('jobs')
          .select('id, name, created_at')
          .eq('source_job_id', jobExecutionId)
          .order('created_at', { ascending: false })
          .limit(5)

        setArtifacts(artifactsData || [])
        setMessages(messagesData || [])
        setMemories(memoriesData || [])
        setJobDefs(jobDefsData || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetchCreatedRecords()
  }, [jobExecutionId])

  if (loading) return <div className="p-3 text-sm text-gray-500">Loading created records...</div>
  if (error) return <div className="p-3 text-sm text-red-500">Error: {error}</div>

  const hasRecords = artifacts.length > 0 || messages.length > 0 || memories.length > 0 || jobDefs.length > 0

  if (!hasRecords) {
    return <div className="p-3 text-sm text-gray-500">No records created during this execution</div>
  }

  return (
    <div className="p-3 bg-white">
      <div className="text-sm font-medium text-gray-900 mb-3">Created Records:</div>
      <div className="space-y-3">
        {/* Artifacts */}
        {artifacts.length > 0 && (
          <div>
            <div className="text-xs font-medium text-gray-700 mb-1">Artifacts ({artifacts.length}):</div>
            <div className="space-y-1">
              {artifacts.map((artifact) => (
                <div key={artifact.id} className="flex items-center justify-between text-xs bg-yellow-50 p-2 rounded">
                  <span className="truncate">{artifact.topic}</span>
                  <IdLink id={artifact.id} collection="artifacts" className="text-xs text-yellow-600 hover:underline" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.length > 0 && (
          <div>
            <div className="text-xs font-medium text-gray-700 mb-1">Messages ({messages.length}):</div>
            <div className="space-y-1">
              {messages.map((message) => (
                <div key={message.id} className="flex items-center justify-between text-xs bg-blue-50 p-2 rounded">
                  <span className="truncate max-w-xs">{message.content}</span>
                  <IdLink id={message.id} collection="messages" className="text-xs text-blue-600 hover:underline" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Memories */}
        {memories.length > 0 && (
          <div>
            <div className="text-xs font-medium text-gray-700 mb-1">Memories ({memories.length}):</div>
            <div className="space-y-1">
              {memories.map((memory) => (
                <div key={memory.id} className="flex items-center justify-between text-xs bg-green-50 p-2 rounded">
                  <div className="truncate max-w-xs">{memory.content}</div>
                  <IdLink id={memory.id} collection="memories" className="text-xs text-green-600 hover:underline" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Job Definitions */}
        {jobDefs.length > 0 && (
          <div>
            <div className="text-xs font-medium text-gray-700 mb-1">Job Definitions ({jobDefs.length}):</div>
            <div className="space-y-1">
              {jobDefs.map((jobDef) => (
                <div key={jobDef.id} className="flex items-center justify-between text-xs bg-purple-50 p-2 rounded">
                  <span className="truncate">{jobDef.name}</span>
                  <IdLink id={jobDef.id} collection="jobs" className="text-xs text-purple-600 hover:underline" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function JobExecutions({ jobDefinitionId }: { jobDefinitionId: string }) {
  const [runs, setRuns] = useState<Array<{
    id: string;
    job_name: string;
    status: string;
    created_at: string;
    job_report_id?: string | null;
    source_event_id?: string | null;
  }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    const fetchRuns = async () => {
      setLoading(true)
      setError(null)
      const { data, error } = await supabase
        .from('job_board')
        .select('id, job_name, status, created_at, job_report_id, source_event_id')
        .eq('job_definition_id', jobDefinitionId)
        .order('created_at', { ascending: false })
        .limit(10)

      if (error) {
        setError(error.message)
      } else {
        setRuns(data || [])
      }
      setLoading(false)
    }

    fetchRuns()
  }, [jobDefinitionId])

  if (loading) return <div className="text-sm text-gray-500">Loading executions...</div>
  if (error) return <div className="text-sm text-red-500">Error: {error}</div>
  if (runs.length === 0) return <div className="text-sm text-gray-500">No executions found</div>

  return (
    <div className="space-y-3">
      {runs.map((run) => (
        <div key={run.id} className="border rounded-lg overflow-hidden">
          {/* Job Execution Header */}
          <div className="flex items-center justify-between p-3 bg-gray-50 border-b">
            <div className="flex-1">
              <div className="font-medium text-sm">{run.job_name}</div>
              <div className="text-xs text-gray-600">
                {new Date(run.created_at).toLocaleString()}
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <span className={`px-2 py-1 text-xs rounded ${
                run.status === 'COMPLETED' ? 'bg-green-100 text-green-800' :
                run.status === 'FAILED' ? 'bg-red-100 text-red-800' :
                run.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-800' :
                'bg-gray-100 text-gray-800'
              }`}>
                {run.status}
              </span>
              <div className="flex space-x-1">
                <IdLink id={run.id} collection="job_board" className="text-xs text-blue-600 hover:underline" />
                {run.job_report_id && (
                  <IdLink id={run.job_report_id} collection="job_reports" className="text-xs text-green-600 hover:underline" />
                )}
                {run.source_event_id && (
                  <IdLink id={run.source_event_id} collection="events" className="text-xs text-purple-600 hover:underline" />
                )}
              </div>
            </div>
          </div>
          
          {/* Created Records Section */}
          <CreatedRecords jobExecutionId={run.id} />
        </div>
      ))}
    </div>
  )
}

function ChildJobs({ jobDefinitionId }: { jobDefinitionId: string }) {
  const [children, setChildren] = useState<Array<{
    id: string;
    name: string;
    description?: string | null;
    created_at: string;
    is_active: boolean;
  }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    const fetchChildren = async () => {
      setLoading(true)
      setError(null)
      const { data, error } = await supabase
        .from('jobs')
        .select('id, name, description, created_at, is_active')
        .eq('parent_job_definition_id', jobDefinitionId)
        .order('created_at', { ascending: false })
        .limit(10)

      if (error) {
        setError(error.message)
      } else {
        setChildren(data || [])
      }
      setLoading(false)
    }

    fetchChildren()
  }, [jobDefinitionId])

  if (loading) return <div className="text-sm text-gray-500">Loading child jobs...</div>
  if (error) return <div className="text-sm text-red-500">Error: {error}</div>
  if (children.length === 0) return <div className="text-sm text-gray-500">No child jobs found</div>

  return (
    <div className="space-y-2">
      {children.map((child) => (
        <div key={child.id} className="flex items-center justify-between p-2 bg-blue-50 rounded border">
          <div className="flex-1">
            <div className="font-medium text-sm">{child.name}</div>
            {child.description && (
              <div className="text-xs text-gray-600 mt-1">{child.description}</div>
            )}
            <div className="text-xs text-gray-600">
              {new Date(child.created_at).toLocaleString()}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <span className={`px-2 py-1 text-xs rounded ${
              child.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
            }`}>
              {child.is_active ? 'Active' : 'Inactive'}
            </span>
            <IdLink id={child.id} collection="jobs" className="text-xs text-blue-600 hover:underline" />
          </div>
        </div>
      ))}
    </div>
  )
}

function ParentJobInfo({ jobRecord }: { jobRecord: DbRecord }) {
  const [parentJobDef, setParentJobDef] = useState<{
    id: string;
    name: string;
    description?: string | null;
    is_active: boolean;
  } | null>(null)
  const [parentJobExec, setParentJobExec] = useState<{
    id: string;
    job_name: string;
    status: string;
    created_at: string;
    job_report_id?: string | null;
    source_event_id?: string | null;
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    const fetchParentInfo = async () => {
      setLoading(true)
      setError(null)

      try {
        // Fetch parent job definition if parent_job_definition_id exists
        if (jobRecord.parent_job_definition_id) {
          const { data: jobDefData } = await supabase
            .from('jobs')
            .select('id, name, description, is_active')
            .eq('id', jobRecord.parent_job_definition_id)
            .single()
          
          if (jobDefData) {
            setParentJobDef(jobDefData)
          }
        }

        // Fetch parent job execution if source_job_id exists
        if (jobRecord.source_job_id) {
          const { data: jobExecData } = await supabase
            .from('job_board')
            .select('id, job_name, status, created_at, job_report_id, source_event_id')
            .eq('id', jobRecord.source_job_id)
            .single()
          
          if (jobExecData) {
            setParentJobExec(jobExecData)
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetchParentInfo()
  }, [jobRecord.parent_job_definition_id, jobRecord.source_job_id])

  if (loading) return <div className="text-sm text-gray-500">Loading parent information...</div>
  if (error) return <div className="text-sm text-red-500">Error: {error}</div>

  return (
    <div className="space-y-3">
      {/* Parent Job Definition */}
      {parentJobDef && (
        <div className="p-3 bg-green-50 rounded border">
          <div className="text-sm font-medium text-green-900 mb-2">Parent Job Definition:</div>
          <div className="space-y-1">
            <div className="text-sm">
              <span className="font-medium">Name:</span> {parentJobDef.name}
            </div>
            {parentJobDef.description && (
              <div className="text-sm">
                <span className="font-medium">Description:</span> {parentJobDef.description}
              </div>
            )}
            <div className="text-sm">
              <span className="font-medium">Status:</span> 
              <span className={`ml-1 px-2 py-1 text-xs rounded ${
                parentJobDef.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
              }`}>
                {parentJobDef.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div className="text-sm">
              <span className="font-medium">View:</span> 
              <IdLink id={parentJobDef.id} collection="jobs" className="ml-1 text-xs text-green-600 hover:underline" />
            </div>
          </div>
        </div>
      )}

      {/* Parent Job Execution */}
      {parentJobExec && (
        <div className="p-3 bg-purple-50 rounded border">
          <div className="text-sm font-medium text-purple-900 mb-2">Parent Job Execution:</div>
          <div className="space-y-1">
            <div className="text-sm">
              <span className="font-medium">Name:</span> {parentJobExec.job_name}
            </div>
            <div className="text-sm">
              <span className="font-medium">Status:</span> 
              <span className={`ml-1 px-2 py-1 text-xs rounded ${
                parentJobExec.status === 'COMPLETED' ? 'bg-green-100 text-green-800' :
                parentJobExec.status === 'FAILED' ? 'bg-red-100 text-red-800' :
                parentJobExec.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-800' :
                'bg-gray-100 text-gray-800'
              }`}>
                {parentJobExec.status}
              </span>
            </div>
            <div className="text-sm">
              <span className="font-medium">Created:</span> {new Date(parentJobExec.created_at).toLocaleString()}
            </div>
            <div className="text-sm">
              <span className="font-medium">View:</span> 
              <IdLink id={parentJobExec.id} collection="job_board" className="ml-1 text-xs text-purple-600 hover:underline" />
              {parentJobExec.job_report_id && (
                <>
                  <span className="mx-2">•</span>
                  <IdLink id={parentJobExec.job_report_id} collection="job_reports" className="text-xs text-green-600 hover:underline" />
                </>
              )}
              {parentJobExec.source_event_id && (
                <>
                  <span className="mx-2">•</span>
                  <IdLink id={parentJobExec.source_event_id} collection="events" className="text-xs text-blue-600 hover:underline" />
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {!parentJobDef && !parentJobExec && (
        <div className="text-sm text-gray-500">No parent information found</div>
      )}
    </div>
  )
}