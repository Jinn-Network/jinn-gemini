import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TrustBadge, computeTrustLevel } from '@/components/adw/trust-badge'
import { AddressDisplay } from '@/components/adw/address-display'
import { GiveFeedbackDialog } from '@/components/adw/give-feedback-dialog'
import { RequestValidationDialog } from '@/components/adw/request-validation-dialog'
import { RespondValidationDialog } from '@/components/adw/respond-validation-dialog'
import { getRpcClient } from '@/lib/rpc'
import { ADWDocumentRegistryABI } from '@/lib/adw/abi'
import { DOCUMENT_REGISTRY_ADDRESS } from '@/lib/adw/contracts'
import {
  getFeedbackEvents,
  getValidationRequestedEvents,
  getValidationRespondedEvents,
} from '@/lib/adw/events'
import { formatDate } from '@/lib/utils'

export const metadata = { title: 'Document Detail — ADW Explorer' }

interface DocumentDetailPageProps {
  params: Promise<{ id: string }>
}

async function fetchDocumentState(documentId: bigint) {
  const client = getRpcClient()
  const [uri, owner, contentHash] = await Promise.all([
    client.readContract({
      address: DOCUMENT_REGISTRY_ADDRESS,
      abi: ADWDocumentRegistryABI,
      functionName: 'resolve',
      args: [documentId],
    }).catch(() => null),
    client.readContract({
      address: DOCUMENT_REGISTRY_ADDRESS,
      abi: ADWDocumentRegistryABI,
      functionName: 'ownerOf',
      args: [documentId],
    }).catch(() => null),
    client.readContract({
      address: DOCUMENT_REGISTRY_ADDRESS,
      abi: ADWDocumentRegistryABI,
      functionName: 'documentContentHashes',
      args: [documentId],
    }).catch(() => null),
  ])
  return { uri, owner, contentHash }
}

