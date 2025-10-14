import { getWorkstreams } from '@/lib/subgraph'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'

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
        <Card>
          <CardContent className="p-6">
            <p className="text-gray-500 text-center">No workstreams found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {requests.items.map((workstream) => (
            <Link key={workstream.id} href={`/workstreams/${workstream.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-semibold mb-2">
                        {workstream.jobName || 'Unnamed Workstream'}
                      </h3>
                      <div className="text-sm text-gray-600">
                        Started: {formatTimestamp(workstream.blockTimestamp)}
                      </div>
                    </div>
                    <div className="text-xs text-gray-400 font-mono ml-4">
                      {workstream.id.substring(0, 12)}...
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

