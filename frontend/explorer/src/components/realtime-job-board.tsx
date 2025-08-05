'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { DbRecord } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RecordList } from '@/components/record-list'
import { Pagination } from '@/components/pagination'
import { RecordListSkeleton } from '@/components/loading-skeleton'
import { IdLink } from '@/components/id-link'
import { toast } from 'sonner'

interface RealtimeJobBoardProps {
  pageSize?: number
  enablePolling?: boolean
  pollingInterval?: number
}

interface JobBoardStats {
  total: number
  pending: number
  in_progress: number
  completed: number
  failed: number
}

export function RealtimeJobBoard({ 
  pageSize = 50, 
  enablePolling = true, 
  pollingInterval = 5000 
}: RealtimeJobBoardProps) {
  const [records, setRecords] = useState<DbRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalRecords, setTotalRecords] = useState(0)
  const [stats, setStats] = useState<JobBoardStats>({ total: 0, pending: 0, in_progress: 0, completed: 0, failed: 0 })
  const [isRealTimeConnected, setIsRealTimeConnected] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())
  
  const supabase = createClient()
  const subscriptionRef = useRef<any>(null)
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  
  // Fetch job statistics
  const fetchStats = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('job_board')
        .select('status')
      
      if (error) throw error
      
      const statusCounts = (data || []).reduce((acc, job) => {
        acc[job.status] = (acc[job.status] || 0) + 1
        return acc
      }, {} as Record<string, number>)
      
      setStats({
        total: data?.length || 0,
        pending: statusCounts['PENDING'] || 0,
        in_progress: statusCounts['IN_PROGRESS'] || 0,
        completed: statusCounts['COMPLETED'] || 0,
        failed: statusCounts['FAILED'] || 0,
      })
    } catch (error) {
      console.error('Error fetching job stats:', error)
    }
  }, [supabase])

  // Fetch records with pagination
  const fetchRecords = useCallback(async (page: number, showLoading = true) => {
    if (showLoading) setLoading(true)
    
    try {
      const { data, error, count } = await supabase
        .from('job_board')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1)

      if (error) throw error

      setRecords(data || [])
      setTotalRecords(count || 0)
      setLastUpdate(new Date())
    } catch (error) {
      console.error('Error fetching job board records:', error)
      toast.error('Failed to fetch job board records')
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [supabase, pageSize])

  // Set up real-time subscription
  const setupRealtimeSubscription = useCallback(() => {
    try {
      subscriptionRef.current = supabase
        .channel('job-board-changes')
        .on(
          'postgres_changes',
          {
            event: '*', // Listen to all changes (INSERT, UPDATE, DELETE)
            schema: 'public',
            table: 'job_board'
          },
          (payload) => {
            console.log('Real-time job board change:', payload)
            
            // Refresh current page and stats on any change
            fetchRecords(currentPage, false)
            fetchStats()
            
            // Show toast notification for important changes
            if (payload.eventType === 'INSERT') {
              toast.info('New job added to the board')
            } else if (payload.eventType === 'UPDATE' && payload.new?.status !== payload.old?.status) {
              const jobName = payload.new?.job_name || 'Unknown Job'
              const newStatus = payload.new?.status
              toast.info(`Job "${jobName}" status changed to ${newStatus}`)
            }
          }
        )
        .subscribe((status) => {
          console.log('Real-time subscription status:', status)
          setIsRealTimeConnected(status === 'SUBSCRIBED')
          
          if (status === 'SUBSCRIBED') {
            toast.success('Real-time updates enabled')
          } else if (status === 'CHANNEL_ERROR') {
            toast.error('Real-time connection failed, falling back to polling')
            setupPolling()
          }
        })
    } catch (error) {
      console.error('Error setting up real-time subscription:', error)
      toast.error('Failed to set up real-time updates, using polling instead')
      setupPolling()
    }
  }, [supabase, currentPage, fetchRecords, fetchStats])

  // Set up polling as fallback
  const setupPolling = useCallback(() => {
    if (!enablePolling) return
    
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
    }
    
    pollingIntervalRef.current = setInterval(() => {
      console.log('Polling for job board updates...')
      fetchRecords(currentPage, false)
      fetchStats()
    }, pollingInterval)
  }, [enablePolling, pollingInterval, currentPage, fetchRecords, fetchStats])

  // Initial load and setup
  useEffect(() => {
    fetchRecords(currentPage)
    fetchStats()
    
    // Try real-time first, fallback to polling
    setupRealtimeSubscription()
    
    // If real-time doesn't connect within 5 seconds, start polling
    const fallbackTimer = setTimeout(() => {
      if (!isRealTimeConnected && enablePolling) {
        console.log('Real-time not connected, starting polling')
        setupPolling()
      }
    }, 5000)
    
    return () => {
      // Cleanup
      if (subscriptionRef.current) {
        supabase.removeChannel(subscriptionRef.current)
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
      }
      clearTimeout(fallbackTimer)
    }
  }, []) // Only run on mount

  // Update subscription when page changes
  useEffect(() => {
    if (currentPage !== 1) {
      fetchRecords(currentPage)
    }
  }, [currentPage, fetchRecords])

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
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

  if (loading) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">Job Board</h1>
          <p className="text-gray-600">Real-time job execution dashboard</p>
        </div>
        <RecordListSkeleton />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold mb-2">Job Board</h1>
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>Real-time job execution dashboard</span>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isRealTimeConnected ? 'bg-green-500' : 'bg-yellow-500'}`} />
            <span>{isRealTimeConnected ? 'Real-time' : 'Polling'}</span>
          </div>
          <span>Last update: {lastUpdate.toLocaleTimeString()}</span>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
            <div className="text-xs text-gray-600">Total Jobs</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
            <div className="text-xs text-gray-600">Pending</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-blue-600">{stats.in_progress}</div>
            <div className="text-xs text-gray-600">In Progress</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
            <div className="text-xs text-gray-600">Completed</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
            <div className="text-xs text-gray-600">Failed</div>
          </CardContent>
        </Card>
      </div>

      {/* Records Count */}
      <div className="flex items-center justify-between">
        <p className="text-gray-600">
          Showing {records.length} of {totalRecords} jobs (Page {currentPage})
        </p>
        <button
          onClick={() => {
            fetchRecords(currentPage, false)
            fetchStats()
          }}
          className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Refresh
        </button>
      </div>
      
      {/* Job List */}
      <RecordList records={records} collectionName="job_board" />
      
      {/* Pagination */}
      <Pagination
        currentPage={currentPage}
        totalRecords={totalRecords}
        pageSize={pageSize}
        onPageChange={handlePageChange}
      />
    </div>
  )
}