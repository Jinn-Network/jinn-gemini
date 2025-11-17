'use client'

import { useEffect, useState } from 'react'
import { fetchIpfsContent, getJobDefinition, getRequest, queryRequests, queryArtifacts, type Request as SubgraphRequest, type JobDefinition as SubgraphJobDefinition } from '@/lib/subgraph'
import { RecognitionPhaseCard } from './recognition-phase-card'
import { WorkerTelemetryCard } from '../worker-telemetry-card'
import { DependenciesSection } from '../dependencies-section'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import { ExternalLink, FileText, GitBranch, ArrowRight, ArrowLeft, Wrench, Zap, Cpu, Clock, Check } from 'lucide-react'
import { RequestsTable } from '../requests-table'
import { RequestsTableSkeleton } from '../loading-skeleton'

// Component for displaying child jobs spawned during execution
function ChildJobsSection({ parentRequestId }: { parentRequestId: string }) {
  const [childJobs, setChildJobs] = useState<SubgraphRequest[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchChildren = async () => {
      try {
        // Query subgraph for all jobs where sourceRequestId matches this job
        const jobsResponse = await queryRequests({ 
          where: { sourceRequestId: parentRequestId }, 
          orderBy: 'blockTimestamp', 
          orderDirection: 'desc' 
        })
        setChildJobs(jobsResponse.items)
      } catch (error) {
        console.error('Error fetching child jobs:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchChildren()
  }, [parentRequestId])

  // Only show if there are child jobs
  if (!loading && childJobs.length === 0) {
    return null
  }

  return (
    <div>
      <div className="text-sm font-medium text-gray-700 mb-2">
        Child Jobs Spawned ({childJobs.length})
      </div>
      {loading ? (
        <RequestsTableSkeleton />
      ) : (
        <RequestsTable records={childJobs} />
      )}
    </div>
  )
}

interface Request {
  id: string
  mech?: string
  sender?: string
  jobName?: string
  ipfsHash?: string
  deliveryIpfsHash?: string
  enabledTools?: string[] | string
  blockNumber?: string
  blockTimestamp?: string
  transactionHash?: string
  delivered?: boolean
  jobDefinitionId?: string
  sourceRequestId?: string
  sourceJobDefinitionId?: string
  dependencies?: string[]
}

interface MemoryInspectionResponse {
  requestId: string
  situation: {
    context?: {
      parentRequestId?: string
      childRequestIds?: string[]
      siblingRequestIds?: string[]
    }
    execution?: {
      status?: string
      trace?: unknown
      finalOutputSummary?: string
    }
    artifacts?: unknown[]
    meta?: {
      generatedAt?: string
    }
  } | null
  recognition: {
    searchQuery?: string
    similarJobs?: Array<{
      requestId: string
      score: number
      jobName?: string
    }>
    learnings: string | object[]
    timestamp: string
  } | null
  hasSituation: boolean
  hasRecognition: boolean
}

interface JobDetailLayoutProps {
  record: Request
}

interface WorkerTelemetryLog {
  version: string
  requestId: string
  jobName?: string
  startTime: string
  endTime?: string
  totalDuration_ms?: number
  events: Array<{
    timestamp: string
    phase: string
    event: string
    duration_ms?: number
    metadata?: Record<string, unknown>
    error?: string
  }>
  summary: {
    totalEvents: number
    phases: string[]
    errors: number
  }
}

interface ToolCallResult {
  cid?: string
  name?: string
  topic?: string
  contentPreview?: string
}

interface ToolCall {
  tool?: string
  success?: boolean
  duration_ms?: number
  result?: ToolCallResult
  input?: unknown
  params?: unknown
  args?: unknown
}

interface TelemetryData {
  tokens?: number
  duration?: number
  totalTokens?: number
  errorMessage?: string
  errorType?: string
  raw?: {
    model?: string
    inputTokens?: number
    events?: string[]
    lastApiRequest?: string
    requestText?: string[]
  }
  requestText?: string[]
  responseText?: string[]
  toolCalls?: ToolCall[]
}

interface DeliveryData {
  output?: string
  structuredSummary?: string
  artifacts?: unknown[]
  telemetry?: TelemetryData
  reflection?: {
    telemetry?: TelemetryData
  }
}

interface Artifact {
  id: string
  topic?: string
  name?: string
  cid?: string
  contentPreview?: string
}

export function JobDetailLayout({ record }: JobDetailLayoutProps) {
  const [memoryData, setMemoryData] = useState<MemoryInspectionResponse | null>(null)
  const [loadingMemory, setLoadingMemory] = useState(true)
  const [deliveryData, setDeliveryData] = useState<DeliveryData | null>(null)
  const [loadingDelivery, setLoadingDelivery] = useState(false)
  const [jobDefinition, setJobDefinition] = useState<SubgraphJobDefinition | null>(null)
  const [sourceRequest, setSourceRequest] = useState<SubgraphRequest | null>(null)
  const [sourceJobDef, setSourceJobDef] = useState<SubgraphJobDefinition | null>(null)
  const [promptContent, setPromptContent] = useState<string | null>(null)
  const [deliveryContent, setDeliveryContent] = useState<string | null>(null)
  const [workstreamId, setWorkstreamId] = useState<string | null>(null)
  const [loadingWorkstream, setLoadingWorkstream] = useState(true)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [loadingArtifacts, setLoadingArtifacts] = useState(true)
  const [workerTelemetry, setWorkerTelemetry] = useState<WorkerTelemetryLog | null>(null)
  const [loadingWorkerTelemetry, setLoadingWorkerTelemetry] = useState(true)

  // Find the root request (workstream) by traversing up the chain
  useEffect(() => {
    const findWorkstream = async () => {
      try {
        setLoadingWorkstream(true)
        let currentRequestId = record.id
        let currentSourceId = record.sourceRequestId

        // Traverse up the chain until we find a request with no source (the root)
        while (currentSourceId) {
          const parent = await getRequest(currentSourceId)
          if (!parent || !parent.sourceRequestId) {
            currentRequestId = currentSourceId
            break
          }
          currentRequestId = currentSourceId
          currentSourceId = parent.sourceRequestId
        }

        setWorkstreamId(currentRequestId)
      } catch (error) {
        console.error('Error finding workstream:', error)
      } finally {
        setLoadingWorkstream(false)
      }
    }

    findWorkstream()
  }, [record.id, record.sourceRequestId])

  useEffect(() => {
    const fetchMemoryData = async () => {
      try {
        setLoadingMemory(true)
        const response = await fetch(`/api/memory-inspection?requestId=${encodeURIComponent(record.id)}`)
        
        if (response.ok) {
          const result: MemoryInspectionResponse = await response.json()
          setMemoryData(result)
        }
      } catch (error) {
        console.error('Error fetching memory data:', error)
      } finally {
        setLoadingMemory(false)
      }
    }

    if (record.delivered) {
      fetchMemoryData()
    } else {
      setLoadingMemory(false)
    }
  }, [record.id, record.delivered])

  // Fetch artifacts from subgraph
  useEffect(() => {
    const fetchArtifacts = async () => {
      try {
        setLoadingArtifacts(true)
        const artifactsResponse = await queryArtifacts({
          where: { requestId: record.id },
          orderBy: 'blockTimestamp',
          orderDirection: 'desc'
        })
        setArtifacts(artifactsResponse.items)
      } catch (error) {
        console.error('Error fetching artifacts:', error)
      } finally {
        setLoadingArtifacts(false)
      }
    }

    fetchArtifacts()
  }, [record.id])

  // Fetch worker telemetry artifact
  useEffect(() => {
    const fetchWorkerTelemetry = async () => {
      if (!record.delivered) {
        setLoadingWorkerTelemetry(false)
        return
      }

      try {
        setLoadingWorkerTelemetry(true)
        // Find WORKER_TELEMETRY artifact
        const telemetryArtifact = artifacts.find(a => a.topic === 'WORKER_TELEMETRY')
        
        if (telemetryArtifact?.cid) {
          const result = await fetchIpfsContent(telemetryArtifact.cid)
          if (result) {
            const parsed = JSON.parse(result.content)
            // Handle content wrapper if needed
            if (parsed.content && typeof parsed.content === 'string') {
              try {
                setWorkerTelemetry(JSON.parse(parsed.content))
              } catch {
                setWorkerTelemetry(parsed)
              }
            } else {
              setWorkerTelemetry(parsed)
            }
          }
        }
      } catch (error) {
        console.error('Error fetching worker telemetry:', error)
      } finally {
        setLoadingWorkerTelemetry(false)
      }
    }

    if (!loadingArtifacts && artifacts.length > 0) {
      fetchWorkerTelemetry()
    } else if (!loadingArtifacts) {
      setLoadingWorkerTelemetry(false)
    }
  }, [record.id, record.delivered, artifacts, loadingArtifacts])

  // Always fetch delivery data when job is delivered (contains telemetry & final output)
  useEffect(() => {
    const fetchDelivery = async () => {
      if (!record.deliveryIpfsHash || !record.delivered || loadingMemory) {
        console.log('[JobDetailLayout] Skipping delivery fetch:', { 
          hasHash: !!record.deliveryIpfsHash, 
          delivered: record.delivered, 
          loadingMemory 
        })
        return
      }

      try {
        console.log('[JobDetailLayout] Fetching delivery data:', record.deliveryIpfsHash)
        setLoadingDelivery(true)
        const result = await fetchIpfsContent(record.deliveryIpfsHash, record.id)
        console.log('[JobDetailLayout] Delivery fetch result:', result)
        if (result) {
          const parsed = JSON.parse(result.content)
          console.log('[JobDetailLayout] Parsed delivery data:', parsed)
          setDeliveryData(parsed)
        }
      } catch (error) {
        console.error('[JobDetailLayout] Error fetching delivery data:', error)
      } finally {
        setLoadingDelivery(false)
      }
    }

    fetchDelivery()
  }, [record.deliveryIpfsHash, record.id, record.delivered, loadingMemory])

  // Fetch job definition
  useEffect(() => {
    if (record.jobDefinitionId) {
      getJobDefinition(record.jobDefinitionId).then(setJobDefinition)
    }
  }, [record.jobDefinitionId])

  // Fetch source request
  useEffect(() => {
    if (record.sourceRequestId) {
      getRequest(record.sourceRequestId).then(setSourceRequest)
    }
  }, [record.sourceRequestId])

  // Fetch source job definition
  useEffect(() => {
    if (record.sourceJobDefinitionId) {
      getJobDefinition(record.sourceJobDefinitionId).then(setSourceJobDef)
    }
  }, [record.sourceJobDefinitionId])

  // Fetch blueprint content from IPFS
  useEffect(() => {
    if (record.ipfsHash) {
      fetchIpfsContent(record.ipfsHash).then(result => {
        if (result) {
          try {
            const parsed = JSON.parse(result.content)
            // Extract blueprint (new architecture) or fall back to prompt (legacy)
            const blueprint = parsed.blueprint || parsed.prompt || result.content
            setPromptContent(blueprint)
          } catch {
            // If parsing fails, use raw content
            setPromptContent(result.content)
          }
        }
      })
    }
  }, [record.ipfsHash])

  // Fetch delivery content from IPFS
  useEffect(() => {
    if (record.deliveryIpfsHash && record.delivered) {
      fetchIpfsContent(record.deliveryIpfsHash, record.id).then(result => {
        if (result) setDeliveryContent(result.content)
      })
    }
  }, [record.deliveryIpfsHash, record.id, record.delivered])

  // Extract execution data - prioritize delivery data as ground truth
  const executionData = record.delivered ? {
    status: memoryData?.situation?.execution?.status || 'COMPLETED',
    trace: deliveryData?.telemetry?.toolCalls,
    finalOutput: (() => {
      // Try deliveryData.output first
      if (deliveryData?.output) {
        return typeof deliveryData.output === 'string' ? deliveryData.output : JSON.stringify(deliveryData.output);
      }
      // If there's an error, show the error details
      if (deliveryData?.telemetry?.errorMessage || deliveryData?.telemetry?.errorType) {
        return `Error: ${deliveryData.telemetry.errorType || 'Unknown'}\n\n${deliveryData.telemetry.errorMessage || 'No error message available'}`;
      }
      // Fallback to situation summary
      return memoryData?.situation?.execution?.finalOutputSummary;
    })(),
    artifacts: memoryData?.situation?.artifacts || deliveryData?.artifacts || [],
    tokens: deliveryData?.telemetry?.tokens,
    duration: deliveryData?.telemetry?.duration,
    telemetry: deliveryData?.telemetry,
    hasError: !!(deliveryData?.telemetry?.errorMessage || deliveryData?.telemetry?.errorType)
  } : undefined

  console.log('[JobDetailLayout] Execution data state:', {
    hasSituation: memoryData?.hasSituation,
    hasDeliveryData: !!deliveryData,
    hasExecutionData: !!executionData,
    hasTelemetry: !!deliveryData?.telemetry,
    hasTrace: !!deliveryData?.telemetry?.toolCalls,
    hasOutput: !!deliveryData?.output,
    loadingMemory,
    loadingDelivery,
    delivered: record.delivered
  })

  return (
    <Tabs defaultValue="pretty" className="w-full">
      <TabsList className="mb-6 bg-gray-100 p-1 rounded-lg">
        <TabsTrigger value="pretty" className="data-[state=active]:bg-white data-[state=active]:shadow">
          Pretty
        </TabsTrigger>
        <TabsTrigger value="raw" className="data-[state=active]:bg-white data-[state=active]:shadow">
          Raw
        </TabsTrigger>
      </TabsList>

      <TabsContent value="pretty" className="mt-0">
        <div className="flex gap-6">
      {/* Main Content - 8/12 width */}
      <div className="flex-1 space-y-6" style={{ maxWidth: '66.666%' }}>
            {/* Request */}
            <Card>
              <CardHeader>
                <CardTitle>Request</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <div className="text-sm font-medium text-gray-700 mb-2">Blueprint</div>
                    {promptContent ? (
                      (() => {
                        try {
                          const parsed = JSON.parse(promptContent)
                          const blueprintContent = parsed.blueprint || parsed.prompt || promptContent
                          
                          // Check if blueprint itself is JSON with assertions structure
                          try {
                            const blueprintParsed = typeof blueprintContent === 'string' 
                              ? JSON.parse(blueprintContent) 
                              : blueprintContent
                            
                            if (blueprintParsed.assertions && Array.isArray(blueprintParsed.assertions)) {
                              // Render structured blueprint with assertions
                              return (
                                <div className="space-y-4">
                                  {blueprintParsed.assertions.map((assertion: { id: string; assertion?: string; description?: string; commentary?: string; examples?: { do?: string[]; dont?: string[] } }, idx: number) => (
                                    <div key={idx} className="border border-gray-200 rounded-lg p-4 bg-white">
                                      <div className="flex items-start gap-2 mb-2">
                                        <span className="text-xs font-mono bg-blue-100 text-blue-800 px-2 py-1 rounded">
                                          {assertion.id}
                                        </span>
                                        <p className="text-sm font-medium text-gray-900 flex-1">
                                          {assertion.assertion}
                                        </p>
                                      </div>
                                      
                                      {assertion.examples && (
                                        <div className="mt-3 space-y-2">
                                          {assertion.examples.do && assertion.examples.do.length > 0 && (
                                            <div>
                                              <div className="text-xs font-semibold text-green-700 mb-1">✓ Do:</div>
                                              <ul className="text-xs text-gray-700 space-y-1 ml-4">
                                                {assertion.examples.do.map((item: string, i: number) => (
                                                  <li key={i} className="list-disc">{item}</li>
                                                ))}
                                              </ul>
                                            </div>
                                          )}
                                          {assertion.examples.dont && assertion.examples.dont.length > 0 && (
                                            <div>
                                              <div className="text-xs font-semibold text-red-700 mb-1">✗ Don&apos;t:</div>
                                              <ul className="text-xs text-gray-700 space-y-1 ml-4">
                                                {assertion.examples.dont.map((item: string, i: number) => (
                                                  <li key={i} className="list-disc">{item}</li>
                                                ))}
                                              </ul>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                      
                                      {assertion.commentary && (
                                        <div className="mt-3 pt-3 border-t border-gray-100">
                                          <p className="text-xs text-gray-600 italic">{assertion.commentary}</p>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )
                            }
                          } catch {
                            // Not a structured blueprint, fall through
                          }
                          
                          // Render as markdown if not structured
                          return (
                            <div className="bg-gray-50 p-4 rounded text-sm max-h-[300px] overflow-auto prose prose-sm max-w-none">
                              <ReactMarkdown>{typeof blueprintContent === 'string' ? blueprintContent : JSON.stringify(blueprintContent, null, 2)}</ReactMarkdown>
                            </div>
                          )
                        } catch {
                          // If not JSON, render as-is
                          return (
                            <div className="bg-gray-50 p-4 rounded text-sm max-h-[300px] overflow-auto prose prose-sm max-w-none">
                              <ReactMarkdown>{promptContent}</ReactMarkdown>
                            </div>
                          )
                        }
                      })()
                    ) : (
                      <div className="text-gray-500 text-sm">Loading...</div>
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-700 mb-2">Enabled Tools</div>
                    {(() => {
                      // Parse enabled tools from the prompt content
                      let tools: string[] = []
                      try {
                        if (promptContent) {
                          const parsed = JSON.parse(promptContent)
                          tools = parsed.enabledTools || []
                        }
                      } catch {
                        // Fallback to record.enabledTools if available
                        if (record.enabledTools) {
                          tools = typeof record.enabledTools === 'string' 
                            ? record.enabledTools.split(',').map((t: string) => t.trim())
                            : []
                        }
                      }
                      
                      if (tools.length === 0) {
                        return <div className="text-gray-500 text-sm">None</div>
                      }
                      
                      return (
                        <div className="flex flex-wrap gap-2">
                          {tools.map((tool, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200"
                            >
                              {tool}
                            </span>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Recognition Phase */}
            <RecognitionPhaseCard 
              recognitionData={memoryData?.recognition || null}
              hasRecognition={memoryData?.hasRecognition || false}
            />

            {/* Execution/Delivery */}
            <Card>
              <CardHeader>
                <CardTitle>Execution/Delivery</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {deliveryData || executionData ? (
                    <>
                      <div>
                        <div className="text-sm font-medium text-gray-700 mb-1">State Update</div>
                        <div className="text-xs text-gray-500 mb-2">
                          Job definition state after this run
                        </div>
                        {executionData?.status && (
                          <span className={`inline-flex items-center px-3 py-1 rounded-md text-sm border ${
                            executionData.status === 'COMPLETED' 
                              ? 'bg-green-50 text-green-700 border-green-200'
                              : executionData.status === 'FAILED'
                              ? 'bg-red-50 text-red-700 border-red-200'
                              : 'bg-yellow-50 text-yellow-700 border-yellow-200'
                          }`}>
                            {executionData.status}
                          </span>
                        )}
                      </div>
                      
                      {executionData?.finalOutput && (
                        <div>
                          <div className="text-sm font-medium text-gray-700 mb-2">Final Output</div>
                          <div className="bg-gray-50 p-4 rounded text-sm overflow-auto prose prose-sm max-w-none">
                            <ReactMarkdown>
                              {deliveryData?.structuredSummary || executionData.finalOutput}
                            </ReactMarkdown>
                          </div>
                          {deliveryData?.structuredSummary && deliveryData.structuredSummary !== executionData.finalOutput && (
                            <details className="mt-2">
                              <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-800">
                                View full raw output
                              </summary>
                              <div className="mt-2 bg-gray-50 p-4 rounded text-sm overflow-auto prose prose-sm max-w-none">
                                <ReactMarkdown>{executionData.finalOutput}</ReactMarkdown>
                              </div>
                            </details>
                          )}
                        </div>
                      )}

                      <div>
                        <div className="text-sm font-medium text-gray-700 mb-3">Agentic Task Trace</div>
                        
                        {executionData?.telemetry ? (
                          <>
                          {/* Stats Cards */}
                          <div className="grid grid-cols-4 gap-3 mb-4">
                            {/* Model */}
                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                              <div className="flex items-center gap-2 text-xs text-gray-600 mb-1">
                                <Cpu className="w-3 h-3" />
                                <span>Model</span>
                              </div>
                              <div className="text-sm font-semibold text-gray-900">
                                {executionData.telemetry.raw?.model || 'N/A'}
                              </div>
                            </div>
                            
                            {/* Input Tokens */}
                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                              <div className="flex items-center gap-2 text-xs text-gray-600 mb-1">
                                <Zap className="w-3 h-3" />
                                <span>Input Tokens</span>
                              </div>
                              <div className="text-sm font-semibold text-gray-900">
                                {executionData.telemetry.raw?.inputTokens?.toLocaleString() || 'N/A'}
                              </div>
                            </div>
                            
                            {/* Total Tokens */}
                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                              <div className="flex items-center gap-2 text-xs text-gray-600 mb-1">
                                <Zap className="w-3 h-3" />
                                <span>Total Tokens</span>
                              </div>
                              <div className="text-sm font-semibold text-gray-900">
                                {executionData.telemetry.totalTokens?.toLocaleString() || 'N/A'}
                              </div>
                            </div>
                            
                            {/* Duration */}
                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                              <div className="flex items-center gap-2 text-xs text-gray-600 mb-1">
                                <Clock className="w-3 h-3" />
                                <span>Duration</span>
                              </div>
                              <div className="text-sm font-semibold text-gray-900">
                                {executionData.telemetry.duration || executionData?.duration || 'N/A'}ms
                              </div>
                            </div>
                          </div>

                          {/* Event Timeline */}
                          <div className="space-y-2">
                            {(() => {
                              const events = executionData.telemetry.raw?.events || []
                              const requestText = executionData.telemetry.requestText || []
                              const responseText = executionData.telemetry.responseText || []
                              const toolCalls = executionData.telemetry.toolCalls || []
                              
                              let apiPairIndex = 0
                              let toolCallIndex = 0
                              let userPromptIndex = 0
                              
                              let displayIndex = 0
                              
                              return events.map((event, idx: number) => {
                                if (typeof event !== 'string') return null
                                const eventType = event.split('.')[1] || event
                                
                                // Skip config and model_routing events
                                if (eventType === 'config' || eventType === 'model_routing') {
                                  return null
                                }
                                
                                displayIndex++
                                
                                let icon = null
                                let label = ''
                                let content = null
                                let colorClass = 'text-gray-600'
                                
                                if (eventType === 'user_prompt') {
                                  icon = <FileText className="w-4 h-4" />
                                  label = 'User Prompt'
                                  content = requestText[userPromptIndex]
                                  userPromptIndex++
                                  colorClass = 'text-blue-600'
                                } else if (eventType === 'api_request') {
                                  icon = <ArrowRight className="w-4 h-4" />
                                  label = `API Request #${apiPairIndex + 1}`
                                  content = requestText[apiPairIndex]
                                  colorClass = 'text-green-600'
                                } else if (eventType === 'api_response') {
                                  icon = <ArrowLeft className="w-4 h-4" />
                                  label = `API Response #${apiPairIndex + 1}`
                                  content = responseText[apiPairIndex]
                                  apiPairIndex++
                                  colorClass = 'text-green-600'
                                } else if (eventType === 'tool_call') {
                                  const toolCall = toolCalls[toolCallIndex]
                                  icon = <Wrench className="w-4 h-4" />
                                  label = `Tool Call: ${(typeof toolCall === 'object' && toolCall?.tool) || 'Unknown'}`
                                  content = toolCall
                                  toolCallIndex++
                                  colorClass = 'text-purple-600'
                                }
                                
                                return (
                                  <details key={idx} className="group border border-gray-200 rounded-lg">
                                    <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors">
                                      <span className="text-xs font-mono text-gray-400 w-6">{displayIndex}</span>
                                      <span className={colorClass}>{icon}</span>
                                      <Badge variant="outline" className="text-xs">
                                        {label}
                                      </Badge>
                                      {eventType === 'tool_call' && content && typeof content === 'object' && (
                                        <span className={`text-xs ml-auto ${content.success ? 'text-green-600' : 'text-red-600'}`}>
                                          {content.success ? '✓ Success' : '✗ Failed'}
                                        </span>
                                      )}
                                    </summary>
                                    <div className="px-4 pb-4 pt-2 border-t border-gray-100">
                                      {eventType === 'tool_call' && content && typeof content === 'object' ? (
                                        <div className="space-y-3">
                                          <div className="grid grid-cols-2 gap-3 text-xs">
                                            <div>
                                              <span className="text-gray-600">Tool:</span>
                                              <span className="ml-2 font-medium">{content.tool}</span>
                                            </div>
                                            <div>
                                              <span className="text-gray-600">Duration:</span>
                                              <span className="ml-2 font-medium">{content.duration_ms}ms</span>
                                            </div>
                                          </div>
                                          {content.result !== undefined && (
                                            <div>
                                              <div className="text-xs text-gray-600 mb-1">Result:</div>
                                              <pre className="bg-gray-50 p-3 rounded overflow-auto max-h-[200px] text-xs font-mono">
                                                {typeof content.result === 'object' ? JSON.stringify(content.result, null, 2) : String(content.result)}
                                              </pre>
                                            </div>
                                          )}
                                        </div>
                                      ) : content ? (
                                        <pre className="bg-gray-50 p-3 rounded overflow-auto max-h-[300px] text-xs font-mono whitespace-pre-wrap">
                                          {(() => {
                                            if (typeof content === 'string') {
                                              try {
                                                const parsed = JSON.parse(content)
                                                return JSON.stringify(parsed, null, 2)
                                              } catch {
                                                return content
                                              }
                                            }
                                            return JSON.stringify(content, null, 2)
                                          })()}
                                        </pre>
                                      ) : (
                                        <div className="text-xs text-gray-500">No additional data</div>
                                      )}
                                    </div>
                                  </details>
                                )
                              }).filter(Boolean)
                            })()}
                          </div>

                          {/* Full Telemetry JSON */}
                          <details className="mt-4">
                            <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-800">
                              View full telemetry JSON
                            </summary>
                            <pre className="mt-2 bg-gray-50 p-3 rounded overflow-auto max-h-[300px] text-xs font-mono">
                              {JSON.stringify(executionData.telemetry, null, 2)}
                            </pre>
                          </details>
                          </>
                        ) : (
                          <div className="text-sm text-gray-500 italic">
                            Telemetry not available
                          </div>
                        )}
                      </div>

                      {/* Artifacts */}
                      <div>
                        <div className="text-sm font-medium text-gray-700 mb-2">Artifacts</div>
                        {(() => {
                          const filteredArtifacts = artifacts.filter(
                            (a) => a.topic !== 'MEMORY' && a.topic !== 'SITUATION' && a.topic !== 'WORKER_TELEMETRY'
                          )
                          
                          if (loadingArtifacts) {
                            return <div className="text-gray-500 text-sm">Loading artifacts...</div>
                          }
                          
                          if (filteredArtifacts.length === 0) {
                            return <div className="text-gray-500 text-sm">No artifacts created</div>
                          }

                          return (
                            <div className="border border-gray-200 rounded-lg overflow-hidden">
                              <table className="w-full border-collapse text-sm">
                                <thead>
                                  <tr className="bg-gray-50 border-b border-gray-200">
                                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-700">Name</th>
                                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-700">Topic</th>
                                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-700">Preview</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {filteredArtifacts.map((artifact) => (
                                    <tr key={artifact.id} className="border-b border-gray-100 hover:bg-gray-50">
                                      <td className="px-3 py-2">
                                        <Link
                                          href={`/artifacts/${artifact.id}`}
                                          className="text-blue-600 hover:text-blue-800 hover:underline"
                                        >
                                          {artifact.name || 'Unnamed'}
                                        </Link>
                                      </td>
                                      <td className="px-3 py-2 text-gray-600">{artifact.topic || '-'}</td>
                                      <td className="px-3 py-2 text-gray-600 text-xs">
                                        {artifact.contentPreview 
                                          ? (artifact.contentPreview.length > 50 
                                              ? artifact.contentPreview.substring(0, 50) + '...' 
                                              : artifact.contentPreview)
                                          : '-'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )
                        })()}
                      </div>

                      {/* Child Jobs Spawned */}
                      <ChildJobsSection parentRequestId={record.id} />
                    </>
                  ) : (
                    <div className="text-gray-500 text-sm">No data available</div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Worker Telemetry */}
            <WorkerTelemetryCard 
              telemetryLog={workerTelemetry}
              loading={loadingWorkerTelemetry}
            />

            {/* Reflection */}
            <Card>
              <CardHeader>
                <CardTitle>Reflection</CardTitle>
              </CardHeader>
              <CardContent>
                {record.delivered ? (
                  <div className="space-y-4">
                    <div>
                      <div className="text-sm font-medium text-gray-700 mb-2">Memory Artifacts</div>
                      {(() => {
                        // Try to get memory artifacts from multiple sources:
                        // 1. From Ponder artifacts (on-chain)
                        const ponderMemoryArtifacts = artifacts.filter((a) => a.topic === 'MEMORY')
                        
                        // 2. From delivery reflection data (new flow)
                        const reflectionMemoryArtifacts: Artifact[] = []
                        if (deliveryData?.reflection?.telemetry?.toolCalls) {
                          deliveryData.reflection.telemetry.toolCalls.forEach((call) => {
                            if (call.tool === 'create_artifact' && call.result && call.success) {
                              reflectionMemoryArtifacts.push({
                                id: call.result.cid || 'inline',
                                name: call.result.name,
                                topic: call.result.topic || 'MEMORY',
                                cid: call.result.cid,
                                contentPreview: call.result.contentPreview
                              })
                            }
                          })
                        }
                        
                        const allMemoryArtifacts = [...ponderMemoryArtifacts, ...reflectionMemoryArtifacts]
                        
                        if (loadingArtifacts || loadingDelivery) {
                          return <div className="text-gray-500 text-sm">Loading...</div>
                        }
                        
                        if (allMemoryArtifacts.length === 0) {
                          return <div className="text-gray-500 text-sm">No memory artifacts created</div>
                        }

                        return (
                          <div className="space-y-2">
                            {allMemoryArtifacts.map((artifact) => (
                              <div key={artifact.id || artifact.cid}>
                                {artifact.cid ? (
                                  <a
                                    href={`https://gateway.autonolas.tech/ipfs/${artifact.cid}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:text-blue-800 hover:underline text-sm inline-flex items-center gap-1"
                                  >
                                    {artifact.name || 'Unnamed Memory Artifact'}
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                ) : (
                                  <Link
                                    href={`/artifacts/${artifact.id}`}
                                    className="text-blue-600 hover:text-blue-800 hover:underline text-sm"
                                  >
                                    {artifact.name || 'Unnamed Memory Artifact'}
                                  </Link>
                                )}
                              </div>
                            ))}
                          </div>
                        )
                      })()}
                    </div>

                    {memoryData?.hasSituation ? (
                      <>
                        <div>
                          <div className="text-sm font-medium text-gray-700 mb-2">Situation Data</div>
                          <div className="flex items-center gap-4 text-sm text-gray-600">
                            <div className="flex items-center gap-2">
                              <Check className="w-4 h-4 text-green-600" />
                              <span>JSON created</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Check className="w-4 h-4 text-green-600" />
                              <span>Embedding created</span>
                            </div>
                          </div>
                        </div>

                        <details className="mt-4">
                          <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-800">
                            Show raw JSON
                          </summary>
                          <pre className="mt-2 bg-gray-50 p-3 rounded overflow-auto max-h-[300px] text-xs font-mono">
                            {JSON.stringify(memoryData.situation, null, 2)}
                          </pre>
                        </details>
                      </>
                    ) : (
                      <div className="text-sm text-gray-600">Situation data not available</div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-gray-600">Job not yet delivered</div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar - 4/12 width */}
          <div className="w-80">
            <Card>
              <CardHeader>
                <CardTitle>Job Info</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* View in Workstream Link - moved to top */}
                  {loadingWorkstream ? (
                    <div className="text-gray-500 text-sm">Loading workstream...</div>
                  ) : workstreamId ? (
                    <div className="pb-2 border-b">
                      <Link
                        href={`/workstreams/${workstreamId}`}
                        className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        <GitBranch className="w-4 h-4" />
                        View in Workstream
                      </Link>
                    </div>
                  ) : null}

                  <div>
                    <div className="text-sm font-medium text-gray-700 mb-1">Requested Time</div>
                    <div className="text-sm text-gray-600">
                      {new Date(Number(record.blockTimestamp) * 1000).toLocaleString()}
                    </div>
                  </div>

                  <div>
                    <div className="text-sm font-medium text-gray-700 mb-1">Requested Block</div>
                    <a
                      href={`https://basescan.org/block/${record.blockNumber}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline text-sm"
                    >
                      {record.blockNumber}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  <div>
                    <div className="text-sm font-medium text-gray-700 mb-1">Job ID</div>
                    <div className="text-sm text-gray-600 font-mono break-all">
                      {record.id}
                    </div>
                  </div>

                  <div>
                    <div className="text-sm font-medium text-gray-700 mb-1">Mech Address</div>
                    <a
                      href={`https://basescan.org/address/${record.mech}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-start gap-1 text-blue-600 hover:text-blue-800 hover:underline text-sm font-mono break-all"
                    >
                      <span className="break-all">{record.mech}</span>
                      <ExternalLink className="w-3 h-3 flex-shrink-0 mt-0.5" />
                    </a>
                  </div>

                  <div>
                    <div className="text-sm font-medium text-gray-700 mb-1">Sender Address</div>
                    <a
                      href={`https://basescan.org/address/${record.sender}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-start gap-1 text-blue-600 hover:text-blue-800 hover:underline text-sm font-mono break-all"
                    >
                      <span className="break-all">{record.sender}</span>
                      <ExternalLink className="w-3 h-3 flex-shrink-0 mt-0.5" />
                    </a>
                  </div>

                  <div>
                    <div className="text-sm font-medium text-gray-700 mb-1">Job Definition ID</div>
                    {record.jobDefinitionId ? (
                      <Link
                        href={`/jobDefinitions/${record.jobDefinitionId}`}
                        className="text-blue-600 hover:text-blue-800 hover:underline text-sm font-mono break-all"
                      >
                        {record.jobDefinitionId}
                      </Link>
                    ) : (
                      <div className="text-gray-500 text-sm">N/A</div>
                    )}
                  </div>

                  <div>
                    <div className="text-sm font-medium text-gray-700 mb-1">Source Request ID</div>
                    {record.sourceRequestId ? (
                      <Link
                        href={`/requests/${record.sourceRequestId}`}
                        className="text-blue-600 hover:text-blue-800 hover:underline text-sm font-mono break-all"
                      >
                        {record.sourceRequestId}
                      </Link>
                    ) : (
                      <div className="text-gray-500 text-sm">N/A</div>
                    )}
                  </div>

                  <div>
                    <div className="text-sm font-medium text-gray-700 mb-1">Source Job Definition ID</div>
                    {record.sourceJobDefinitionId ? (
                      <Link
                        href={`/jobDefinitions/${record.sourceJobDefinitionId}`}
                        className="text-blue-600 hover:text-blue-800 hover:underline text-sm font-mono break-all"
                      >
                        {record.sourceJobDefinitionId}
                      </Link>
                    ) : (
                      <div className="text-gray-500 text-sm">N/A</div>
        )}
      </div>

                  <div>
                    <div className="text-sm font-medium text-gray-700 mb-1">Delivered Status</div>
                    <span className={`inline-flex items-center px-2 py-1 rounded text-xs border ${
                      record.delivered
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : 'bg-gray-50 text-gray-700 border-gray-200'
                    }`}>
                      {record.delivered ? '✓ Delivered' : 'Pending'}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Dependencies Section - show if job has dependencies or is required by other jobs */}
            <DependenciesSection requestId={record.id} dependencies={record.dependencies} />
      </div>
    </div>
      </TabsContent>

      <TabsContent value="raw" className="mt-0">
        <div className="space-y-6">
          {/* Base Request Data */}
          <Card>
            <CardHeader>
              <CardTitle>Job Data</CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                Composite record from Ponder&apos;s <code className="text-xs bg-gray-100 px-1 rounded">request</code> table. 
                Combines the original <code className="text-xs bg-gray-100 px-1 rounded">MarketplaceRequest</code> event data 
                with enrichments from the <code className="text-xs bg-gray-100 px-1 rounded">OlasMech:Deliver</code> event 
                (e.g., <code className="text-xs bg-gray-100 px-1 rounded">deliveryIpfsHash</code>, <code className="text-xs bg-gray-100 px-1 rounded">delivered: true</code>).
              </p>
            </CardHeader>
            <CardContent>
              <pre className="bg-gray-50 p-4 rounded overflow-auto max-h-[400px] text-xs font-mono">
                {JSON.stringify(record, null, 2)}
              </pre>
            </CardContent>
          </Card>

          {/* Job Definition */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Job Definition Record</CardTitle>
                  <p className="text-sm text-gray-600 mt-1">
                    Record from Ponder&apos;s <code className="text-xs bg-gray-100 px-1 rounded">jobDefinition</code> table, 
                    referenced by <code className="text-xs bg-gray-100 px-1 rounded">request.jobDefinitionId</code>
                  </p>
                </div>
                {record.jobDefinitionId && (
                  <Link 
                    href={`/jobDefinitions/${record.jobDefinitionId}`}
                    className="text-sm text-blue-600 hover:text-blue-800 hover:underline whitespace-nowrap"
                  >
                    View Full →
                  </Link>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!record.jobDefinitionId ? (
                <div className="text-gray-500 text-sm">No job definition for this request</div>
              ) : jobDefinition ? (
                <pre className="bg-gray-50 p-4 rounded overflow-auto max-h-[400px] text-xs font-mono">
                  {JSON.stringify(jobDefinition, null, 2)}
                </pre>
              ) : (
                <div className="text-gray-500 text-sm">Loading...</div>
              )}
            </CardContent>
          </Card>

          {/* Blueprint Content (IPFS) */}
          <Card>
            <CardHeader>
              <CardTitle>Request IPFS Content</CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                Fetched from <code className="text-xs bg-gray-100 px-1 rounded">request.ipfsHash</code> - 
                the blueprint specification uploaded when posting the <code className="text-xs bg-gray-100 px-1 rounded">MarketplaceRequest</code> event
              </p>
            </CardHeader>
            <CardContent>
              {!record.ipfsHash ? (
                <div className="text-gray-500 text-sm">No IPFS hash for this request</div>
              ) : promptContent ? (
                <pre className="bg-gray-50 p-4 rounded overflow-auto max-h-[400px] text-xs font-mono whitespace-pre-wrap">
                  {promptContent}
                </pre>
              ) : (
                <div className="text-gray-500 text-sm">Loading...</div>
              )}
            </CardContent>
          </Card>

          {/* Source Request */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Source Request Record</CardTitle>
                  <p className="text-sm text-gray-600 mt-1">
                    Parent request record from Ponder&apos;s <code className="text-xs bg-gray-100 px-1 rounded">request</code> table, 
                    referenced by <code className="text-xs bg-gray-100 px-1 rounded">request.sourceRequestId</code> (for Work Protocol jobs)
                  </p>
                </div>
                {record.sourceRequestId && (
                  <Link 
                    href={`/requests/${record.sourceRequestId}`}
                    className="text-sm text-blue-600 hover:text-blue-800 hover:underline whitespace-nowrap"
                  >
                    View Full →
                  </Link>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!record.sourceRequestId ? (
                <div className="text-gray-500 text-sm">No source request for this job</div>
              ) : sourceRequest ? (
                <pre className="bg-gray-50 p-4 rounded overflow-auto max-h-[400px] text-xs font-mono">
                  {JSON.stringify(sourceRequest, null, 2)}
                </pre>
              ) : (
                <div className="text-gray-500 text-sm">Loading...</div>
              )}
            </CardContent>
          </Card>

          {/* Source Job Definition */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Source Job Definition Record</CardTitle>
                  <p className="text-sm text-gray-600 mt-1">
                    Parent job definition record from Ponder&apos;s <code className="text-xs bg-gray-100 px-1 rounded">jobDefinition</code> table, 
                    referenced by <code className="text-xs bg-gray-100 px-1 rounded">request.sourceJobDefinitionId</code> (for Work Protocol jobs)
                  </p>
                </div>
                {record.sourceJobDefinitionId && (
                  <Link 
                    href={`/jobDefinitions/${record.sourceJobDefinitionId}`}
                    className="text-sm text-blue-600 hover:text-blue-800 hover:underline whitespace-nowrap"
                  >
                    View Full →
                  </Link>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!record.sourceJobDefinitionId ? (
                <div className="text-gray-500 text-sm">No source job definition for this request</div>
              ) : sourceJobDef ? (
                <pre className="bg-gray-50 p-4 rounded overflow-auto max-h-[400px] text-xs font-mono">
                  {JSON.stringify(sourceJobDef, null, 2)}
                </pre>
              ) : (
                <div className="text-gray-500 text-sm">Loading...</div>
              )}
            </CardContent>
          </Card>

          {/* Delivery Content (IPFS) */}
          <Card>
            <CardHeader>
              <CardTitle>Delivery IPFS Content</CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                Fetched from <code className="text-xs bg-gray-100 px-1 rounded">request.deliveryIpfsHash</code> - 
                the result payload uploaded when the worker delivered via the <code className="text-xs bg-gray-100 px-1 rounded">OlasMech:Deliver</code> event
              </p>
            </CardHeader>
            <CardContent>
              {!record.delivered ? (
                <div className="text-gray-500 text-sm">Job not yet delivered</div>
              ) : !record.deliveryIpfsHash ? (
                <div className="text-gray-500 text-sm">No delivery IPFS hash for this job</div>
              ) : deliveryData ? (
                <pre className="bg-gray-50 p-4 rounded overflow-auto max-h-[400px] text-xs font-mono whitespace-pre-wrap">
                  {JSON.stringify(deliveryData, null, 2)}
                </pre>
              ) : deliveryContent ? (
                <pre className="bg-gray-50 p-4 rounded overflow-auto max-h-[400px] text-xs font-mono whitespace-pre-wrap">
                  {deliveryContent}
                </pre>
              ) : (
                <div className="text-gray-500 text-sm">Loading...</div>
              )}
            </CardContent>
          </Card>

          {/* Memory Data */}
          <Card>
            <CardHeader>
              <CardTitle>Memory System Data</CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                Reflection artifacts (<code className="text-xs bg-gray-100 px-1 rounded">MEMORY</code>, <code className="text-xs bg-gray-100 px-1 rounded">SITUATION</code>) 
                and recognition phase data fetched from artifact IPFS content and enriched with embeddings
              </p>
            </CardHeader>
            <CardContent>
              {!memoryData || (!memoryData.hasSituation && !memoryData.hasRecognition) ? (
                <div className="text-gray-500 text-sm">No memory system data for this job</div>
              ) : (
                <pre className="bg-gray-50 p-4 rounded overflow-auto max-h-[400px] text-xs font-mono">
                  {JSON.stringify({
                    situation: memoryData.situation,
                    recognition: memoryData.recognition,
                    hasSituation: memoryData.hasSituation,
                    hasRecognition: memoryData.hasRecognition
                  }, null, 2)}
                </pre>
              )}
            </CardContent>
          </Card>
        </div>
      </TabsContent>
    </Tabs>
  )
}

