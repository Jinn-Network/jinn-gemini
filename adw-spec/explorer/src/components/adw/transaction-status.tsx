'use client'

import { Loader2, CheckCircle2, XCircle, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TransactionStatusProps {
  isPending?: boolean
  isConfirming?: boolean
  isSuccess?: boolean
  error?: Error | null
  hash?: `0x${string}`
  className?: string
}

export function TransactionStatus({
  isPending,
  isConfirming,
  isSuccess,
  error,
  hash,
  className,
}: TransactionStatusProps) {
  if (!isPending && !isConfirming && !isSuccess && !error) return null

  return (
    <div className={cn('flex items-center gap-2 text-sm rounded-md p-2', className)}>
      {isPending && (
        <>
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Waiting for wallet…</span>
        </>
      )}
      {isConfirming && (
        <>
          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
          <span className="text-blue-600 dark:text-blue-400">Confirming transaction…</span>
          {hash && (
            <a
              href={`https://basescan.org/tx/${hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-blue-500 hover:underline"
            >
              View <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </>
      )}
      {isSuccess && (
        <>
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-green-600 dark:text-green-400">Transaction confirmed</span>
          {hash && (
            <a
              href={`https://basescan.org/tx/${hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-green-500 hover:underline"
            >
              View <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </>
      )}
      {error && !isPending && !isConfirming && !isSuccess && (
        <>
          <XCircle className="h-4 w-4 text-destructive" />
          <span className="text-destructive text-xs truncate max-w-xs" title={error.message}>
            {error.message.slice(0, 80)}
          </span>
        </>
      )}
    </div>
  )
}
