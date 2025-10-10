import { JobGraphView } from '@/components/graph/job-graph-view'
import Link from 'next/link'
import { notFound } from 'next/navigation'

interface GraphPageProps {
  params: Promise<{
    type: string
    id: string
  }>
}

export default async function GraphPage({ params }: GraphPageProps) {
  const { type, id } = await params

  // Accept both 'job' and 'request' for backward compatibility
  if (type !== 'job' && type !== 'request') {
    notFound()
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={`/requests/${id}`}
            className="text-blue-600 hover:text-blue-800 text-sm inline-flex items-center gap-1"
          >
            <span>←</span>
            <span>Back to detail view</span>
          </Link>
          <h1 className="text-2xl font-bold mt-2">Job Graph Visualization</h1>
          <p className="text-sm text-gray-600 mt-1">
            Explore job relationships and execution flows
          </p>
        </div>
      </div>

      {/* Graph */}
      <JobGraphView rootId={id} />

      {/* Help Section */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-semibold text-blue-900 mb-3">How to Navigate</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-blue-800">
          <div>
            <strong>Click nodes</strong> to view full details
          </div>
          <div>
            <strong>Zoom & Pan</strong> using mouse wheel and drag
          </div>
          <div>
            <strong>Adjust depth</strong> to show more/fewer levels
          </div>
          <div>
            <strong>Toggle direction</strong> to see upstream or downstream
          </div>
          <div>
            <strong>Switch layout</strong> between vertical and horizontal
          </div>
          <div>
            <strong>Use minimap</strong> to navigate large graphs
          </div>
        </div>
      </div>

      {/* Edge Types Legend */}
      <div className="bg-gray-50 border rounded-lg p-4">
        <h3 className="font-semibold text-gray-900 mb-3">Relationship Types</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-3">
            <div className="flex items-center">
              <div className="w-12 h-0.5 bg-purple-500"></div>
              <div className="w-2 h-2 bg-gray-700 transform rotate-45 -ml-1"></div>
            </div>
            <div>
              <div className="font-medium">Spawned Job</div>
              <div className="text-xs text-gray-600">Job created another job type</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center">
              <div className="w-12 border-t-2 border-dashed border-orange-500"></div>
              <div className="w-2 h-2 bg-gray-700 transform rotate-45 -ml-1"></div>
            </div>
            <div>
              <div className="font-medium">Child Job</div>
              <div className="text-xs text-gray-600">Direct child job execution</div>
            </div>
          </div>
        </div>
      </div>

      {/* Node Types Legend */}
      <div className="bg-gray-50 border rounded-lg p-4">
        <h3 className="font-semibold text-gray-900 mb-3">Job Status</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded border-2 border-green-500 bg-green-50"></div>
            <span>Completed</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded border-2 border-yellow-500 bg-yellow-50"></div>
            <span>Active</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded border-2 border-red-500 bg-red-50"></div>
            <span>Failed</span>
          </div>
        </div>
      </div>
    </div>
  )
}
