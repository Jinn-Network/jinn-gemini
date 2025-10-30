import { getWorkstreams } from '@/lib/subgraph'
import Link from 'next/link'

// Force dynamic rendering to avoid build-time data fetching
export const dynamic = 'force-dynamic'

export default async function WorkstreamsPage() {
  const { requests } = await getWorkstreams({ limit: 50 })

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(Number(timestamp) * 1000)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Workstreams</h1>
        <p className="text-gray-600 text-sm mt-2">
          Top-level job executions and their entire downstream graphs
        </p>
      </div>

      {requests.items.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No workstreams found
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Job Name</th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Started</th>
                <th className="text-right px-4 py-3 text-sm font-semibold text-gray-700">ID</th>
              </tr>
            </thead>
            <tbody>
              {requests.items.map((workstream) => (
                <tr key={workstream.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <Link 
                      href={`/workstreams/${workstream.id}`}
                      className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                    >
                      {workstream.jobName || 'Unnamed Workstream'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {formatTimestamp(workstream.blockTimestamp)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-gray-600 font-mono">
                    {workstream.id.substring(0, 12)}...
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

