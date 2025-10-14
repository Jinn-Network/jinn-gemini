'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import { Artifact } from '@/lib/subgraph'

interface WorkstreamBriefingProps {
  rootRequestId: string
  initialBriefing: Artifact | null
}

export function WorkstreamBriefing({ rootRequestId, initialBriefing }: WorkstreamBriefingProps) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(
    initialBriefing?.blockTimestamp || null
  )
  const [isRefreshing, setIsRefreshing] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const fetchBriefing = useCallback(async (silent: boolean = false) => {
    if (!silent) {
      setLoading(true)
    } else {
      setIsRefreshing(true)
    }
    
    try {
      // Fetch latest briefing artifact
      const response = await fetch(
        `/api/workstream-briefing?rootRequestId=${rootRequestId}`
      )
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const data = await response.json()
      
      if (data.artifact && data.artifact.cid) {
        // Fetch IPFS content
        const ipfsResponse = await fetch(
          `https://gateway.autonolas.tech/ipfs/${data.artifact.cid}`
        )
        
        if (!ipfsResponse.ok) {
          throw new Error(`IPFS fetch error! status: ${ipfsResponse.status}`)
        }
        
        const ipfsText = await ipfsResponse.text()
        
        try {
          // Try to parse as JSON artifact structure
          const parsed = JSON.parse(ipfsText)
          if (parsed.content && typeof parsed.content === 'string') {
            setContent(parsed.content)
          } else {
            setContent(ipfsText)
          }
        } catch {
          // Not JSON, use raw content
          setContent(ipfsText)
        }
        
        setLastUpdated(data.artifact.blockTimestamp)
        setError(null)
      } else {
        setContent(null)
        setError('No launcher briefing found for this workstream')
      }
    } catch (err) {
      console.error('Error fetching briefing:', err)
      if (!silent) {
        setError(`Failed to fetch briefing: ${err instanceof Error ? err.message : String(err)}`)
      }
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }, [rootRequestId])

  // Initial fetch
  useEffect(() => {
    if (initialBriefing?.cid) {
      // Use initial briefing
      fetch(`https://gateway.autonolas.tech/ipfs/${initialBriefing.cid}`)
        .then(response => response.text())
        .then(text => {
          try {
            const parsed = JSON.parse(text)
            if (parsed.content && typeof parsed.content === 'string') {
              setContent(parsed.content)
            } else {
              setContent(text)
            }
          } catch {
            setContent(text)
          }
          setLoading(false)
        })
        .catch(err => {
          console.error('Error fetching initial briefing:', err)
          setError('Failed to load briefing')
          setLoading(false)
        })
    } else {
      fetchBriefing()
    }
  }, [initialBriefing, fetchBriefing])

  // Set up 10-second polling
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      fetchBriefing(true)
    }, 10000)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [rootRequestId, fetchBriefing])

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(Number(timestamp) * 1000)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  if (loading) {
    return (
      <div className="text-sm text-gray-500 p-4">
        Loading launcher briefing...
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-md">
        <p className="text-sm text-yellow-800">{error}</p>
        <p className="text-xs text-yellow-600 mt-2">
          This workstream may not have a launcher briefing yet.
        </p>
      </div>
    )
  }

  if (!content) {
    return (
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-md">
        <p className="text-sm text-blue-800 font-medium mb-2">
          No launcher briefing available yet
        </p>
        <p className="text-xs text-blue-600">
          The launcher briefing will appear after the root job completes its first execution and delivers results.
          This workstream may still be initializing or waiting to run.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Refresh indicator and timestamp */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center gap-2">
          {isRefreshing && (
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
              <span>Refreshing...</span>
            </div>
          )}
          {lastUpdated && (
            <span>Last updated: {formatTimestamp(lastUpdated)}</span>
          )}
        </div>
        <span className="text-gray-400">Auto-refresh: 10s</span>
      </div>

      {/* Main content */}
      <div className="prose prose-sm max-w-none bg-white p-6 rounded-lg border border-gray-200">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </div>
  )
}



