import { getWorkstreams } from '@/lib/subgraph'
import Link from 'next/link'
import { TruncatedId } from '@/components/truncated-id'
import { SiteHeader } from '@/components/site-header'

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
    <>
      <SiteHeader 
        title="Workstreams"
        subtitle="Top-level job executions and their entire downstream graphs"
      />
      <div className="p-4 md:p-6">

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
                  <td className="px-4 py-3 text-right">
                    <TruncatedId value={workstream.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </>
  )
}

