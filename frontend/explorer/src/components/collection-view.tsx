'use client'

import { useState, useMemo, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Filter, X } from 'lucide-react'
import { CollectionName } from '@/lib/types'
import { RecordList } from '@/components/record-list'
import { RequestsTable } from '@/components/requests-table'
import { ArtifactsTable } from '@/components/artifacts-table'
import { JobDefinitionsTable } from '@/components/job-definitions-table'
import { Pagination } from '@/components/pagination'
import { RecordListSkeleton, RequestsTableSkeleton, ArtifactsTableSkeleton, JobDefinitionsTableSkeleton } from '@/components/loading-skeleton'
import { getCollectionLabel } from '@/lib/utils'
import { useSubgraphCollection } from '@/hooks/use-subgraph-collection'
import { getRequest, Request } from '@/lib/subgraph'
import { SiteHeader } from '@/components/site-header'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

interface CollectionViewProps {
  collectionName: CollectionName
}

// Helper function to determine the best sorting strategy for each collection
function getSortingConfig(collectionName: CollectionName): { column: string; ascending: boolean } {
  // Collection-specific sorting configurations for subgraph entities
  const sortingConfigs: Record<CollectionName, { column: string; ascending: boolean }> = {
    jobDefinitions: { column: 'lastInteraction', ascending: false },
    requests: { column: 'blockTimestamp', ascending: false },
    deliveries: { column: 'blockTimestamp', ascending: false },
    artifacts: { column: 'blockTimestamp', ascending: false },
    messages: { column: 'blockTimestamp', ascending: false },
  }
  
  return sortingConfigs[collectionName] || { column: 'id', ascending: false }
}



type FilterType = 'id' | 'workstreamId'

interface ActiveFilter {
  type: FilterType
  value: string
  label: string
}

