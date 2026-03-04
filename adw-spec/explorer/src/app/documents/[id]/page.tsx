import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TrustBadge } from '@/components/adw/trust-badge'
import { getADWDocumentById, fetchRegistrationFile } from '@/lib/adw/ponder'
import { formatDate } from '@/lib/utils'

export const metadata = { title: 'Document Detail — ADW Explorer' }

interface DocumentDetailPageProps {
  params: Promise<{ id: string }>
}

const IPFS_GATEWAY = 'https://gateway.autonolas.tech/ipfs/'

export default async function DocumentDetailPage({ params }: DocumentDetailPageProps) {
  const { id } = await params

  const document = await getADWDocumentById(id)
  if (!document) {
    notFound()
  }

  const registration = await fetchRegistrationFile(document.documentURI)

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
          {registration?.name ?? `Document #${document.id}`}
        </h1>
        <TrustBadge level={trustLevel} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="provenance">Provenance</TabsTrigger>
          <TabsTrigger value="raw">Raw Registration File</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Document Identity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-[140px,1fr] gap-y-2">
                <span className="text-muted-foreground">Document ID</span>
                <span className="font-mono">#{document.id}</span>

                <span className="text-muted-foreground">Document Type</span>
                <Badge variant="secondary" className="w-fit">
                  {document.documentType}
                </Badge>

                <span className="text-muted-foreground">Document URI</span>
                <a
                  href={document.documentURI.startsWith('ipfs://') ? `${IPFS_GATEWAY}${document.documentURI.replace('ipfs://', '')}` : document.documentURI}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-blue-500 hover:underline flex items-center gap-1 break-all"
                >
                  {document.documentURI}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>

                <span className="text-muted-foreground">Content Hash</span>
                <span className="font-mono text-xs break-all">{document.contentHash}</span>

                <span className="text-muted-foreground">Creator</span>
                <span className="font-mono text-xs">{document.creator}</span>

                <span className="text-muted-foreground">Timestamp</span>
                <span>{formatDate(document.timestamp)}</span>

                <span className="text-muted-foreground">Block</span>
                <span className="font-mono text-xs">{document.blockNumber}</span>

                <span className="text-muted-foreground">Transaction</span>
                <a
                  href={`https://basescan.org/tx/${document.transactionHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-blue-500 hover:underline flex items-center gap-1"
                >
                  {document.transactionHash.slice(0, 14)}…{document.transactionHash.slice(-8)}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>

                <span className="text-muted-foreground">Trust Level</span>
                <TrustBadge level={trustLevel} />

                <span className="text-muted-foreground">Feedback</span>
                <span>
                  {document.feedbackCount} response{document.feedbackCount !== 1 ? 's' : ''}
                  {document.avgScore != null && ` — avg score ${document.avgScore.toFixed(1)}`}
                </span>

                <span className="text-muted-foreground">Validations</span>
                <span>
                  {document.validationRequestCount} request{document.validationRequestCount !== 1 ? 's' : ''},{' '}
                  {document.validationResponseCount} response{document.validationResponseCount !== 1 ? 's' : ''}
                </span>
              </div>

              {registration?.description && (
                <div className="pt-2">
                  <span className="text-muted-foreground text-xs">Description</span>
                  <p className="mt-1">{registration.description}</p>
                </div>
              )}

              {registration?.tags && registration.tags.length > 0 && (
                <div className="pt-2">
                  <span className="text-muted-foreground text-xs">Tags</span>
                  <div className="flex gap-1 flex-wrap mt-1">
                    {registration.tags.map((tag) => (
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

        {/* Provenance */}
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
                          href={s.uri.startsWith('ipfs://') ? `${IPFS_GATEWAY}${s.uri.replace('ipfs://', '')}` : s.uri}
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

        {/* Raw Registration File */}
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
                  Could not fetch Registration File from IPFS. The document URI may not be available on the gateway yet.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
