'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { queryArtifacts, type Artifact } from '@/lib/subgraph'
import { TruncatedId } from '@/components/truncated-id'
import { Skeleton } from '@/components/ui/skeleton'
import { useRealtimeData } from '@/hooks/use-realtime-data'

interface JobDefinition {
  id: string
  name: string
}

interface ArtifactsProps {
  jobDefinition: JobDefinition
}

export function JobDefinitionArtifacts({ jobDefinition }: ArtifactsProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [loading, setLoading] = useState(true)

  // Real-time updates
  const { isConnected } = useRealtimeData('artifacts', { 
    enabled: true,
    onEvent: () => {
      fetchArtifacts()
    }
  })

  const fetchArtifacts = async () => {
    try {
      const artifactsResponse = await queryArtifacts({
        where: { sourceJobDefinitionId: jobDefinition.id },
        orderBy: 'blockTimestamp',
        orderDirection: 'desc',
      })
      
      setArtifacts(artifactsResponse.items)
      setLoading(false)
    } catch (error) {
      console.error('Error fetching artifacts:', error)
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchArtifacts()
  }, [jobDefinition.id])

  if (loading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>All Artifacts ({artifacts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {artifacts.length > 0 ? (
            <div className="space-y-4">
              {artifacts.map((artifact) => (
                <div key={artifact.id} className="border rounded p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="font-medium">{artifact.name}</div>
                    <Badge variant="outline">{artifact.topic}</Badge>
                  </div>
                  
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-gray-400">CID:</span>{' '}
                      <TruncatedId value={artifact.cid} />
                    </div>
                    
                    <div>
                      <span className="text-gray-400">From Request:</span>{' '}
                      <TruncatedId 
                        value={artifact.requestId} 
                        linkTo={`/requests/${artifact.requestId}`}
                      />
                    </div>
                    
                    {artifact.blockTimestamp && (
                      <div className="text-gray-500 text-xs">
                        {new Date(parseInt(artifact.blockTimestamp) * 1000).toLocaleString()}
                      </div>
                    )}
                    
                    {artifact.contentPreview && (
                      <div className="bg-gray-50 p-2 rounded text-xs mt-2">
                        {artifact.contentPreview.substring(0, 150)}
                        {artifact.contentPreview.length > 150 ? '...' : ''}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              No artifacts found for this job definition
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

