'use client'

import { useState } from 'react'
import { useAccount } from 'wagmi'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TransactionStatus } from '@/components/adw/transaction-status'
import { useGiveFeedback } from '@/lib/adw/hooks'

interface GiveFeedbackDialogProps {
  documentId: string
}

export function GiveFeedbackDialog({ documentId }: GiveFeedbackDialogProps) {
  const { isConnected } = useAccount()
  const [open, setOpen] = useState(false)
  const [score, setScore] = useState('')
  const [tag1, setTag1] = useState('')
  const [tag2, setTag2] = useState('')
  const [feedbackURI, setFeedbackURI] = useState('')

  const { giveFeedback, hash, isPending, isConfirming, isSuccess, error, reset } = useGiveFeedback()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const scoreNum = parseFloat(score)
    if (isNaN(scoreNum)) return
    // score is stored as fixed-point with 2 decimals: 8.5 → score=850, decimals=2
    const decimals = 2
    const scoreInt = BigInt(Math.round(scoreNum * 10 ** decimals))
    giveFeedback({
      documentId: BigInt(documentId),
      score: scoreInt,
      decimals,
      tag1,
      tag2,
      endpoint: '',
      feedbackURI,
      feedbackHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
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
          {isConnected ? 'Give Feedback' : 'Connect wallet to give feedback'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Give Feedback — Document #{documentId}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="score">Score (0–10)</Label>
            <Input
              id="score"
              type="number"
              min="0"
              max="10"
              step="0.01"
              placeholder="e.g. 8.5"
              value={score}
              onChange={e => setScore(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tag1">Tag 1</Label>
            <Input id="tag1" placeholder="e.g. quality" value={tag1} onChange={e => setTag1(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tag2">Tag 2</Label>
            <Input id="tag2" placeholder="e.g. accuracy" value={tag2} onChange={e => setTag2(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="feedbackURI">Feedback URI (optional)</Label>
            <Input id="feedbackURI" placeholder="ipfs://…" value={feedbackURI} onChange={e => setFeedbackURI(e.target.value)} />
          </div>
          <TransactionStatus isPending={isPending} isConfirming={isConfirming} isSuccess={isSuccess} error={error} hash={hash} />
          <DialogFooter>
            <Button type="submit" disabled={isPending || isConfirming || !score}>
              {isPending || isConfirming ? 'Submitting…' : 'Submit Feedback'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
