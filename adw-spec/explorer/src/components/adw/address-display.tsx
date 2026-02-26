'use client'

import { useState } from 'react'
import { Copy, Check, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AddressDisplayProps {
  address: string
  className?: string
  showLink?: boolean
}

export function AddressDisplay({ address, className, showLink = true }: AddressDisplayProps) {
  const [copied, setCopied] = useState(false)

  const truncated = address.length > 10
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address

  const handleCopy = async () => {
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <span className={cn('inline-flex items-center gap-1 font-mono text-sm', className)}>
      <span title={address}>{truncated}</span>
      <button
        onClick={handleCopy}
        className="text-muted-foreground hover:text-foreground transition-colors"
        title="Copy address"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
      {showLink && (
        <a
          href={`https://basescan.org/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="View on BaseScan"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </span>
  )
}
