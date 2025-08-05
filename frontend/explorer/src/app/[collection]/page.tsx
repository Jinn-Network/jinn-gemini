import { CollectionPageProps, collectionNames } from '@/lib/types'
import { CollectionView } from '@/components/collection-view'
import { notFound } from 'next/navigation'

export default async function CollectionPage({ params }: CollectionPageProps) {
  const resolvedParams = await params
  
  // Validate that the collection name is valid
  if (!collectionNames.includes(resolvedParams.collection)) {
    notFound()
  }

  return <CollectionView collectionName={resolvedParams.collection} />
}