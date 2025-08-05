'use client'

import Link from 'next/link'
import { DbRecord, CollectionName } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase'
import { useState, useEffect } from 'react'
import { MarkdownField } from '@/components/markdown-field'
import { IdLink } from '@/components/id-link'

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

  // Fetch prompt content if this is a job_definition with prompt_ref
  useEffect(() => {
    if (collectionName === 'job_definitions' && record.prompt_ref) {
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
  }, [collectionName, record.prompt_ref])
  
  // If no record, return null
  if (!record) {
    return null
  }

  // Fields to hide from the detail view
  const hiddenFields = ['worker_id']
  
  // Filter out hidden fields
  const visibleFields = Object.entries(record).filter(([key]) => 
    !hiddenFields.includes(key)
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record Details</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {visibleFields.map(([key, value]) => (
            <div key={key} className="border-b border-gray-100 pb-4 last:border-b-0 last:pb-0">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="font-medium text-gray-900" title={`Field: ${key}`}>
                  {humanizeFieldName(key)}:
                </div>
                <div className="md:col-span-3">
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
        </div>
      </CardContent>
    </Card>
  )
}

// Component to handle different types of values
interface ValueDisplayProps {
  value: any
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
      } catch (e) {
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
          <div className="max-h-32 overflow-auto bg-gray-50 p-3 rounded border text-sm">
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

  // Handle objects - use table format
  if (typeof value === 'object') {
    const keys = Object.keys(value)
    if (keys.length === 0) {
      return <span className="text-gray-400 italic text-sm">Empty object</span>
    }

    return (
      <div className="space-y-2">
        <div className="text-xs text-gray-500">Object ({keys.length} properties)</div>
        <div className="bg-gray-50 border rounded overflow-hidden">
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
                  <tr key={key} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-25'}>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600 border-r border-gray-200">
                      {key}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {typeof value[key] === 'object' ? (
                        <pre className="whitespace-pre-wrap text-gray-600">
                          {JSON.stringify(value[key], null, 2)}
                        </pre>
                      ) : (
                        String(value[key])
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