'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getDependencyInfo, getDependents, DependencyInfo } from '@/lib/subgraph'
import { StatusIcon, mapDependencyStatusToJobStatus } from '@/components/status-icon'

interface DependenciesSectionProps {
  requestId: string
  dependencies?: string[]
  renderAsSubsection?: boolean
}

export function DependenciesSection({ requestId, dependencies, renderAsSubsection = false }: DependenciesSectionProps) {
  const [dependencyDetails, setDependencyDetails] = useState<DependencyInfo[]>([])
  const [dependents, setDependents] = useState<DependencyInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchDependencyData = async () => {
      setIsLoading(true)
      try {
        const [depDetails, depsList] = await Promise.all([
          dependencies && dependencies.length > 0 
            ? getDependencyInfo(dependencies)
            : Promise.resolve([]),
          getDependents(requestId)
        ])
        setDependencyDetails(depDetails)
        setDependents(depsList)
      } catch (error) {
        console.error('Error fetching dependency data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchDependencyData()
  }, [requestId, dependencies])

  const hasDependencies = dependencies && dependencies.length > 0
  const hasDependents = dependents.length > 0

  const content = (
    <>
      {isLoading ? (
        <div className="text-sm text-gray-500">Loading dependency information...</div>
      ) : !hasDependencies && !hasDependents ? (
        <p className="text-sm text-gray-500">No dependencies for this job.</p>
      ) : (
        <>
          {hasDependencies && dependencyDetails.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-gray-700">Depends On</h4>
                <span className="text-xs text-gray-500">
                  ({dependencyDetails.length} {dependencyDetails.length === 1 ? 'job' : 'jobs'})
                </span>
              </div>
              <div className="text-sm text-gray-600 mb-3">
                This job requires the following jobs to complete before it can run:
              </div>
              <ul className="space-y-2">
                {dependencyDetails.map((dep) => {
                  const jobStatus = mapDependencyStatusToJobStatus(dep.delivered, dep.status)
                  return (
                    <Link
                      key={dep.id}
                      href={`/job-definitions/${dep.id}`}
                      className="flex items-center justify-between p-2 bg-gray-50 rounded hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <StatusIcon status={jobStatus} size={16} />
                        <span className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline">{dep.jobName}</span>
                      </div>
                      <span className="text-xs text-gray-500">
                        {dep.delivered ? 'Completed' : dep.status === 'in_progress' ? 'In Progress' : 'Pending'}
                      </span>
                    </Link>
                  )
                })}
              </ul>
              <p className="text-xs text-gray-500 mt-2">
                Note: Job will execute only when all requests and child jobs of these job definitions are delivered.
              </p>
            </div>
          )}

          {hasDependents && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-gray-700">Required By</h4>
                <span className="text-xs text-gray-500">
                  ({dependents.length} {dependents.length === 1 ? 'job' : 'jobs'})
                </span>
              </div>
              <div className="text-sm text-gray-600 mb-3">
                The following jobs are waiting for this job to complete:
              </div>
              <ul className="space-y-2">
                {dependents.map((dep) => {
                  const jobStatus = mapDependencyStatusToJobStatus(dep.delivered, dep.status)
                  return (
                    <li 
                      key={dep.id} 
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-md border border-gray-200 hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <Link 
                          href={`/requests/${dep.id}`}
                          className="text-blue-600 hover:text-blue-800 hover:underline font-medium block truncate"
                        >
                          {dep.jobName || `Request ${dep.id.substring(0, 16)}...`}
                        </Link>
                        <div className="text-xs text-gray-500 font-mono mt-1">
                          {dep.id}
                        </div>
                      </div>
                      <span 
                        className={`ml-4 inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap ${
                          dep.delivered 
                            ? 'text-green-700 bg-green-100 border border-green-300'
                            : 'text-yellow-700 bg-yellow-100 border border-yellow-300'
                        }`}
                      >
                        <StatusIcon status={jobStatus} size={14} />
                        {dep.delivered ? 'Delivered' : 'Pending'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </>
  )

  if (renderAsSubsection) {
    return (
      <div className="space-y-4 pt-4 border-t border-gray-200">
        <h4 className="text-sm font-medium text-gray-700">Dependencies</h4>
        {content}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
      <h3 className="text-lg font-semibold text-gray-900">Dependencies</h3>
      {content}
    </div>
  )
}

