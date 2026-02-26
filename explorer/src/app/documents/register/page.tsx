'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount } from 'wagmi'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TransactionStatus } from '@/components/adw/transaction-status'
import { WalletButton } from '@/components/wallet-button'
import { useRegisterDocument } from '@/lib/adw/hooks'
import { DOCUMENT_TYPES } from '@/lib/adw/contracts'

export default function RegisterDocumentPage() {
  const router = useRouter()
  const { isConnected } = useAccount()
  const [documentURI, setDocumentURI] = useState('')
  const [contentHash, setContentHash] = useState('')
  const [documentType, setDocumentType] = useState('')

  const { register, hash, isPending, isConfirming, isSuccess, error } = useRegisterDocument()

  useEffect(() => {
    if (isSuccess && hash) {
      // Give the user a moment to see the success state, then navigate to list
      const t = setTimeout(() => router.push('/documents'), 2000)
      return () => clearTimeout(t)
    }
  }, [isSuccess, hash, router])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isConnected) return
    const hashHex = contentHash.startsWith('0x') ? contentHash : `0x${contentHash}`
    register({
      documentURI,
      contentHash: hashHex as `0x${string}`,
      documentType,
    })
  }

  return (
    <div className="p-6 max-w-xl">
      <h1 className="text-2xl font-bold mb-6">Register Document</h1>

      {!isConnected ? (
        <Card>
          <CardContent className="py-10 text-center space-y-4">
            <p className="text-muted-foreground">Connect your wallet to register a document on-chain.</p>
            <WalletButton />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Document Details</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1">
                <Label htmlFor="documentURI">Document URI</Label>
                <Input
                  id="documentURI"
                  placeholder="ipfs://… or https://…"
                  value={documentURI}
                  onChange={e => setDocumentURI(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">URI pointing to the document registration file.</p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="contentHash">Content Hash (bytes32 hex)</Label>
                <Input
                  id="contentHash"
                  placeholder="0x0000000000000000000000000000000000000000000000000000000000000000"
                  value={contentHash}
                  onChange={e => setContentHash(e.target.value)}
                  className="font-mono text-sm"
                  required
                />
                <p className="text-xs text-muted-foreground">SHA-256 digest of the document content as 32-byte hex.</p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="documentType">Document Type</Label>
                <Select value={documentType} onValueChange={setDocumentType} required>
                  <SelectTrigger id="documentType">
                    <SelectValue placeholder="Select a type…" />
                  </SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_TYPES.map(t => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <TransactionStatus
                isPending={isPending}
                isConfirming={isConfirming}
                isSuccess={isSuccess}
                error={error}
                hash={hash}
              />
              {isSuccess && (
                <p className="text-sm text-green-600 dark:text-green-400">
                  Registered! Redirecting to document list…
                </p>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={isPending || isConfirming || isSuccess || !documentURI || !contentHash || !documentType}
              >
                {isPending || isConfirming ? 'Registering…' : 'Register Document'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
