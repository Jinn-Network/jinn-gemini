import React from 'react'
import { DbRecord } from '@/lib/types'

interface SystemStateViewProps {
  records: DbRecord[]
}

// Helper function to format values for display
function formatValue(value: any): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-gray-400 italic">null</span>
  }
  
  if (typeof value === 'boolean') {
    return (
      <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs border ${
        value 
          ? 'text-green-600 bg-green-50 border-green-200' 
          : 'text-red-600 bg-red-50 border-red-200'
      }`}>
        {value ? 'true' : 'false'}
      </span>
    )
  }
  
  if (typeof value === 'number') {
    return <span className="font-mono">{value.toLocaleString()}</span>
  }
  
  if (typeof value === 'object') {
    return (
      <pre className="mt-2 p-3 bg-gray-50 rounded-md text-xs overflow-x-auto whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    )
  }
  
  if (typeof value === 'string') {
    // Check if it looks like a timestamp
    if (value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
      try {
        const date = new Date(value)
        return (
          <div>
            <div className="font-mono text-sm">{value}</div>
            <div className="text-xs text-gray-500 mt-1">
              {date.toLocaleString()}
            </div>
          </div>
        )
      } catch {
        // If date parsing fails, treat as regular string
      }
    }
    
    // Show all text content without truncation
    return <div className="whitespace-pre-wrap break-words">{value}</div>
  }
  
  return <div className="font-mono">{String(value)}</div>
}

// Helper function to convert snake_case and other formats to human-readable titles
function humanizeTitle(title: string): string {
  return title
    .split('_') // Split on underscores
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()) // Capitalize each word
    .join(' ') // Join with spaces
}

// Helper function to get the key name from a system_state record
function getKeyName(record: DbRecord): string {
  // Common field names that might contain the key
  const keyFields = ['key', 'name', 'setting_name', 'config_key', 'parameter']
  
  for (const field of keyFields) {
    if (record[field] && typeof record[field] === 'string') {
      return humanizeTitle(record[field] as string)
    }
  }
  
  // Fallback to the record ID
  return humanizeTitle(record.id.toString())
}

// Helper function to get the value from a system_state record
function getValue(record: DbRecord): any {
  // Common field names that might contain the value
  const valueFields = ['value', 'setting_value', 'config_value', 'data', 'content']
  
  for (const field of valueFields) {
    if (record.hasOwnProperty(field)) {
      return record[field]
    }
  }
  
  // If no standard value field found, return the entire record except system fields
  const excludeFields = ['id', 'created_at', 'updated_at', 'key', 'name', 'setting_name', 'config_key', 'parameter']
  const filteredRecord: any = {}
  
  Object.keys(record).forEach(key => {
    if (!excludeFields.includes(key)) {
      filteredRecord[key] = record[key]
    }
  })
  
  return Object.keys(filteredRecord).length === 1 
    ? Object.values(filteredRecord)[0]
    : filteredRecord
}

export function SystemStateView({ records }: SystemStateViewProps) {
  if (records.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No system state records found
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {records.map((record) => {
        const keyName = getKeyName(record)
        const value = getValue(record)
        
        return (
          <div key={record.id} className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 break-words">
                {keyName}
              </h3>
              {(record.updated_at || record.created_at) && (
                <div className="text-sm text-gray-500 flex-shrink-0 ml-4">
                  {record.updated_at ? 'Updated' : 'Created'}: {new Date(record.updated_at || record.created_at).toLocaleString()}
                </div>
              )}
            </div>
            
            <div className="text-gray-700">
              {formatValue(value)}
            </div>
          </div>
        )
      })}
    </div>
  )
}