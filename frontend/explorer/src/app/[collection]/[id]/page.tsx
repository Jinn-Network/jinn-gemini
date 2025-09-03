import { createClient } from '@/lib/supabase'
import { RecordPageProps, collectionNames, DbRecord } from '@/lib/types'
import { DetailView } from '@/components/detail-view'
import { ArtifactDetailView } from '@/components/artifact-detail-view'
import { JobReportDetailView } from '@/components/job-report-detail-view'
import { getCollectionLabel } from '@/lib/utils'
import { notFound } from 'next/navigation'
import Link from 'next/link'

// Helper function to get human-readable title from record
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getRecordTitle(record: DbRecord, _collectionName: string): string {
  // Priority order for title fields
  const titleFields = ['name', 'title', 'job_name', 'prompt', 'content', 'topic', 'subject']
  
  for (const field of titleFields) {
    if (record[field] && typeof record[field] === 'string') {
      const value = record[field] as string
      return value.length > 50 ? value.substring(0, 50) + '...' : value
    }
  }
  
  // Fallback to shortened ID
  return `${record.id.toString().substring(0, 8)}...`
}

export default async function RecordPage({ params }: RecordPageProps) {
  const resolvedParams = await params
  
  // Validate that the collection name is valid
  if (!collectionNames.includes(resolvedParams.collection)) {
    notFound()
  }

  const supabase = createClient()
  
  try {
    // Fetch data from Supabase
    const { data: record, error } = await supabase
      .from(resolvedParams.collection)
      .select('*')
      .eq('id', resolvedParams.id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        // Record not found
        notFound()
      }
      console.error('Error fetching record:', error)
      throw error
    }

    const recordTitle = getRecordTitle(record, resolvedParams.collection)
    const collectionLabel = getCollectionLabel(resolvedParams.collection)

    return (
      <div>
        <div className="mb-6">
          <Link 
            href={`/${resolvedParams.collection}`}
            className="text-blue-600 hover:text-blue-800 text-sm"
          >
            ← Back to {collectionLabel}
          </Link>
        </div>
        
        <h1 className="text-2xl font-bold mb-4" title={`Record ID: ${resolvedParams.id} in ${resolvedParams.collection}`}>
          {recordTitle}
        </h1>
        
        <>
          <p className="text-gray-600 text-sm mb-6">
            {collectionLabel}
          </p>
          
          {resolvedParams.collection === 'artifacts' ? (
            <ArtifactDetailView record={record} />
          ) : resolvedParams.collection === 'job_reports' ? (
            <JobReportDetailView record={record} />
          ) : (
            <DetailView record={record} collectionName={resolvedParams.collection} />
          )}
        </>
      </div>
    )
  } catch (error) {
    return (
      <div className="p-4">
        <div className="mb-6">
          <Link 
            href={`/${resolvedParams.collection}`}
            className="text-blue-600 hover:text-blue-800 text-sm"
          >
            ← Back to {getCollectionLabel(resolvedParams.collection)}
          </Link>
        </div>
        
        <h1 className="text-2xl font-bold mb-4 text-red-600">
          Error loading record
        </h1>
        <p className="text-gray-600">
          Unable to fetch record {resolvedParams.id} from the {resolvedParams.collection} table. 
          Please check your database connection and try again.
        </p>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-gray-500">
            Error details
          </summary>
          <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-auto">
            {error instanceof Error ? error.message : 'Unknown error'}
          </pre>
        </details>
      </div>
    )
  }
}