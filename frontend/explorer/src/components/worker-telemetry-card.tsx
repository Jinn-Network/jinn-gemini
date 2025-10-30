'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Clock, AlertCircle, CheckCircle, Activity } from 'lucide-react'

interface WorkerTelemetryEvent {
  timestamp: string
  phase: string
  event: string
  duration_ms?: number
  metadata?: Record<string, unknown>
  error?: string
}

interface WorkerTelemetryLog {
  version: string
  requestId: string
  jobName?: string
  startTime: string
  endTime?: string
  totalDuration_ms?: number
  events: WorkerTelemetryEvent[]
  summary: {
    totalEvents: number
    phases: string[]
    errors: number
  }
}

interface WorkerTelemetryCardProps {
  telemetryLog: WorkerTelemetryLog | null
  loading?: boolean
}

export function WorkerTelemetryCard({ telemetryLog, loading }: WorkerTelemetryCardProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Worker Telemetry</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-gray-500 text-sm">Loading worker telemetry...</div>
        </CardContent>
      </Card>
    )
  }

  if (!telemetryLog) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Worker Telemetry</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-gray-500 text-sm">No worker telemetry available</div>
        </CardContent>
      </Card>
    )
  }

  // Group events by phase
  const phaseGroups = telemetryLog.events.reduce((acc, event) => {
    if (!acc[event.phase]) {
      acc[event.phase] = []
    }
    acc[event.phase].push(event)
    return acc
  }, {} as Record<string, WorkerTelemetryEvent[]>)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Worker Telemetry</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Summary Stats */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <div className="flex items-center gap-2 text-xs text-gray-600 mb-1">
                <Clock className="w-3 h-3" />
                <span>Total Duration</span>
              </div>
              <div className="text-sm font-semibold text-gray-900">
                {telemetryLog.totalDuration_ms ? `${telemetryLog.totalDuration_ms}ms` : 'N/A'}
              </div>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <div className="flex items-center gap-2 text-xs text-gray-600 mb-1">
                <Activity className="w-3 h-3" />
                <span>Events</span>
              </div>
              <div className="text-sm font-semibold text-gray-900">
                {telemetryLog.summary.totalEvents}
              </div>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <div className="flex items-center gap-2 text-xs text-gray-600 mb-1">
                <CheckCircle className="w-3 h-3" />
                <span>Phases</span>
              </div>
              <div className="text-sm font-semibold text-gray-900">
                {telemetryLog.summary.phases.length}
              </div>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <div className="flex items-center gap-2 text-xs text-gray-600 mb-1">
                <AlertCircle className="w-3 h-3" />
                <span>Errors</span>
              </div>
              <div className={`text-sm font-semibold ${telemetryLog.summary.errors > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {telemetryLog.summary.errors}
              </div>
            </div>
          </div>

          {/* Phase Timeline */}
          <div>
            <div className="text-sm font-medium text-gray-700 mb-3">Execution Timeline</div>
            <div className="space-y-3">
              {telemetryLog.summary.phases.map((phase, idx) => {
                const events = phaseGroups[phase] || []
                const endEvent = events.find(e => e.event === 'phase_end')
                const hasErrors = events.some(e => e.event === 'error')
                
                return (
                  <details key={idx} className="group border border-gray-200 rounded-lg">
                    <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors">
                      <span className="text-xs font-mono text-gray-400 w-6">{idx + 1}</span>
                      <Badge 
                        variant="outline" 
                        className={`text-xs ${hasErrors ? 'border-red-300 text-red-700' : ''}`}
                      >
                        {phase}
                      </Badge>
                      {endEvent?.duration_ms && (
                        <span className="text-xs text-gray-500 ml-auto">
                          {endEvent.duration_ms}ms
                        </span>
                      )}
                      {hasErrors && (
                        <AlertCircle className="w-4 h-4 text-red-500" />
                      )}
                    </summary>
                    <div className="px-4 pb-4 pt-2 border-t border-gray-100">
                      <div className="space-y-2">
                        {events.map((event, eventIdx) => (
                          <div key={eventIdx} className="text-xs">
                            <div className="flex items-start gap-2">
                              <span className="text-gray-400 font-mono">
                                {new Date(event.timestamp).toLocaleTimeString()}
                              </span>
                              <span className={`font-medium ${event.event === 'error' ? 'text-red-600' : 'text-gray-700'}`}>
                                {event.event}
                              </span>
                              {event.duration_ms && (
                                <span className="text-gray-500">
                                  ({event.duration_ms}ms)
                                </span>
                              )}
                            </div>
                            {event.error && (
                              <div className="mt-1 ml-4 text-red-600 bg-red-50 p-2 rounded">
                                {event.error}
                              </div>
                            )}
                            {event.metadata && Object.keys(event.metadata).length > 0 && (
                              <details className="mt-1 ml-4">
                                <summary className="text-gray-500 cursor-pointer hover:text-gray-700">
                                  View metadata
                                </summary>
                                <pre className="mt-1 bg-gray-50 p-2 rounded text-xs overflow-auto">
                                  {JSON.stringify(event.metadata, null, 2)}
                                </pre>
                              </details>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </details>
                )
              })}
            </div>
          </div>

          {/* Raw JSON */}
          <details>
            <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-800">
              View full telemetry JSON
            </summary>
            <pre className="mt-2 bg-gray-50 p-3 rounded overflow-auto max-h-[300px] text-xs font-mono">
              {JSON.stringify(telemetryLog, null, 2)}
            </pre>
          </details>
        </div>
      </CardContent>
    </Card>
  )
}

