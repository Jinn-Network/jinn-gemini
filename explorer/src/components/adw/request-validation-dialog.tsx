'use client'

import { useState } from 'react'
import { useAccount } from 'wagmi'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TransactionStatus } from '@/components/adw/transaction-status'
import { useRequestValidation } from '@/lib/adw/hooks'

interface RequestValidationDialogProps {
  documentId: string
}

export function RequestValidationDialog({ documentId }: RequestValidationDialogProps) {
  const { isConnected } = useAccount()
  const [open, setOpen] = useState(false)
  const [validator, setValidator] = useState('')
  const [requestURI, setRequestURI] = useState('')
  const [requestHash, setRequestHash] = useState('')

  const { requestValidation, hash, isPending, isConfirming, isSuccess, error, reset } = useRequestValidation()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validator.startsWith('0x') || validator.length !== 42) return
    const hashHex = requestHash.startsWith('0x') ? requestHash : `0x${requestHash}`
    requestValidation({
      validator: validator as `0x${string}`,
      documentId: BigInt(documentId),
      requestURI,
      requestHash: hashHex as `0x${string}`,
    })
  }

  const handleOpenChange = (v: boolean) => {
    if (!v) reset()
    setOpen(v)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={!isConnected}>
          {isConnected ? 'Request Validation' : 'Connect wallet to request validation'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request Validation — Document #{documentId}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="validator">Validator Address</Label>
            <Input
              id="validator"
              placeholder="0x…"
              value={validator}
              onChange={e => setValidator(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="requestURI">Request URI (optional)</Label>
            <Input id="requestURI" placeholder="ipfs://…" value={requestURI} onChange={e => setRequestURI(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="requestHash">Request Hash (bytes32 hex)</Label>
            <Input
              id="requestHash"
              placeholder="0x0000…0000"
              value={requestHash}
              onChange={e => setRequestHash(e.target.value)}
              required
            />
          </div>
          <TransactionStatus isPending={isPending} isConfirming={isConfirming} isSuccess={isSuccess} error={error} hash={hash} />
          <DialogFooter>
            <Button type="submit" disabled={isPending || isConfirming || !validator || !requestHash}>
              {isPending || isConfirming ? 'Submitting…' : 'Submit Request'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
