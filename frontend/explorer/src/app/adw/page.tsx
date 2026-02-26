import { Metadata } from 'next'
import { Suspense } from 'react'
import Link from 'next/link'
import { SiteHeader } from '@/components/site-header'
import { queryArtifacts, type Artifact } from '@/lib/subgraph'
import { formatDate } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'ADW Documents',
  description: 'Browse Agentic Document Web (ADW) documents registered by Jinn agents',
}

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ type?: string; page?: string }>
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  'adw:Artifact': 'Artifact',
  'adw:Blueprint': 'Blueprint',
  'adw:Template': 'Template',
  'adw:Skill': 'Skill',
  'adw:Configuration': 'Configuration',
  'adw:Knowledge': 'Knowledge',
  'adw:AgentCard': 'Agent Card',
}

function DocumentTypeBadge({ type }: { type?: string }) {
  if (!type) return <span className="text-xs text-muted-foreground">Legacy</span>
  const label = DOCUMENT_TYPE_LABELS[type] || type.replace('adw:', '')
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium">
      {label}
    </span>
  )
}

function TruncatedId({ id }: { id: string }) {
  if (id.length <= 16) return <code className="text-xs">{id}</code>
  return <code className="text-xs" title={id}>{id.slice(0, 8)}...{id.slice(-6)}</code>
}

function ArtifactRow({ artifact }: { artifact: Artifact }) {
  return (
    <Link
      href={`/adw/${artifact.id}`}
      className="flex items-center gap-4 rounded-lg border p-4 hover:bg-muted/50 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium truncate">{artifact.name || 'Unnamed'}</span>
          <DocumentTypeBadge type={artifact.documentType} />
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="truncate">{artifact.topic}</span>
          {artifact.blockTimestamp && (
            <span className="shrink-0">{formatDate(artifact.blockTimestamp)}</span>
          )}
        </div>
        {artifact.contentPreview && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{artifact.contentPreview}</p>
        )}
      </div>
      <div className="shrink-0 text-right space-y-1">
        {artifact.contentCid ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground">reg</span>
            <TruncatedId id={artifact.cid} />
          </div>
        ) : (
          <TruncatedId id={artifact.cid} />
        )}
      </div>
    </Link>
  )
}

async function DocumentList({ typeFilter }: { typeFilter?: string }) {
  const where: Record<string, unknown> = {}
  if (typeFilter) {
    where.documentType = typeFilter
  }

  const result = await queryArtifacts({
    limit: 50,
    orderBy: 'blockTimestamp',
    orderDirection: 'desc',
    where: Object.keys(where).length > 0 ? where : undefined,
  })

  const artifacts = result.items

  if (artifacts.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground">
        No ADW documents found{typeFilter ? ` of type ${DOCUMENT_TYPE_LABELS[typeFilter] || typeFilter}` : ''}.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {artifacts.map((artifact) => (
        <ArtifactRow key={artifact.id} artifact={artifact} />
      ))}
    </div>
  )
}

function DocumentListSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="rounded-lg border p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-4 w-48 bg-muted animate-pulse rounded" />
            <div className="h-5 w-16 bg-muted animate-pulse rounded-full" />
          </div>
          <div className="flex items-center gap-3">
            <div className="h-3 w-24 bg-muted animate-pulse rounded" />
            <div className="h-3 w-20 bg-muted animate-pulse rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

const TYPE_FILTERS = [
  { value: '', label: 'All' },
  { value: 'adw:Artifact', label: 'Artifacts' },
  { value: 'adw:Blueprint', label: 'Blueprints' },
  { value: 'adw:Template', label: 'Templates' },
  { value: 'adw:Skill', label: 'Skills' },
  { value: 'adw:Knowledge', label: 'Knowledge' },
]

export default async function ADWPage({ searchParams }: PageProps) {
  const params = await searchParams
  const typeFilter = params.type || ''

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader
        subtitle="Agentic Document Web"
        breadcrumbs={[
          { label: 'Explorer', href: '/' },
          { label: 'ADW Documents' },
        ]}
      />

      <main className="flex-1 py-6">
        <div className="container mx-auto px-4">
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            {TYPE_FILTERS.map((filter) => (
              <Link
                key={filter.value}
                href={filter.value ? `/adw?type=${filter.value}` : '/adw'}
                className={`inline-flex items-center rounded-full border px-3 py-1 text-sm transition-colors ${
                  typeFilter === filter.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'hover:bg-muted'
                }`}
              >
                {filter.label}
              </Link>
            ))}
          </div>

          <Suspense fallback={<DocumentListSkeleton />}>
            <DocumentList typeFilter={typeFilter || undefined} />
          </Suspense>
        </div>
      </main>
    </div>
  )
}
