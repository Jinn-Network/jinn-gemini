import Link from 'next/link'
import { FileText, Plus } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getADWDocuments } from '@/lib/adw/ponder'
import { formatDate } from '@/lib/utils'

export const metadata = { title: 'Document Registry — ADW Explorer' }

function truncateAddress(s: string, n = 6) {
  if (s.length <= n * 2 + 3) return s
  return `${s.slice(0, n + 2)}…${s.slice(-n)}`
}

export default async function DocumentsPage() {
  const documents = await getADWDocuments()

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6" />
            Document Registry
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {documents.length} ADW document{documents.length !== 1 ? 's' : ''} indexed
          </p>
        </div>
        <Button asChild>
          <Link href="/documents/register">
            <Plus className="h-4 w-4 mr-1" />
            Register Document
          </Link>
        </Button>
      </div>

      {documents.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">No ADW documents found yet</p>
          <p className="text-sm mt-1">Documents will appear here as they are registered on-chain.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {documents.map((doc) => (
            <Link key={doc.id} href={`/documents/${doc.id}`}>
              <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base font-mono">#{doc.id}</CardTitle>
                    <div className="flex gap-1 shrink-0">
                      <Badge variant="secondary" className="text-xs">
                        {doc.documentType.replace('adw:', '')}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1 text-sm text-muted-foreground">
                  <p className="font-mono text-xs truncate">{doc.documentURI}</p>
                  <div className="flex items-center gap-3 text-xs">
                    <span>
                      <span className="font-medium text-foreground">Creator:</span>{' '}
                      <span className="font-mono">{truncateAddress(doc.creator)}</span>
                    </span>
                    <span>{formatDate(doc.timestamp)}</span>
                    {doc.feedbackCount > 0 && (
                      <span>
                        <span className="font-medium text-foreground">Feedback:</span>{' '}
                        {doc.feedbackCount}
                        {doc.avgScore != null && ` (avg ${doc.avgScore.toFixed(1)})`}
                      </span>
                    )}
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