export function CollectionView({ collectionName }: CollectionViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const workstreamFilter = searchParams.get('workstream')
  const [rootRequest, setRootRequest] = useState<Request | null>(null)
  const pageSize = 100
  
  // Filter management state
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([])
  const [filterType, setFilterType] = useState<FilterType>('id')
  const [filterValue, setFilterValue] = useState('')
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)

  // Initialize filters from URL parameters on mount
  useEffect(() => {
    if (collectionName === 'requests' && !isInitialized) {
      const filters: ActiveFilter[] = []
      
      const idParam = searchParams.get('id')
      if (idParam) {
        filters.push({
          type: 'id',
          value: idParam,
          label: `Job Run ID: ${idParam.substring(0, 16)}...`
        })
      }
      
      const workstreamParam = searchParams.get('workstream')
      if (workstreamParam) {
        filters.push({
          type: 'workstreamId',
          value: workstreamParam,
          label: `Workstream: ${workstreamParam.substring(0, 16)}...`
        })
      }
      
      if (filters.length > 0) {
        setActiveFilters(filters)
      }
      setIsInitialized(true)
    }
  }, [collectionName, searchParams, isInitialized])
  
  // Sync filters to URL whenever they change
  useEffect(() => {
    if (!isInitialized) return
    
    const params = new URLSearchParams(searchParams.toString())
    
    // Clear existing filter params
    params.delete('id')
    params.delete('workstream')
    
    // Add current filters to URL
    activeFilters.forEach(filter => {
      if (filter.type === 'id') {
        params.set('id', filter.value)
      } else if (filter.type === 'workstreamId') {
        params.set('workstream', filter.value)
      }
    })
    
    // Update URL without causing a page reload
    const newUrl = params.toString() ? `?${params.toString()}` : window.location.pathname
    router.replace(newUrl, { scroll: false })
  }, [activeFilters, isInitialized, router, searchParams])

  // Fetch root request when filtering by workstream
  useEffect(() => {
    if (collectionName === 'requests' && workstreamFilter) {
      getRequest(workstreamFilter).then(setRootRequest).catch(console.error)
    } else {
      setRootRequest(null)
    }
  }, [collectionName, workstreamFilter])

  // Build where filter from active filters - memoized to prevent infinite rerenders
  const whereFilter = useMemo(() => {
    if (collectionName === 'requests' && activeFilters.length > 0) {
      const filter: Record<string, unknown> = {}
      
      activeFilters.forEach(f => {
        if (f.type === 'id') {
          filter.id_contains = f.value
        } else if (f.type === 'workstreamId') {
          filter.workstreamId_contains = f.value
        }
      })
      
      return Object.keys(filter).length > 0 ? filter : undefined
    }
    return undefined
  }, [collectionName, activeFilters])
  
  // Handle adding a new filter
  const handleAddFilter = () => {
    if (!filterValue.trim()) return
    
    const label = filterType === 'id' 
      ? `Job Run ID: ${filterValue.substring(0, 16)}...`
      : `Workstream: ${filterValue.substring(0, 16)}...`
    
    // Remove any existing filter of the same type
    setActiveFilters(prev => [...prev.filter(f => f.type !== filterType), {
      type: filterType,
      value: filterValue.trim(),
      label
    }])
    
    setFilterValue('')
    setPopoverOpen(false)
  }
  
  // Handle removing a filter
  const handleRemoveFilter = (filterToRemove: ActiveFilter) => {
    setActiveFilters(prev => prev.filter(f => f !== filterToRemove))
    // URL will be updated automatically by the useEffect above
  }

  // Use the subgraph collection hook
  const sortConfig = getSortingConfig(collectionName)
  const {
    records,
    loading,
    totalRecords,
    currentPage,
    setCurrentPage,
    error,
    hasNextPage,
    hasPreviousPage,
    setSorting,
    sortColumn,
    sortAscending
  } = useSubgraphCollection({
    collectionName,
    pageSize,
    enablePolling: true,
    pollingInterval: 10000, // 10 seconds
    sortColumn: sortConfig.column,
    sortAscending: sortConfig.ascending,
    whereFilter,
  })

  const handleSort = (column: string, direction: 'asc' | 'desc') => {
    setSorting(column, direction === 'asc')
  }

  // When filtering by workstream, prepend the root request to the list
  const displayRecords = useMemo(() => {
    if (rootRequest && collectionName === 'requests' && workstreamFilter) {
      return [rootRequest, ...records]
    }
    return records
  }, [rootRequest, records, collectionName, workstreamFilter])

  const breadcrumbs = [
    { label: getCollectionLabel(collectionName) }
  ]

  if (loading) {
    const getSkeletonForCollection = () => {
      switch (collectionName) {
        case 'requests':
          return <RequestsTableSkeleton />
        case 'artifacts':
          return <ArtifactsTableSkeleton />
        case 'jobDefinitions':
          return <JobDefinitionsTableSkeleton />
        default:
          return <RecordListSkeleton />
      }
    }
    
    return (
      <>
        <SiteHeader breadcrumbs={breadcrumbs} />
        <div className="p-4 md:p-6">
          {getSkeletonForCollection()}
        </div>
      </>
    )
  }

  if (error) {
    return (
      <>
        <SiteHeader breadcrumbs={breadcrumbs} />
        <div className="p-4 md:p-6">
          <div className="text-red-700 dark:text-red-400 p-4 border border-red-500/30 rounded bg-red-500/10">
            Error loading {collectionName}: {error}
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <SiteHeader breadcrumbs={breadcrumbs} />
      <div className="p-4 md:p-6">
      
      {/* Filter bar for Job Runs */}
      {collectionName === 'requests' && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Filter className="h-4 w-4" />
                Filter
              </Button>
            </PopoverTrigger>
            <PopoverContent 
              className="w-80" 
              align="start"
              onEscapeKeyDown={() => setPopoverOpen(false)}
            >
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="filter-type">Filter Type</Label>
                  <Select value={filterType} onValueChange={(value) => setFilterType(value as FilterType)}>
                    <SelectTrigger id="filter-type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="id">Job Run ID</SelectItem>
                      <SelectItem value="workstreamId">Workstream ID</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="filter-value">Value</Label>
                  <Input
                    id="filter-value"
                    placeholder={`Enter ${filterType === 'id' ? 'Job Run ID' : 'Workstream ID'}...`}
                    value={filterValue}
                    onChange={(e) => setFilterValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleAddFilter()
                      } else if (e.key === 'Escape') {
                        setPopoverOpen(false)
                      }
                    }}
                  />
                </div>
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    onClick={() => setPopoverOpen(false)} 
                    className="flex-1" 
                    size="sm"
                  >
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleAddFilter} 
                    className="flex-1" 
                    size="sm"
                  >
                    Add Filter
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          
          {/* Active filters */}
          {activeFilters.map((filter, index) => (
            <Badge
              key={index}
              variant="outline"
              className="gap-1.5 bg-primary/10 border-primary/30 text-primary"
            >
              <span>{filter.label}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-3 w-3 p-0 hover:bg-transparent"
                onClick={() => handleRemoveFilter(filter)}
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          ))}
        </div>
      )}
      
      {collectionName === 'requests' ? (
        <RequestsTable records={displayRecords} />
      ) : collectionName === 'artifacts' ? (
        <ArtifactsTable records={displayRecords} />
      ) : collectionName === 'jobDefinitions' ? (
        <JobDefinitionsTable 
          records={displayRecords} 
          onSort={handleSort}
          sortColumn={sortColumn}
          sortAscending={sortAscending}
        />
      ) : (
        <RecordList records={displayRecords} collectionName={collectionName} />
      )}
      
      <Pagination
        currentPage={currentPage}
        totalRecords={totalRecords}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
        hasNextPage={hasNextPage}
        hasPreviousPage={hasPreviousPage}
      />
      </div>
    </>
  )
}