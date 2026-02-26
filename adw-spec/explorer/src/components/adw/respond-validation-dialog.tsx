'use client'

import { useState } from 'react'
import { useAccount } from 'wagmi'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TransactionStatus } from '@/components/adw/transaction-status'
import { useRespondValidation } from '@/lib/adw/hooks'

interface RespondValidationDialogProps {
  requestHash: string
  designatedValidator: string
}

export function RespondValidationDialog({ requestHash, designatedValidator }: RespondValidationDialogProps) {
  const { address, isConnected } = useAccount()
  const [open, setOpen] = useState(false)
  const [response, setResponse] = useState('')
  const [responseURI, setResponseURI] = useState('')
  const [responseHash, setResponseHash] = useState('')
  const [tag, setTag] = useState('')

  const { respondValidation, hash, isPending, isConfirming, isSuccess, error, reset } = useRespondValidation()

  const isValidator = isConnected && address?.toLowerCase() === designatedValidator.toLowerCase()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const responseNum = parseInt(response, 10)
    if (isNaN(responseNum) || responseNum < 0 || responseNum > 100) return
    const hashHex = responseHash.startsWith('0x') ? responseHash : `0x${responseHash}`
    respondValidation({
      requestHash: requestHash as `0x${string}`,
      response: responseNum,
      responseURI,
      responseHash: hashHex as `0x${string}`,
      tag,
    })
  }

  const handleOpenChange = (v: boolean) => {
    if (!v) reset()
    setOpen(v)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={!isValidator}>
          {!isConnected ? 'Connect wallet' : !isValidator ? 'Not designated validator' : 'Respond'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Respond to Validation Request</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="response">Response Score (0–100)</Label>
            <Input
              id="response"
              type="number"
              min="0"
              max="100"
              placeholder="e.g. 85"
              value={response}
              onChange={e => setResponse(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="responseURI">Response URI (optional)</Label>
            <Input id="responseURI" placeholder="ipfs://…" value={responseURI} onChange={e => setResponseURI(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="responseHash">Response Hash (bytes32 hex)</Label>
            <Input
              id="responseHash"
              placeholder="0x0000…0000"
              value={responseHash}
              onChange={e => setResponseHash(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tag">Tag</Label>
            <Input id="tag" placeholder="e.g. reviewed" value={tag} onChange={e => setTag(e.target.value)} />
          </div>
          <TransactionStatus isPending={isPending} isConfirming={isConfirming} isSuccess={isSuccess} error={error} hash={hash} />
          <DialogFooter>
            <Button type="submit" disabled={isPending || isConfirming || !response || !responseHash}>
              {isPending || isConfirming ? 'Submitting…' : 'Submit Response'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
