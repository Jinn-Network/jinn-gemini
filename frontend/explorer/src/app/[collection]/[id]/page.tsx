import { RecordPageProps, collectionNames } from '@/lib/types'
import { SubgraphDetailView } from '@/components/subgraph-detail-view'
import { getCollectionLabel } from '@/lib/utils'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { 
  getJobDefinition, 
  getRequest, 
  getDelivery, 
  getArtifact,
  JobDefinition,
  Request,
  Delivery,
  Artifact
} from '@/lib/subgraph'

type SubgraphRecord = JobDefinition | Request | Delivery | Artifact

// Helper function to get human-readable title from record
function getRecordTitle(record: SubgraphRecord, collectionName: string): string {
  // Job definitions have names
  if ('name' in record && record.name) {
    return record.name.length > 50 ? record.name.substring(0, 50) + '...' : record.name
  }
  
  // Requests can have job names
  if ('jobName' in record && record.jobName) {
    return record.jobName.length > 50 ? record.jobName.substring(0, 50) + '...' : record.jobName
  }
  
  // Artifacts have topics
  if ('topic' in record && record.topic) {
    return record.topic.length > 50 ? record.topic.substring(0, 50) + '...' : record.topic
  }
  
  // Fallback to collection name + shortened ID
  return `${collectionName.slice(0, -1)} ${record.id.toString().substring(0, 8)}...`
}

async function fetchRecord(collection: string, id: string): Promise<SubgraphRecord | null> {
  switch (collection) {
    case 'jobDefinitions':
      return await getJobDefinition(id)
    case 'requests':
      return await getRequest(id)
    case 'deliveries':
      return await getDelivery(id)
    case 'artifacts':
      return await getArtifact(id)
    default:
      return null
  }
}

export default async function RecordPage({ params }: RecordPageProps) {
  const resolvedParams = await params
  
  // Validate that the collection name is valid
  if (!collectionNames.includes(resolvedParams.collection)) {
    notFound()
  }
  
  // Decode the ID parameter (e.g., %3A -> :)
  const decodedId = decodeURIComponent(resolvedParams.id)
  const collectionLabel = getCollectionLabel(resolvedParams.collection)
  
  try {
    // Fetch data from subgraph
    const record = await fetchRecord(resolvedParams.collection, decodedId)

    if (!record) {
      notFound()
    }

    const recordTitle = getRecordTitle(record, resolvedParams.collection)

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
        
        <h1 className="text-2xl font-bold mb-4" title={`Record ID: ${decodedId} in ${resolvedParams.collection}`}>
          {recordTitle}
        </h1>
        
        <>
          <p className="text-gray-600 text-sm mb-6">
            {collectionLabel}
          </p>
          
          <SubgraphDetailView record={record} collectionName={resolvedParams.collection} />
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
            ← Back to {collectionLabel}
          </Link>
        </div>
        
        <h1 className="text-2xl font-bold mb-4 text-red-600">
          Error loading record
        </h1>
        <p className="text-gray-600">
          Unable to fetch record {decodedId} from the {resolvedParams.collection} collection. 
          Please check the subgraph connection and try again.
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