'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface JobFilterProps {
  onFilterChange: (filters: JobFilters) => void
  initialFilters?: JobFilters
}

export interface JobFilters {
  status?: string
  job_name?: string
}

export function JobFilter({ onFilterChange, initialFilters }: JobFilterProps) {
  const [filters, setFilters] = useState<JobFilters>(initialFilters || {})
  const [availableStatuses, setAvailableStatuses] = useState<string[]>([])

  // Fetch available filter options
  useEffect(() => {
    const fetchFilterOptions = async () => {
      const supabase = createClient()

      // Get unique job statuses
      const { data: statusData } = await supabase
        .from('job_board')
        .select('status')

      if (statusData) {
        const uniqueStatuses = [...new Set(statusData.map(item => item.status))] as string[]
        setAvailableStatuses(uniqueStatuses.sort())
      }
    }

    fetchFilterOptions()
  }, [])

  const handleFilterChange = (key: keyof JobFilters, value: string) => {
    const newFilters = {
      ...filters,
      [key]: value || undefined, // Remove empty strings
    }
    setFilters(newFilters)
    onFilterChange(newFilters)
  }

  const clearFilters = () => {
    const emptyFilters = {}
    setFilters(emptyFilters)
    onFilterChange(emptyFilters)
  }

  const hasActiveFilters = Object.values(filters).some(value => value)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Job Filters</CardTitle>
          {hasActiveFilters && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={clearFilters}
            >
              Clear All
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              value={filters.status || ''}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              className="w-full p-2 border border-gray-300 rounded text-sm"
            >
              <option value="">All Statuses</option>
              {availableStatuses.map(status => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>

          {/* Job Name Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Job Name
            </label>
            <Input
              type="text"
              placeholder="Filter by job name..."
              value={filters.job_name || ''}
              onChange={(e) => handleFilterChange('job_name', e.target.value)}
              className="text-sm"
            />
          </div>

          {/* Removed artifact-based filters; using events-only causality model */}
        </div>

        {/* Active Filters Summary */}
        {hasActiveFilters && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded">
            <div className="text-sm font-medium text-blue-900 mb-2">Active Filters:</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(filters).map(([key, value]) => {
                if (!value) return null
                return (
                  <span 
                    key={key} 
                    className="inline-flex items-center px-2 py-1 rounded text-xs bg-blue-100 text-blue-800"
                  >
                    {key.replace('_', ' ')}: {value}
                    <button
                      onClick={() => handleFilterChange(key as keyof JobFilters, '')}
                      className="ml-1 text-blue-600 hover:text-blue-800"
                    >
                      ×
                    </button>
                  </span>
                )
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
