import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TrustBadge } from '@/components/adw/trust-badge'
import { getADWDocumentByCid, fetchRegistrationFile } from '@/lib/adw/ponder'
import { formatDate } from '@/lib/utils'

export const metadata = { title: 'Document Detail — ADW Explorer' }

interface DocumentDetailPageProps {
  params: Promise<{ id: string }>
}

function truncate(s: string, n = 12) {
  if (s.length <= n * 2 + 3) return s
  return `${s.slice(0, n)}…${s.slice(-6)}`
}

const IPFS_GATEWAY = 'https://gateway.autonolas.tech/ipfs/'

export default async function DocumentDetailPage({ params }: DocumentDetailPageProps) {
  const { id: cid } = await params
  const decodedCid = decodeURIComponent(cid)

  const [artifact, registration] = await Promise.all([
    getADWDocumentByCid(decodedCid),
    fetchRegistrationFile(decodedCid),
  ])

  if (!artifact) {
    notFound()
  }

  // Determine trust level from the Registration File
  const trustLevel = registration?.trust?.creatorProof ? 1 : 0

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/documents">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Registry
          </Link>
        </Button>
        <h1 className="text-2xl font-bold flex-1 min-w-0 truncate">
          {registration?.name ?? artifact.topic}
        </h1>
        <TrustBadge level={trustLevel} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="provenance">Provenance</TabsTrigger>
          <TabsTrigger value="raw">Raw Registration File</TabsTrigger>
        </TabsList>

        {/* ── Overview ── */}
        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Document Identity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-[140px,1fr] gap-y-2">
                <span className="text-muted-foreground">Document Type</span>
                <Badge variant="secondary" className="w-fit">
                  {artifact.documentType ?? 'Unknown'}
                </Badge>

                {artifact.type && (
                  <>
                    <span className="text-muted-foreground">Artifact Type</span>
                    <Badge variant="outline" className="w-fit">{artifact.type}</Badge>
                  </>
                )}

                <span className="text-muted-foreground">Registration CID</span>
                <a
                  href={`${IPFS_GATEWAY}${artifact.cid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-blue-500 hover:underline flex items-center gap-1"
                >
                  {truncate(artifact.cid, 14)}
                  <ExternalLink className="h-3 w-3" />
                </a>

                {artifact.contentCid && (
                  <>
                    <span className="text-muted-foreground">Content CID</span>
                    <a
                      href={`${IPFS_GATEWAY}${artifact.contentCid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-blue-500 hover:underline flex items-center gap-1"
                    >
                      {truncate(artifact.contentCid, 14)}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </>
                )}

                {registration?.creator && (
                  <>
                    <span className="text-muted-foreground">Creator</span>
                    <span className="font-mono text-xs">{registration.creator}</span>
                  </>
                )}

                {registration?.created && (
                  <>
                    <span className="text-muted-foreground">Created</span>
                    <span>{new Date(registration.created).toLocaleString()}</span>
                  </>
                )}

                <span className="text-muted-foreground">Block Timestamp</span>
                <span>{formatDate(artifact.blockTimestamp)}</span>

                <span className="text-muted-foreground">Trust Level</span>
                <TrustBadge level={trustLevel} />
              </div>

              {registration?.description && (
                <div className="pt-2">
                  <span className="text-muted-foreground text-xs">Description</span>
                  <p className="mt-1">{registration.description}</p>
                </div>
              )}

              {artifact.contentPreview && (
                <div className="pt-2">
                  <span className="text-muted-foreground text-xs">Content Preview</span>
                  <p className="mt-1 text-xs bg-muted p-3 rounded-md whitespace-pre-wrap font-mono">
                    {artifact.contentPreview}
                  </p>
                </div>
              )}

              {artifact.tags && artifact.tags.length > 0 && (
                <div className="pt-2">
                  <span className="text-muted-foreground text-xs">Tags</span>
                  <div className="flex gap-1 flex-wrap mt-1">
                    {artifact.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs font-normal">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Provenance ── */}
        <TabsContent value="provenance">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Execution Provenance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {registration?.provenance ? (
                <pre className="text-xs bg-muted p-4 rounded-md overflow-auto max-h-96">
                  {JSON.stringify(registration.provenance, null, 2)}
                </pre>
              ) : (
                <p className="text-muted-foreground">No provenance data available.</p>
              )}

              {registration?.trust && (
                <div className="pt-2">
                  <span className="text-muted-foreground text-xs">Trust Data</span>
                  <pre className="text-xs bg-muted p-4 rounded-md overflow-auto max-h-96 mt-1">
                    {JSON.stringify(registration.trust, null, 2)}
                  </pre>
                </div>
              )}

              {registration?.storage && registration.storage.length > 0 && (
                <div className="pt-2">
                  <span className="text-muted-foreground text-xs">Storage Locations</span>
                  <div className="mt-1 space-y-1">
                    {registration.storage.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <Badge variant="outline" className="font-normal">{s.provider}</Badge>
                        <a
                          href={s.uri.startsWith('ipfs://') ? `${s.gateway ?? IPFS_GATEWAY}${s.uri.replace('ipfs://', '')}` : s.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-500 hover:underline font-mono truncate flex items-center gap-1"
                        >
                          {s.uri}
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Raw Registration File ── */}
        <TabsContent value="raw">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Registration File (IPFS)</CardTitle>
            </CardHeader>
            <CardContent>
              {registration ? (
                <pre className="text-xs bg-muted p-4 rounded-md overflow-auto max-h-[600px]">
                  {JSON.stringify(registration, null, 2)}
                </pre>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Could not fetch Registration File from IPFS. The CID may not be available on the gateway yet.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
