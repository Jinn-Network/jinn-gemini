import { CollectionPageProps, collectionNames } from '@/lib/types'
import { CollectionView } from '@/components/collection-view'
import { notFound } from 'next/navigation'

export default function CollectionPage({ params }: CollectionPageProps) {
  // Validate that the collection name is valid
  if (!collectionNames.includes(params.collection)) {
    notFound()
  }

  return <CollectionView collectionName={params.collection} />
}