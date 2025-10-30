'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import { CheckCircle2, XCircle } from 'lucide-react'

interface RecognitionData {
  searchQuery?: string
  similarJobs?: Array<{
    requestId: string
    score: number
    jobName?: string
  }>
  learnings: string | object[]
  timestamp?: string
  initialSituation?: Record<string, unknown>
  embeddingStatus?: 'success' | 'failed' | 'unknown'
}

export interface RecognitionPhaseCardProps {
  recognitionData: RecognitionData | null
  hasRecognition: boolean
}

export function RecognitionPhaseCard({ recognitionData }: RecognitionPhaseCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Recognition Phase
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Initial Situation Section */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h4 className="text-sm font-semibold text-gray-700">Initial Situation (Vector Search Context)</h4>
            {recognitionData?.embeddingStatus && (
              <Badge 
                variant={recognitionData.embeddingStatus === 'success' ? 'default' : 'destructive'}
                className="text-xs"
              >
                {recognitionData.embeddingStatus === 'success' ? (
                  <><CheckCircle2 className="w-3 h-3 mr-1" /> Embedding Created</>
                ) : (
                  <><XCircle className="w-3 h-3 mr-1" /> Embedding Failed</>
                )}
              </Badge>
            )}
          </div>
          {recognitionData?.initialSituation ? (
            <>
              <div className="bg-gray-50 p-3 rounded border border-gray-200">
                <pre className="text-xs overflow-auto max-h-[400px]">
                  {JSON.stringify(recognitionData.initialSituation, null, 2)}
                </pre>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                This situation artifact was created before execution and used for semantic similarity search.
              </div>
            </>
          ) : (
            <div className="text-sm text-gray-500 italic">
              No initial situation available
            </div>
          )}
        </div>

        {/* Similar Jobs Section */}
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Similar Jobs Found</h4>
          {recognitionData?.similarJobs && recognitionData.similarJobs.length > 0 ? (
            <div className="space-y-2">
              {recognitionData.similarJobs.map((job) => (
                <div key={job.requestId} className="flex items-center justify-between bg-white p-3 rounded border border-gray-200 hover:border-blue-300 transition-colors">
                  <Link
                    href={`/requests/${job.requestId}`}
                    className="text-blue-600 hover:text-blue-800 hover:underline font-medium text-sm flex-1"
                  >
                    {job.jobName || `${job.requestId.slice(0, 12)}...`}
                  </Link>
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                    {(job.score * 100).toFixed(0)}% match
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500 italic">No similar jobs found</div>
          )}
        </div>

        {/* Synthesized Learnings */}
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Synthesized Learnings</h4>
          {recognitionData?.learnings ? (
            <div className="bg-gray-50 p-4 rounded text-sm overflow-auto prose prose-sm max-w-none">
              {typeof recognitionData.learnings === 'string' ? (
                <ReactMarkdown>{recognitionData.learnings}</ReactMarkdown>
              ) : (
                <pre className="text-xs overflow-auto">
                  {JSON.stringify(recognitionData.learnings, null, 2)}
                </pre>
              )}
            </div>
          ) : (
            <div className="text-sm text-gray-500 italic">No learnings synthesized</div>
          )}
        </div>

      </CardContent>
    </Card>
  )
}