export default async function DocumentDetailPage({ params }: DocumentDetailPageProps) {
  const { id } = await params
  const documentId = BigInt(id)

  const [state, feedbackLogs, validationRequestLogs] = await Promise.all([
    fetchDocumentState(documentId),
    getFeedbackEvents(documentId),
    getValidationRequestedEvents(documentId),
  ])

  // If document doesn't exist (ownerOf reverted)
  if (state.owner === null) {
    notFound()
  }

  // Fetch validation responses for this document's requests
  const requestHashes = validationRequestLogs
    .map(l => l.args.requestHash)
    .filter((h): h is `0x${string}` => h != null)
  const validationRespondedLogs = await getValidationRespondedEvents(requestHashes)

  // Compute trust level
  const trustLevel = computeTrustLevel(
    feedbackLogs.length > 0,
    validationRespondedLogs.length > 0
  )

  // Serialize feedback events for client components
  type FeedbackRow = {
    sender: string
    score: string
    decimals: number
    tag1: string
    tag2: string
    feedbackURI: string
    timestamp: string
    txHash: string | null
  }
  const feedbackRows: FeedbackRow[] = feedbackLogs.map(l => ({
    sender: l.args.sender ?? '',
    score: l.args.score?.toString() ?? '0',
    decimals: l.args.decimals ?? 2,
    tag1: l.args.tag1 ?? '',
    tag2: l.args.tag2 ?? '',
    feedbackURI: l.args.feedbackURI ?? '',
    timestamp: l.args.timestamp?.toString() ?? '0',
    txHash: l.transactionHash ?? null,
  }))

  // Compute average score
  let avgScore: string | null = null
  if (feedbackRows.length > 0) {
    const sum = feedbackRows.reduce((acc, r) => {
      const raw = parseInt(r.score, 10)
      const dec = r.decimals
      return acc + raw / 10 ** dec
    }, 0)
    avgScore = (sum / feedbackRows.length).toFixed(2)
  }

  // Serialize validation events
  type ValidationRow = {
    validator: string
    requester: string
    requestURI: string
    requestHash: string
    timestamp: string
    responded: boolean
    response?: number
    responseURI?: string
    tag?: string
    responsedAt?: string
  }
  const respondedByHash = new Map(validationRespondedLogs.map(l => [l.args.requestHash, l]))
  const validationRows: ValidationRow[] = validationRequestLogs.map(l => {
    const rh = l.args.requestHash as `0x${string}` | undefined
    const responded = rh ? respondedByHash.get(rh) : undefined
    return {
      validator: l.args.validator ?? '',
      requester: l.args.requester ?? '',
      requestURI: l.args.requestURI ?? '',
      requestHash: rh ?? '',
      timestamp: l.args.timestamp?.toString() ?? '0',
      responded: responded != null,
      response: responded?.args.response,
      responseURI: responded?.args.responseURI,
      tag: responded?.args.tag,
      responsedAt: responded?.args.timestamp?.toString(),
    }
  })

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/documents">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Registry
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">Document #{id}</h1>
        <TrustBadge level={trustLevel} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="reputation">
            Reputation {feedbackRows.length > 0 && `(${feedbackRows.length})`}
          </TabsTrigger>
          <TabsTrigger value="validation">
            Validation {validationRows.length > 0 && `(${validationRows.length})`}
          </TabsTrigger>
        </TabsList>

        {/* ── Overview ── */}
        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Document Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-[120px,1fr] gap-y-2">
                <span className="text-muted-foreground">Document ID</span>
                <span className="font-mono">#{id}</span>

                <span className="text-muted-foreground">Owner</span>
                <AddressDisplay address={state.owner as string} />

                {state.uri && (
                  <>
                    <span className="text-muted-foreground">URI</span>
                    <a
                      href={state.uri.startsWith('ipfs://') ? state.uri.replace('ipfs://', 'https://ipfs.io/ipfs/') : state.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:underline truncate block"
                      title={state.uri}
                    >
                      {state.uri}
                    </a>
                  </>
                )}

                {state.contentHash && state.contentHash !== '0x0000000000000000000000000000000000000000000000000000000000000000' && (
                  <>
                    <span className="text-muted-foreground">Content Hash</span>
                    <span className="font-mono text-xs break-all">{state.contentHash}</span>
                  </>
                )}

                <span className="text-muted-foreground">Trust Level</span>
                <TrustBadge level={trustLevel} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Reputation ── */}
        <TabsContent value="reputation">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  {feedbackRows.length} feedback submission{feedbackRows.length !== 1 ? 's' : ''}
                  {avgScore && ` · Average score: ${avgScore}`}
                </p>
              </div>
              <GiveFeedbackDialog documentId={id} />
            </div>

            {feedbackRows.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground text-sm">
                  No feedback submitted yet.
                </CardContent>
              </Card>
            ) : (
              feedbackRows.map((row, i) => {
                const displayScore = parseInt(row.score) / 10 ** row.decimals
                return (
                  <Card key={i}>
                    <CardContent className="pt-4 space-y-1 text-sm">
                      <div className="flex items-center justify-between">
                        <AddressDisplay address={row.sender} />
                        <Badge variant="outline" className="font-mono">
                          {displayScore.toFixed(row.decimals > 0 ? 2 : 0)} / 10
                        </Badge>
                      </div>
                      {(row.tag1 || row.tag2) && (
                        <div className="flex gap-1">
                          {row.tag1 && <Badge variant="secondary" className="text-xs">{row.tag1}</Badge>}
                          {row.tag2 && <Badge variant="secondary" className="text-xs">{row.tag2}</Badge>}
                        </div>
                      )}
                      {row.feedbackURI && (
                        <p className="text-xs text-muted-foreground truncate">{row.feedbackURI}</p>
                      )}
                      <p className="text-xs text-muted-foreground">{formatDate(row.timestamp)}</p>
                    </CardContent>
                  </Card>
                )
              })
            )}
          </div>
        </TabsContent>

        {/* ── Validation ── */}
        <TabsContent value="validation">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {validationRows.length} validation request{validationRows.length !== 1 ? 's' : ''}
              </p>
              <RequestValidationDialog documentId={id} />
            </div>

            {validationRows.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground text-sm">
                  No validation requests yet.
                </CardContent>
              </Card>
            ) : (
              validationRows.map((row, i) => (
                <Card key={i}>
                  <CardContent className="pt-4 space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Validator</span>
                      <AddressDisplay address={row.validator} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Requester</span>
                      <AddressDisplay address={row.requester} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Status</span>
                      <Badge variant={row.responded ? 'default' : 'secondary'}>
                        {row.responded ? `Responded (${row.response}/100)` : 'Pending'}
                      </Badge>
                    </div>
                    {row.tag && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Tag</span>
                        <Badge variant="secondary" className="text-xs">{row.tag}</Badge>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Requested</span>
                      <span className="text-xs">{formatDate(row.timestamp)}</span>
                    </div>
                    {!row.responded && (
                      <div className="pt-1">
                        <RespondValidationDialog
                          requestHash={row.requestHash}
                          designatedValidator={row.validator}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
