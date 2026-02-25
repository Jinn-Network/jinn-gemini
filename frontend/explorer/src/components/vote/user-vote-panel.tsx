'use client'

import { useState, useEffect } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { formatUnits } from 'viem'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  if (msg.includes('Overflow') || msg.includes('Used too much power')) {
    return 'Vote weight exceeds available power. Reduce the weight or remove votes from other nominees first.'
  }
  if (msg.length > 200) return msg.slice(0, 200) + '...'
  return msg
}

export function UserVotePanel({
  isConnected,
  veOlasBalance,
  userAllocatedPower,
  existingV2Power,
  existingV1Power,
  maxAvailableBps,
  onVoteSuccess,
}: {
  isConnected: boolean
  veOlasBalance: bigint | undefined
  userAllocatedPower: bigint | undefined
  existingV2Power: bigint | undefined
  existingV1Power: bigint | undefined
  maxAvailableBps: number
  onVoteSuccess: () => void
}) {
  const maxPercent = Math.floor(maxAvailableBps / 100)
  const { vote, migrateVote, removeV1Vote, txHash, isSubmitting, isConfirming, isConfirmed, error, reset } =
    useVoteSubmit()

  const allocatedPercent = userAllocatedPower
    ? Number(userAllocatedPower) / 100
    : 0
  const v1Percent = existingV1Power ? Number(existingV1Power) / 100 : 0
  const v2Percent = existingV2Power ? Number(existingV2Power) / 100 : 0
  const hasV1Vote = v1Percent > 0

  // When migrating from v1, the effective max is: available + what we free from v1
  const migrateMaxPercent = hasV1Vote
    ? Math.min(100, maxPercent + Math.floor(v1Percent))
    : maxPercent

  // Default to the best available option
  const [weightPercent, setWeightPercent] = useState(
    hasV1Vote ? migrateMaxPercent : maxPercent
  )

  // Update default weight when data loads
  useEffect(() => {
    if (hasV1Vote) {
      setWeightPercent(migrateMaxPercent)
    } else {
      setWeightPercent(maxPercent)
    }
  }, [maxPercent, migrateMaxPercent, hasV1Vote])

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

  function handleMigrateVote() {
    reset()
    const bps = BigInt(Math.round(weightPercent * 100))
    migrateVote(bps)
  }

  function handleRemoveV1Only() {
    reset()
    removeV1Vote()
  }

  const hasVeOlas = veOlasBalance !== undefined && veOlasBalance > BigInt(0)
  const isBusy = isSubmitting || isConfirming

  // Determine if the chosen weight requires freeing v1 power
  const willUseMigrate = hasV1Vote && weightPercent > maxPercent

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
            <div className="font-bold tabular-nums">{maxPercent}%</div>
            <div className="text-xs text-muted-foreground">Available</div>
          </div>
        </div>

        {/* Existing vote info */}
        {v2Percent > 0 && (
          <p className="text-sm text-muted-foreground">
            You currently have <strong>{v2Percent}%</strong> allocated to Jinn v2.
            A new vote will replace it.
          </p>
        )}

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

        {/* v1 migration banner */}
        {hasV1Vote && (
          <div className="rounded-md bg-yellow-500/10 border border-yellow-500/30 p-3 text-sm space-y-3">
            <p>
              You have <strong>{v1Percent}%</strong> voting power on the old Jinn v1 contract.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRemoveV1Only}
                disabled={!hasVeOlas || isBusy}
              >
                {isBusy ? 'Confirming...' : 'Remove v1 vote only'}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setWeightPercent(migrateMaxPercent)
                  handleMigrateVote()
                }}
                disabled={!hasVeOlas || isBusy}
              >
                {isBusy ? 'Confirming...' : `Migrate ${migrateMaxPercent}% to v2`}
              </Button>
            </div>
          </div>
        )}

        {/* Weight input */}
        <div className="space-y-3">
          <Label htmlFor="vote-weight">
            Vote weight for Jinn v2 (% of your total power)
          </Label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={hasV1Vote ? migrateMaxPercent : maxPercent}
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
                max={hasV1Vote ? migrateMaxPercent : maxPercent}
                step={1}
                value={weightPercent}
                onChange={(e) => {
                  const limit = hasV1Vote ? migrateMaxPercent : maxPercent
                  const v = Math.min(limit, Math.max(0, Number(e.target.value)))
                  setWeightPercent(v)
                }}
                disabled={isBusy}
                className="w-20 text-right tabular-nums"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {willUseMigrate
              ? `Will remove your v1 vote (${v1Percent}%) and allocate ${weightPercent}% to v2 in one transaction.`
              : maxPercent < 100 && !hasV1Vote
                ? `Capped at ${maxPercent}% — you have ${allocatedPercent.toFixed(0)}% allocated to other nominees.`
                : 'Set to 0% to remove your vote.'}
          </p>
        </div>

        {/* Vote button */}
        <Button
          onClick={willUseMigrate ? handleMigrateVote : handleVote}
          disabled={!hasVeOlas || isBusy}
          className="w-full"
          size="lg"
        >
          {isSubmitting
            ? 'Confirm in wallet...'
            : isConfirming
              ? 'Confirming...'
              : willUseMigrate
                ? `Migrate: remove v1 + vote ${weightPercent}% for v2`
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
