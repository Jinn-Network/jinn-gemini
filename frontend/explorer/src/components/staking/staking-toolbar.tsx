'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface StakingToolbarProps {
  viewMode: 'table' | 'cards'
  owners: { address: string; label: string }[]
  selectedOwner: string | null
}

export function StakingToolbar({ viewMode, owners, selectedOwner }: StakingToolbarProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function navigate(params: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(params)) {
      if (value === null) {
        next.delete(key)
      } else {
        next.set(key, value)
      }
    }
    const qs = next.toString()
    router.push(`/nodes/staking${qs ? `?${qs}` : ''}`)
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <Tabs
        value={viewMode}
        onValueChange={(v) => navigate({ view: v === 'table' ? null : v })}
      >
        <TabsList>
          <TabsTrigger value="table">Table</TabsTrigger>
          <TabsTrigger value="cards">Cards</TabsTrigger>
        </TabsList>
      </Tabs>

      {owners.length > 1 && (
        <Select
          value={selectedOwner ?? 'all'}
          onValueChange={(v) => navigate({ owner: v === 'all' ? null : v })}
        >
          <SelectTrigger size="sm">
            <SelectValue placeholder="Filter by owner" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All owners</SelectItem>
            {owners.map((o) => (
              <SelectItem key={o.address} value={o.address}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
