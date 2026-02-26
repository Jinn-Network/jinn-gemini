import Link from 'next/link'
import { FileText, Plus } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getDocumentRegisteredEvents } from '@/lib/adw/events'
import { formatDate } from '@/lib/utils'

export const metadata = { title: 'Document Registry — ADW Explorer' }

function truncate(s: string, n = 12) {
  if (s.length <= n * 2 + 3) return s
  return `${s.slice(0, n)}…${s.slice(-6)}`
}

export default async function DocumentsPage() {
  const events = await getDocumentRegisteredEvents()

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6" />
            Document Registry
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {events.length} document{events.length !== 1 ? 's' : ''} registered on-chain
          </p>
        </div>
        <Button asChild>
          <Link href="/documents/register">
            <Plus className="h-4 w-4 mr-1" />
            Register Document
          </Link>
        </Button>
      </div>

      {events.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">No documents registered yet</p>
          <p className="text-sm mt-1">Be the first to register a document.</p>
          <Button asChild className="mt-4" variant="outline">
            <Link href="/documents/register">Register a Document</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          {[...events].reverse().map((log) => {
            const id = log.args.documentId?.toString() ?? '?'
            const creator = log.args.creator ?? ''
            const docType = log.args.documentType ?? ''
            const docURI = log.args.documentURI ?? ''
            const contentHash = log.args.contentHash ?? ''
            const timestamp = log.args.timestamp

            return (
              <Link key={`${id}-${log.transactionHash}`} href={`/documents/${id}`}>
                <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">Document #{id}</CardTitle>
                      {docType && (
                        <Badge variant="secondary" className="shrink-0 text-xs">
                          {docType}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm text-muted-foreground">
                    {docURI && (
                      <p className="truncate" title={docURI}>
                        <span className="font-medium text-foreground">URI:</span> {truncate(docURI, 30)}
                      </p>
                    )}
                    {creator && (
                      <p>
                        <span className="font-medium text-foreground">Creator:</span>{' '}
                        <span className="font-mono">{truncate(creator, 8)}</span>
                      </p>
                    )}
                    {contentHash && contentHash !== '0x0000000000000000000000000000000000000000000000000000000000000000' && (
                      <p>
                        <span className="font-medium text-foreground">Hash:</span>{' '}
                        <span className="font-mono text-xs">{truncate(contentHash, 10)}</span>
                      </p>
                    )}
                    {timestamp != null && (
                      <p className="text-xs">{formatDate(Number(timestamp))}</p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
