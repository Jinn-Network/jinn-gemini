import Link from 'next/link'
import React from 'react'

interface IdLinkProps {
  id: string | null | undefined
  fieldName: string
  className?: string
  showFullId?: boolean
}

// Mapping of field names to their corresponding collection names
const fieldToCollectionMap: Record<string, string> = {
  'job_definition_id': 'job_definitions',
  'job_report_id': 'job_reports', 
  'job_id': 'job_board',
  'parent_thread_id': 'threads',
  'thread_id': 'threads',
}

// Helper function to truncate UUID for display
function truncateId(id: string, showFull: boolean = false): string {
  if (showFull || id.length <= 12) {
    return id
  }
  return `${id.substring(0, 8)}...`
}

export function IdLink({ id, fieldName, className = '', showFullId = false }: IdLinkProps) {
  // If no ID, return null
  if (!id) {
    return <span className="text-gray-400 italic">null</span>
  }

  // Get the target collection from the field name
  const targetCollection = fieldToCollectionMap[fieldName]
  
  // If we don't know where this field should link, just display the ID
  if (!targetCollection) {
    return (
      <span className={`font-mono text-sm text-gray-700 ${className}`} title={id}>
        {truncateId(id, showFullId)}
      </span>
    )
  }

  // Create the link
  return (
    <Link 
      href={`/${targetCollection}/${id}`}
      className={`text-blue-600 hover:text-blue-800 underline font-mono text-sm ${className}`}
      title={`Go to ${targetCollection}: ${id}`}
    >
      {truncateId(id, showFullId)}
    </Link>
  )
}