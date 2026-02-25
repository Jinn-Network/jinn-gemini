'use client'

import { useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { formatUnits } from 'viem'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MAX_WEIGHT_BPS } from '@/lib/vote/constants'
import { useVoteSubmit } from '@/hooks/use-vote-submit'

function formatVeOlas(value: bigint): string {
  return parseFloat(formatUnits(value, 18)).toFixed(2)
}

function parseVoteError(error: Error): string {
  const msg = error.message || ''
  if (msg.includes('VoteTooOften') || msg.includes('Cannot vote so often')) {
    return 'Vote cooldown active (~10 days between votes). Please try again later.'
  }
  if (msg.includes('User rejected') || msg.includes('denied')) {
    return 'Transaction rejected by user.'
  }
  if (msg.includes('NoVotingPower') || msg.includes('zero voting power')) {
    return 'You have no veOLAS voting power. Lock OLAS tokens to get veOLAS.'
  }
  // Truncate long revert messages
  if (msg.length > 200) return msg.slice(0, 200) + '...'
  return msg
}

export function UserVotePanel({
  isConnected,
  veOlasBalance,
  userAllocatedPower,
  onVoteSuccess,
}: {
  isConnected: boolean
  veOlasBalance: bigint | undefined
  userAllocatedPower: bigint | undefined
  onVoteSuccess: () => void
}) {
  const [weightPercent, setWeightPercent] = useState(100)
  const { vote, txHash, isSubmitting, isConfirming, isConfirmed, error, reset } =
    useVoteSubmit()

  const allocatedPercent = userAllocatedPower
    ? Number(userAllocatedPower) / 100
    : 0
  const remainingPercent = 100 - allocatedPercent

  if (!isConnected) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <p className="text-muted-foreground">
              Connect your wallet to vote for the Jinn staking contract with your veOLAS.
            </p>
            <ConnectButton />
          </div>
        </CardContent>
      </Card>
    )
  }

  function handleVote() {
    reset()
    const bps = BigInt(Math.round(weightPercent * 100))
    vote(bps)
  }

  const hasVeOlas = veOlasBalance !== undefined && veOlasBalance > BigInt(0)
  const isBusy = isSubmitting || isConfirming

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Cast Your Vote</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Wallet stats */}
        <div className="grid grid-cols-3 gap-4 text-center text-sm">
          <div>
            <div className="font-bold tabular-nums">
              {veOlasBalance !== undefined ? formatVeOlas(veOlasBalance) : '--'}
            </div>
            <div className="text-xs text-muted-foreground">veOLAS Balance</div>
          </div>
          <div>
            <div className="font-bold tabular-nums">{allocatedPercent.toFixed(1)}%</div>
            <div className="text-xs text-muted-foreground">Power Used</div>
          </div>
          <div>
            <div className="font-bold tabular-nums">{remainingPercent.toFixed(1)}%</div>
            <div className="text-xs text-muted-foreground">Available</div>
          </div>
        </div>

        {!hasVeOlas && (
          <p className="text-sm text-yellow-500">
            You need veOLAS to vote.{' '}
            <a
              href="https://member.olas.network"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Lock OLAS to get veOLAS
            </a>
          </p>
        )}

        {/* Weight input */}
        <div className="space-y-3">
          <Label htmlFor="vote-weight">
            Vote weight for Jinn (% of your total power)
          </Label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={weightPercent}
              onChange={(e) => setWeightPercent(Number(e.target.value))}
              disabled={isBusy}
              className="flex-1 accent-primary"
            />
            <div className="flex items-center gap-1">
              <Input
                id="vote-weight"
                type="number"
                min={0}
                max={100}
                step={1}
                value={weightPercent}
                onChange={(e) => {
                  const v = Math.min(100, Math.max(0, Number(e.target.value)))
                  setWeightPercent(v)
                }}
                disabled={isBusy}
                className="w-20 text-right tabular-nums"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            This replaces any existing vote for Jinn. Set to 0% to remove your vote.
          </p>
        </div>

        {/* Vote button */}
        <Button
          onClick={handleVote}
          disabled={!hasVeOlas || isBusy}
          className="w-full"
          size="lg"
        >
          {isSubmitting
            ? 'Confirm in wallet...'
            : isConfirming
              ? 'Confirming...'
              : `Vote ${weightPercent}% for Jinn`}
        </Button>

        {/* Transaction status */}
        {txHash && !error && (
          <div className="text-sm">
            {isConfirmed ? (
              <p className="text-green-500">
                Vote confirmed!{' '}
                <a
                  href={`https://etherscan.io/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  View on Etherscan
                </a>
              </p>
            ) : (
              <p className="text-muted-foreground">
                Tx submitted:{' '}
                <a
                  href={`https://etherscan.io/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-mono"
                >
                  {txHash.slice(0, 10)}...
                </a>
              </p>
            )}
          </div>
        )}

        {isConfirmed && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              reset()
              onVoteSuccess()
            }}
          >
            Done
          </Button>
        )}

        {/* Error display */}
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {parseVoteError(error)}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
