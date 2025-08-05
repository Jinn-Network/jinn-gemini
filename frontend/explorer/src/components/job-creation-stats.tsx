'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface JobCreationStatsProps {
  collectionName: 'artifacts' | 'threads'
  className?: string
}

interface JobCreationStat {
  job_name: string
  count: number
  created_by_job_id: string
}

export function JobCreationStats({ collectionName, className = '' }: JobCreationStatsProps) {
  const [stats, setStats] = useState<JobCreationStat[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchStats = async () => {
      setIsLoading(true)
      setError(null)
      
      try {
        const supabase = createClient()
        
        // Query to get job creation statistics
        const { data, error: fetchError } = await supabase
          .from(collectionName)
          .select(`
            created_by_job_id,
            job_board!inner(
              job_name
            )
          `)
          .not('created_by_job_id', 'is', null)

        if (fetchError) {
          throw fetchError
        }

        // Process the data to create statistics
        const jobCounts: Record<string, { job_name: string; count: number; created_by_job_id: string }> = {}
        
        data?.forEach((item: any) => {
          const jobId = item.created_by_job_id
          const jobName = item.job_board?.job_name || 'Unknown Job'
          
          if (jobCounts[jobId]) {
            jobCounts[jobId].count++
          } else {
            jobCounts[jobId] = {
              job_name: jobName,
              count: 1,
              created_by_job_id: jobId
            }
          }
        })

        // Convert to array and sort by count
        const statsArray = Object.values(jobCounts)
          .sort((a, b) => b.count - a.count)
          .slice(0, 10) // Top 10

        setStats(statsArray)
      } catch (err) {
        console.error(`Error fetching ${collectionName} creation stats:`, err)
        setError(err instanceof Error ? err.message : 'Failed to fetch statistics')
      } finally {
        setIsLoading(false)
      }
    }

    fetchStats()
  }, [collectionName])

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Job Creation Stats</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-gray-500 text-sm">Loading statistics...</div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Job Creation Stats</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-red-600 text-sm">Error: {error}</div>
        </CardContent>
      </Card>
    )
  }

  if (stats.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Job Creation Stats</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-gray-400 italic text-sm">
            No {collectionName} created by jobs yet
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Top Job Creators</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {stats.map((stat, index) => (
            <div key={stat.created_by_job_id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 font-mono w-6">#{index + 1}</span>
                <span className="font-medium text-sm">{stat.job_name}</span>
              </div>
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                {stat.count} {collectionName === 'artifacts' ? 'artifacts' : 'threads'}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}