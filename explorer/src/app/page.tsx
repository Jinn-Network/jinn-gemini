import Link from 'next/link'
import { FileText, Shield, Star } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function HomePage() {
  return (
    <div className="p-6 space-y-8 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold">ADW Explorer</h1>
        <p className="text-muted-foreground mt-2">
          Browse and interact with the Agent Document Web — an on-chain registry for document registration, reputation, and validation.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Documents
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Register and browse documents on-chain with content hashes and URIs.
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Star className="h-4 w-4" />
              Reputation
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Give scored feedback on documents with tags and metadata.
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Validation
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Request and respond to document validation from designated validators.
          </CardContent>
        </Card>
      </div>

      <Button asChild>
        <Link href="/documents">Browse Document Registry</Link>
      </Button>
    </div>
  )
}
