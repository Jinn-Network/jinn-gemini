import { createClient } from '@/lib/supabase'
import { RecordPageProps, collectionNames } from '@/lib/types'
import { DetailView } from '@/components/detail-view'
import { ArtifactDetailView } from '@/components/artifact-detail-view'
import { ThreadCitations } from '@/components/thread-citations'
import { getCollectionLabel } from '@/lib/utils'
import { notFound } from 'next/navigation'
import Link from 'next/link'

// Helper function to get human-readable title from record
function getRecordTitle(record: any, collectionName: string): string {
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
  // Validate that the collection name is valid
  if (!collectionNames.includes(params.collection)) {
    notFound()
  }

  const supabase = createClient()
  
  try {
    // Fetch data from Supabase
    const { data: record, error } = await supabase
      .from(params.collection)
      .select('*')
      .eq('id', params.id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        // Record not found
        notFound()
      }
      console.error('Error fetching record:', error)
      throw error
    }

    const recordTitle = getRecordTitle(record, params.collection)
    const collectionLabel = getCollectionLabel(params.collection)

    return (
      <div>
        <div className="mb-6">
          <Link 
            href={`/${params.collection}`}
            className="text-blue-600 hover:text-blue-800 text-sm"
          >
            ← Back to {collectionLabel}
          </Link>
        </div>
        
        <h1 className="text-2xl font-bold mb-4" title={`Record ID: ${params.id} in ${params.collection}`}>
          {recordTitle}
        </h1>
        <p className="text-gray-600 text-sm mb-6">
          {collectionLabel}
        </p>
        
        {params.collection === 'artifacts' ? (
          <ArtifactDetailView record={record} />
        ) : (
          <DetailView record={record} collectionName={params.collection} />
        )}
        
        {/* Show citations for threads */}
        {params.collection === 'threads' && (
          <div className="mt-8">
            <ThreadCitations threadId={params.id} />
          </div>
        )}
      </div>
    )
  } catch (error) {
    return (
      <div className="p-4">
        <div className="mb-6">
          <Link 
            href={`/${params.collection}`}
            className="text-blue-600 hover:text-blue-800 text-sm"
          >
            ← Back to {getCollectionLabel(params.collection)}
          </Link>
        </div>
        
        <h1 className="text-2xl font-bold mb-4 text-red-600">
          Error loading record
        </h1>
        <p className="text-gray-600">
          Unable to fetch record {params.id} from the {params.collection} table. 
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