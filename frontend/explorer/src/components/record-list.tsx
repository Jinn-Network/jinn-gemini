import React from 'react'
import Link from 'next/link'
import { DbRecord, CollectionName } from '@/lib/types'
import { IdLink } from '@/components/id-link'

interface RecordListProps {
  records: DbRecord[]
  collectionName: CollectionName
}

// Helper function to format timestamps
function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return dateString
  }
}

// Helper function to get the primary identifier for a record
function getPrimaryIdentifier(record: DbRecord): string {
  // Priority order for identifying fields
  const identifierFields = ['name', 'title', 'job_name', 'prompt', 'content', 'topic', 'id']
  
  for (const field of identifierFields) {
    if (record[field] && typeof record[field] === 'string') {
      const value = record[field] as string
      // Truncate long identifiers
      return value.length > 80 ? value.substring(0, 80) + '...' : value
    }
  }
  
  return record.id.toString()
}

// Helper function to get status display
function getStatusDisplay(record: DbRecord): { status: string; className: string } | null {
  if (record.status) {
    const status = record.status.toString().toUpperCase()
    let className = ''
    
    switch (status) {
      case 'COMPLETED':
        className = 'text-green-600 bg-green-50 border-green-200'
        break
      case 'FAILED':
        className = 'text-red-600 bg-red-50 border-red-200'
        break
      case 'IN_PROGRESS':
        className = 'text-blue-600 bg-blue-50 border-blue-200'
        break
      case 'PENDING':
        className = 'text-yellow-600 bg-yellow-50 border-yellow-200'
        break
      default:
        className = 'text-gray-600 bg-gray-50 border-gray-200'
    }
    
    return { status, className }
  }
  
  return null
}

// Helper function to get secondary information based on collection type
function getSecondaryInfo(record: DbRecord, collectionName: CollectionName): React.ReactNode[] {
  const info: React.ReactNode[] = []
  
  switch (collectionName) {
    case 'job_board':
      if (record.job_definition_id) {
        info.push(
          <span key="job_def">
            Job Definition: <IdLink id={record.job_definition_id} fieldName="job_definition_id" />
          </span>
        )
      }
      if (record.job_report_id) {
        info.push(
          <span key="job_report">
            Report: <IdLink id={record.job_report_id} fieldName="job_report_id" />
          </span>
        )
      }
      break
    case 'job_definitions':
      if (record.trigger) info.push(`Trigger: ${record.trigger}`)
      if (record.enabled !== undefined) info.push(`${record.enabled ? 'Enabled' : 'Disabled'}`)
      break
    case 'job_schedules':
      if (record.job_definition_id) {
        info.push(
          <span key="job_def">
            Job Definition: <IdLink id={record.job_definition_id} fieldName="job_definition_id" />
          </span>
        )
      }
      break
    case 'prompt_library':
      if (record.version) info.push(`v${record.version}`)
      if (record.is_active !== undefined) info.push(`${record.is_active ? 'Active' : 'Inactive'}`)
      break
    case 'threads':
      if (record.parent_thread_id) {
        info.push(
          <span key="parent">
            Parent: <IdLink id={record.parent_thread_id} fieldName="parent_thread_id" />
          </span>
        )
      }
      if (record.status) info.push(`Status: ${record.status}`)
      break
    case 'artifacts':
      if (record.topic) info.push(`Topic: ${record.topic}`)
      if (record.thread_id) {
        info.push(
          <span key="thread">
            Thread: <IdLink id={record.thread_id} fieldName="thread_id" />
          </span>
        )
      }
      break
    case 'memories':
      if (record.content) {
        const content = record.content.toString()
        info.push(content.length > 100 ? content.substring(0, 100) + '...' : content)
      }
      break
    case 'messages':
      if (record.sender) info.push(`From: ${record.sender}`)
      if (record.receiver) info.push(`To: ${record.receiver}`)
      break
    case 'job_reports':
      if (record.job_id) {
        info.push(
          <span key="job">
            Job: <IdLink id={record.job_id} fieldName="job_id" />
          </span>
        )
      }
      if (record.status) info.push(`Status: ${record.status}`)
      break
  }
  
  return info
}

export function RecordList({ records, collectionName }: RecordListProps) {
  if (records.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No records found
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {records.map((record) => {
        const primaryId = getPrimaryIdentifier(record)
        const statusDisplay = getStatusDisplay(record)
        const secondaryInfo = getSecondaryInfo(record, collectionName)
        
        return (
          <div key={record.id} className="bg-white border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
            <div className="flex items-start justify-between gap-4">
              {/* Main content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  <Link 
                    href={`/${collectionName}/${record.id}`}
                    className="text-blue-600 hover:text-blue-800 hover:underline font-medium truncate"
                  >
                    {primaryId}
                  </Link>
                  
                  {statusDisplay && (
                    <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs border ${statusDisplay.className}`}>
                      {statusDisplay.status}
                    </span>
                  )}
                </div>
                
                {secondaryInfo.length > 0 && (
                  <div className="text-sm text-gray-600 space-y-1">
                    {secondaryInfo.map((info, index) => (
                      <div key={index}>{info}</div>
                    ))}
                  </div>
                )}
              </div>
              
              {/* Timestamps */}
              <div className="text-right text-sm text-gray-500 flex-shrink-0">
                {record.created_at && (
                  <div>Created: {formatDate(record.created_at)}</div>
                )}
                {record.updated_at && record.updated_at !== record.created_at && (
                  <div>Updated: {formatDate(record.updated_at)}</div>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}