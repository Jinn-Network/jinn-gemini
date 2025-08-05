'use client'

import { DbRecord } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { IdLink } from '@/components/id-link'
import { JobCreationInfo } from '@/components/job-creation-info'

interface ArtifactDetailViewProps {
  record: DbRecord
}

// Function to convert field names to human-readable labels
function humanizeFieldName(fieldName: string): string {
  return fieldName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

// Component to handle different types of values (simplified version of the one in detail-view)
function ValueDisplay({ value, fieldName }: { value: unknown; fieldName: string }) {
  if (value === null || value === undefined) {
    return <span className="text-gray-400 italic">null</span>
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

    // Check if it's a date string (ISO format)
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

    // For long strings, show in a scrollable area with word count
    if (value.length > 200) {
      const wordCount = value.split(/\s+/).length
      return (
        <div className="space-y-2">
          <div className="text-xs text-gray-500">
            {value.length} characters, ~{wordCount} words
          </div>
          <div className="max-h-32 overflow-auto bg-gray-50 p-3 rounded border text-sm">
            {value}
          </div>
        </div>
      )
    }

    return <span className="break-words text-sm">{value}</span>
  }

  // Handle arrays
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-gray-400 italic text-sm">Empty array</span>
    }

    return (
      <div className="space-y-2">
        <div className="text-xs text-gray-500">Array ({value.length} items)</div>
        <div className="bg-gray-50 rounded border overflow-hidden">
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

  // Handle objects
  if (typeof value === 'object') {
    const keys = Object.keys(value)
    if (keys.length === 0) {
      return <span className="text-gray-400 italic text-sm">Empty object</span>
    }

    return (
      <div className="space-y-2">
        <div className="text-xs text-gray-500">Object ({keys.length} properties)</div>
        <div className="bg-gray-50 border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-gray-700 text-xs">Property</th>
                <th className="text-left px-3 py-2 font-medium text-gray-700 text-xs">Value</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key, index) => (
                <tr key={key} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-25'}>
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
    )
  }

  return <span className="font-mono text-sm">{String(value)}</span>
}

export function ArtifactDetailView({ record }: ArtifactDetailViewProps) {
  if (!record) {
    return null
  }

  // Extract content, job tracking, and other fields
  const { content, created_by_job_id, ...otherFields } = record
  
  // Fields to hide from the detail view (now including created_by_job_id since we show it separately)
  const hiddenFields = ['worker_id', 'created_by_job_id']
  
  // Filter out hidden fields from other fields
  const visibleOtherFields = Object.entries(otherFields).filter(([key]) => 
    !hiddenFields.includes(key)
  )

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Main Content Card */}
      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Content</CardTitle>
          </CardHeader>
          <CardContent>
            <ValueDisplay value={content} fieldName="content" />
          </CardContent>
        </Card>
      </div>

      {/* Details Sidebar */}
      <div className="lg:col-span-1 space-y-6">
        {/* Job Creation Info */}
        <Card>
          <CardHeader>
            <CardTitle>Job Creation</CardTitle>
          </CardHeader>
          <CardContent>
            <JobCreationInfo jobId={created_by_job_id as string} />
          </CardContent>
        </Card>

        {/* Other Details */}
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {visibleOtherFields.map(([key, value]) => (
                <div key={key} className="border-b border-gray-100 pb-3 last:border-b-0 last:pb-0">
                  <div className="font-medium text-gray-900 text-sm mb-1" title={`Field: ${key}`}>
                    {humanizeFieldName(key)}:
                  </div>
                  <div>
                    <ValueDisplay value={value} fieldName={key} />
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