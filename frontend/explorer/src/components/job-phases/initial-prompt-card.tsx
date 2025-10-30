'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useEffect, useState } from 'react'

interface InitialPromptCardProps {
  requestId: string
  jobName?: string
  ipfsHash?: string
  enabledTools?: string[]
}

interface PromptData {
  objective?: string
  context?: string
  acceptanceCriteria?: string
  deliverables?: string
  constraints?: string
}

export function InitialPromptCard({ jobName, ipfsHash, enabledTools }: InitialPromptCardProps) {
  const [promptData, setPromptData] = useState<PromptData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!ipfsHash) return

    const fetchPrompt = async () => {
      try {
        setLoading(true)
        const response = await fetch(`https://gateway.autonolas.tech/ipfs/${ipfsHash}`)
        if (response.ok) {
          const data = await response.json()
          setPromptData(data)
        }
      } catch (error) {
        console.error('Error fetching prompt:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchPrompt()
  }, [ipfsHash])

  return (
    <Card className="border-blue-200 bg-blue-50/50">
      <CardHeader>
        <CardTitle className="text-xl flex items-center gap-2">
          📝 Initial Prompt
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {jobName && (
          <div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2">{jobName}</h3>
          </div>
        )}

        {loading && (
          <div className="text-sm text-gray-500">Loading prompt details...</div>
        )}

        {promptData && (
          <div className="space-y-3">
            {promptData.objective && (
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-1">Objective</h4>
                <p className="text-sm text-gray-900 bg-white p-3 rounded border">{promptData.objective}</p>
              </div>
            )}

            {promptData.context && (
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-1">Context</h4>
                <p className="text-sm text-gray-700 bg-white p-3 rounded border whitespace-pre-wrap">{promptData.context}</p>
              </div>
            )}

            {promptData.acceptanceCriteria && (
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-1">Acceptance Criteria</h4>
                <p className="text-sm text-gray-700 bg-white p-3 rounded border whitespace-pre-wrap">{promptData.acceptanceCriteria}</p>
              </div>
            )}

            {promptData.deliverables && (
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-1">Deliverables</h4>
                <p className="text-sm text-gray-700 bg-white p-3 rounded border">{promptData.deliverables}</p>
              </div>
            )}
          </div>
        )}

        {enabledTools && enabledTools.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Enabled Tools</h4>
            <div className="flex flex-wrap gap-2">
              {enabledTools.map((tool, index) => (
                <span key={index} className="inline-block px-3 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
                  {tool}
                </span>
              ))}
            </div>
          </div>
        )}

        {!loading && !promptData && ipfsHash && (
          <div className="text-sm text-gray-500">
            Prompt details not available from IPFS
          </div>
        )}
      </CardContent>
    </Card>
  )
}

