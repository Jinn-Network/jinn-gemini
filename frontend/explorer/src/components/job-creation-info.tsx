'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { IdLink } from '@/components/id-link'
// Card components removed as they were not being used

interface JobCreationInfoProps {
  jobId: string | null | undefined
  className?: string
}

interface JobInfo {
  id: string
  job_name: string
  status: string
  created_at: string
  worker_id?: string
}

export function JobCreationInfo({ jobId, className = '' }: JobCreationInfoProps) {
  const [jobInfo, setJobInfo] = useState<JobInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!jobId) {
      setJobInfo(null)
      return
    }

    const fetchJobInfo = async () => {
      setIsLoading(true)
      setError(null)
      
      try {
        const supabase = createClient()
        const { data, error: fetchError } = await supabase
          .from('job_board')
          .select('id, job_name, status, created_at, worker_id')
          .eq('id', jobId)
          .single()

        if (fetchError) {
          throw fetchError
        }

        setJobInfo(data)
      } catch (err) {
        console.error('Error fetching job info:', err)
        setError(err instanceof Error ? err.message : 'Failed to fetch job information')
      } finally {
        setIsLoading(false)
      }
    }

    fetchJobInfo()
  }, [jobId])

  if (!jobId) {
    return (
      <div className={`text-gray-400 italic text-sm ${className}`}>
        Not created by a job
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className={`text-gray-500 text-sm ${className}`}>
        Loading job information...
      </div>
    )
  }

  if (error) {
    return (
      <div className={`text-red-600 text-sm ${className}`}>
        Error loading job: {error}
      </div>
    )
  }

  if (!jobInfo) {
    return (
      <div className={`text-gray-400 italic text-sm ${className}`}>
        Job not found
      </div>
    )
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'text-green-600 bg-green-50 border-green-200'
      case 'FAILED':
        return 'text-red-600 bg-red-50 border-red-200'
      case 'IN_PROGRESS':
        return 'text-blue-600 bg-blue-50 border-blue-200'
      case 'PENDING':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200'
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200'
    }
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="text-sm text-gray-700">
        <span className="font-medium">Created by job:</span>
      </div>
      
      <div className="bg-gray-50 border rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-medium text-gray-900">
            {jobInfo.job_name}
          </div>
          <span className={`inline-flex items-center px-2 py-1 rounded text-xs border ${getStatusColor(jobInfo.status)}`}>
            {jobInfo.status}
          </span>
        </div>
        
        <div className="space-y-1 text-xs text-gray-600">
          <div>
            <span className="font-medium">Job ID:</span>{' '}
            <IdLink id={jobInfo.id} fieldName="created_by_job_id" showFullId={false} />
          </div>
          <div>
            <span className="font-medium">Created:</span>{' '}
            {formatDate(jobInfo.created_at)}
          </div>
          {jobInfo.worker_id && (
            <div>
              <span className="font-medium">Worker:</span>{' '}
              <span className="font-mono">{jobInfo.worker_id}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}