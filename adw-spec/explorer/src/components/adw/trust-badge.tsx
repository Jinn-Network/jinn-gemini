import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const TRUST_LEVELS = {
  0: { label: 'Declared', className: 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-400' },
  1: { label: 'Signed', className: 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400' },
  2: { label: 'Reputation-Backed', className: 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400' },
  3: { label: 'Provenance-Verified', className: 'bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-400' },
} as const

type TrustLevel = keyof typeof TRUST_LEVELS

interface TrustBadgeProps {
  level: TrustLevel
  className?: string
}

export function TrustBadge({ level, className }: TrustBadgeProps) {
  const { label, className: levelClassName } = TRUST_LEVELS[level] ?? TRUST_LEVELS[0]
  return (
    <Badge variant="outline" className={cn(levelClassName, className)}>
      Level {level} — {label}
    </Badge>
  )
}

export function computeTrustLevel(hasFeedback: boolean, hasValidation: boolean): TrustLevel {
  if (hasValidation) return 3
  if (hasFeedback) return 2
  return 0
}
