import { Skeleton } from '@/components/ui/skeleton'

export function DataTableSkeleton() {
  return (
    <div className="rounded-md border">
      <div className="p-4">
        {/* Header skeleton */}
        <div className="flex space-x-4 mb-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-28" />
        </div>
        
        {/* Row skeletons */}
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex space-x-4 mb-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function DetailViewSkeleton() {
  return (
    <div className="rounded-lg border p-6">
      <Skeleton className="h-6 w-32 mb-6" />
      
      <div className="space-y-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <Skeleton className="h-4 w-24" />
            <div className="md:col-span-3">
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function PageHeaderSkeleton() {
  return (
    <div className="mb-6">
      <Skeleton className="h-8 w-64 mb-2" />
      <Skeleton className="h-4 w-48" />
    </div>
  )
}

export function RecordListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <Skeleton className="h-5 w-64" />
                <Skeleton className="h-6 w-20" />
              </div>
              <div className="space-y-1">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
            <div className="text-right flex-shrink-0 space-y-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function RequestsTableSkeleton() {
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Job Name</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Status</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Workstream</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Mech</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Sender</th>
            <th className="text-right px-4 py-3 text-sm font-semibold text-gray-700">Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 10 }).map((_, i) => (
            <tr key={i} className="border-b border-gray-100">
              <td className="px-4 py-3">
                <Skeleton className="h-4 w-48" />
              </td>
              <td className="px-4 py-3">
                <Skeleton className="h-6 w-20" />
              </td>
              <td className="px-4 py-3">
                <Skeleton className="h-4 w-24" />
              </td>
              <td className="px-4 py-3">
                <Skeleton className="h-4 w-20" />
              </td>
              <td className="px-4 py-3">
                <Skeleton className="h-4 w-20" />
              </td>
              <td className="px-4 py-3 text-right">
                <Skeleton className="h-4 w-32 ml-auto" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ArtifactsTableSkeleton() {
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Name</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Preview</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Timestamp</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">CID</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Topic</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Request</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 10 }).map((_, i) => (
            <tr key={i} className="border-b border-gray-100">
              <td className="px-4 py-3">
                <Skeleton className="h-4 w-40" />
              </td>
              <td className="px-4 py-3">
                <Skeleton className="h-4 w-64" />
              </td>
              <td className="px-4 py-3">
                <Skeleton className="h-4 w-32" />
              </td>
              <td className="px-4 py-3">
                <Skeleton className="h-4 w-28" />
              </td>
              <td className="px-4 py-3">
                <Skeleton className="h-4 w-32" />
              </td>
              <td className="px-4 py-3">
                <Skeleton className="h-4 w-24" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function JobDefinitionsTableSkeleton() {
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Name</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Description</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Created</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Source Job</th>
            <th className="text-right px-4 py-3 text-sm font-semibold text-gray-700">ID</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 10 }).map((_, i) => (
            <tr key={i} className="border-b border-gray-100">
              <td className="px-4 py-3">
                <Skeleton className="h-4 w-48" />
              </td>
              <td className="px-4 py-3">
                <Skeleton className="h-4 w-64" />
              </td>
              <td className="px-4 py-3">
                <Skeleton className="h-4 w-32" />
              </td>
              <td className="px-4 py-3">
                <Skeleton className="h-4 w-24" />
              </td>
              <td className="px-4 py-3 text-right">
                <Skeleton className="h-4 w-24 ml-auto" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}