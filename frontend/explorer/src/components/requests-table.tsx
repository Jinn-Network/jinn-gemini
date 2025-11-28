'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { SubgraphRecord } from '@/hooks/use-subgraph-collection'
import { formatDate } from '@/lib/utils'
import { getDependencyInfo, DependencyInfo, getJobDefinition } from '@/lib/subgraph'
import { StatusIcon, mapDependencyStatusToJobStatus } from '@/components/status-icon'
import { TruncatedId } from '@/components/truncated-id'

interface RequestsTableProps {
  records: SubgraphRecord[]
}

// Component to display dependency count with tooltip
function DependencyCell({ dependencies }: { dependencies?: string[] }) {
  const [dependencyDetails, setDependencyDetails] = useState<DependencyInfo[]>([])
  const [isHovering, setIsHovering] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (isHovering && dependencies && dependencies.length > 0 && dependencyDetails.length === 0) {
      setIsLoading(true)
      getDependencyInfo(dependencies)
        .then(setDependencyDetails)
        .catch(console.error)
        .finally(() => setIsLoading(false))
    }
  }, [isHovering, dependencies, dependencyDetails.length])

  if (!dependencies || dependencies.length === 0) {
    return <span className="text-gray-400 text-sm">-</span>
  }

  const displayCount = dependencies.length

  return (
    <div 
      className="relative inline-block"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <span className="text-sm font-medium text-gray-700 cursor-help">
        {displayCount}
      </span>
      
      {isHovering && (
        <div className="absolute z-50 left-0 top-full mt-1 w-64 p-3 bg-white border border-gray-200 rounded-lg shadow-lg">
          {isLoading ? (
            <div className="text-xs text-gray-500">Loading...</div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-gray-700 mb-2">
                Depends on:
              </div>
              {dependencyDetails.slice(0, 5).map((dep) => {
                const jobStatus = mapDependencyStatusToJobStatus(dep.delivered, dep.status)
                return (
                  <div key={dep.id} className="flex items-center gap-2 text-xs py-1">
                    <StatusIcon status={jobStatus} size={14} />
                    <span className="truncate" title={dep.jobName}>
                      {dep.jobName}
                    </span>
                  </div>
                )
              })}
              {dependencies.length > 5 && (
                <div className="text-xs text-gray-500 italic mt-1">
                  +{dependencies.length - 5} more...
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Component to display job definition status icon with tooltip
function JobDefStatusCell({ jobDefId }: { jobDefId?: string }) {
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (jobDefId) {
      setIsLoading(true)
      getJobDefinition(jobDefId)
        .then((jobDef) => {
          if (jobDef?.lastStatus) {
            setStatus(jobDef.lastStatus)
          }
        })
        .catch(console.error)
        .finally(() => setIsLoading(false))
    }
  }, [jobDefId])

  if (!jobDefId) return null
  if (isLoading) return null

  return status ? <StatusIcon status={status} size={16} className="inline-block" /> : null
}

export function RequestsTable({ records }: RequestsTableProps) {
  if (records.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No records found
      </div>
    )
  }

  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Job Name</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">ID</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Status</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Dependencies</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Workstream</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Job ID</th>
            <th className="text-right px-4 py-3 text-sm font-semibold text-gray-700">Timestamp</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Mech</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const jobName = 'jobName' in record && record.jobName 
              ? (record.jobName.length > 60 ? record.jobName.substring(0, 60) + '...' : record.jobName)
              : record.id.toString().substring(0, 16) + '...'
            
            const delivered = 'delivered' in record ? record.delivered : false
            
            // Determine status based on delivered flag
            const statusText = delivered ? 'DELIVERED' : 'PENDING'
            const statusClass = delivered 
              ? 'text-green-600 bg-green-50 border-green-200'
              : 'text-yellow-600 bg-yellow-50 border-yellow-200'
            
            // Get workstream ID from Ponder (always use the indexed field)
            const workstreamId = 'workstreamId' in record ? record.workstreamId : null
            
            const mech = 'mech' in record && record.mech 
              ? record.mech 
              : null
            
            const timestamp = 'blockTimestamp' in record && record.blockTimestamp 
              ? formatDate(record.blockTimestamp) 
              : '-'

            const jobDefId = 'jobDefinitionId' in record && record.jobDefinitionId
              ? record.jobDefinitionId
              : null

            const dependencies = 'dependencies' in record ? record.dependencies as string[] : undefined

            return (
              <tr key={record.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <Link 
                    href={`/requests/${record.id}`}
                    className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                  >
                    {jobName}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <TruncatedId value={record.id} />
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs border ${statusClass}`}>
                    {statusText}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <DependencyCell dependencies={dependencies} />
                </td>
                <td className="px-4 py-3">
                  {workstreamId ? (
                    <TruncatedId 
                      value={workstreamId} 
                      linkTo={`/workstreams/${workstreamId}`}
                    />
                  ) : (
                    <span className="text-gray-400 text-sm">-</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {jobDefId ? (
                    <div className="flex items-center gap-2">
                      <JobDefStatusCell jobDefId={jobDefId} />
                      <TruncatedId 
                        value={jobDefId}
                        linkTo={`/jobDefinitions/${jobDefId}`}
                      />
                    </div>
                  ) : (
                    <span className="text-gray-400 text-sm">-</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-sm text-gray-600">
                  {timestamp}
                </td>
                <td className="px-4 py-3">
                  {mech ? (
                    <TruncatedId value={mech} />
                  ) : (
                    <span className="text-gray-400 text-sm">-</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

