import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { SiteHeader } from '@/components/site-header'
import { getArtifact, fetchIpfsContent } from '@/lib/subgraph'
import { formatDate } from '@/lib/utils'

interface PageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const artifact = await getArtifact(id)
  return {
    title: artifact?.name || `ADW Document ${id}`,
    description: artifact?.contentPreview || 'ADW document details',
  }
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 py-2 border-b last:border-0">
      <dt className="w-36 shrink-0 text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm min-w-0 break-all">{children}</dd>
    </div>
  )
}

function CidLink({ cid, label }: { cid: string; label?: string }) {
  return (
    <a
      href={`https://gateway.autonolas.tech/ipfs/${cid}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs hover:underline text-primary"
      title={cid}
    >
      {label || cid}
    </a>
  )
}

function TrustBadge({ level }: { level?: number }) {
  const labels: Record<number, { text: string; className: string }> = {
    0: { text: 'Level 0 — Declared', className: 'bg-muted text-muted-foreground' },
    1: { text: 'Level 1 — Signed', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
    2: { text: 'Level 2 — On-Chain', className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
    3: { text: 'Level 3 — Validated', className: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' },
  }
  const info = labels[level ?? 0] || labels[0]
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${info.className}`}>
      {info.text}
    </span>
  )
}

export default async function ADWDocumentPage({ params }: PageProps) {
  const { id } = await params
  const artifact = await getArtifact(id)

  if (!artifact) {
    notFound()
  }

  // Try to fetch the Registration File from IPFS
  let registrationFile: Record<string, unknown> | null = null
  if (artifact.cid) {
    const content = await fetchIpfsContent(artifact.cid)
    if (content && content.contentType === 'application/json') {
      try {
        registrationFile = JSON.parse(content.content)
      } catch {
        // Not valid JSON
      }
    }
  }

  const trust = registrationFile?.trust as { level?: number; creatorProof?: { type?: string; signer?: string } } | undefined
  const trustLevel = trust?.level
  const provenance = registrationFile?.provenance as { method?: string; execution?: Record<string, string | string[]> } | undefined
  const execution = provenance?.execution

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader
        breadcrumbs={[
          { label: 'Explorer', href: '/' },
          { label: 'ADW Documents', href: '/adw' },
          { label: artifact.name || 'Document' },
        ]}
      />

      <main className="flex-1 py-6">
        <div className="container mx-auto px-4 max-w-4xl space-y-6">
          {/* Header */}
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold">{artifact.name || 'Unnamed Document'}</h1>
              <TrustBadge level={trustLevel} />
            </div>
            {artifact.contentPreview && (
              <p className="text-muted-foreground">{artifact.contentPreview}</p>
            )}
          </div>

          {/* Document Identity */}
          <section className="rounded-lg border p-4">
            <h2 className="text-sm font-semibold mb-3">Document Identity</h2>
            <dl>
              <InfoRow label="Registration CID">
                <CidLink cid={artifact.cid} />
              </InfoRow>
              {artifact.contentCid && (
                <InfoRow label="Content CID">
                  <CidLink cid={artifact.contentCid} />
                </InfoRow>
              )}
              {artifact.documentType && (
                <InfoRow label="Document Type">
                  <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium">
                    {artifact.documentType.replace('adw:', '')}
                  </span>
                </InfoRow>
              )}
              {artifact.type && (
                <InfoRow label="Artifact Type">{artifact.type}</InfoRow>
              )}
              <InfoRow label="Topic">{artifact.topic}</InfoRow>
              {artifact.tags && artifact.tags.length > 0 && (
                <InfoRow label="Tags">
                  <div className="flex gap-1 flex-wrap">
                    {artifact.tags.map((tag) => (
                      <span key={tag} className="inline-flex items-center rounded border px-1.5 py-0.5 text-[11px]">
                        {tag}
                      </span>
                    ))}
                  </div>
                </InfoRow>
              )}
              {artifact.blockTimestamp && (
                <InfoRow label="Indexed">{formatDate(artifact.blockTimestamp)}</InfoRow>
              )}
            </dl>
          </section>

          {/* Provenance */}
          {provenance && (
            <section className="rounded-lg border p-4">
              <h2 className="text-sm font-semibold mb-3">Provenance</h2>
              <dl>
                {provenance.method && (
                  <InfoRow label="Method">{provenance.method}</InfoRow>
                )}
                {execution?.agent && (
                  <InfoRow label="Agent">
                    <code className="text-xs">{execution.agent as string}</code>
                  </InfoRow>
                )}
                {execution?.requestId && (
                  <InfoRow label="Request">
                    <Link href={`/requests?id=${execution.requestId}`} className="text-primary hover:underline text-xs font-mono">
                      {execution.requestId as string}
                    </Link>
                  </InfoRow>
                )}
                {execution?.chain && (
                  <InfoRow label="Chain">{execution.chain as string}</InfoRow>
                )}
                {execution?.timestamp && (
                  <InfoRow label="Timestamp">{execution.timestamp as string}</InfoRow>
                )}
                {execution?.duration && (
                  <InfoRow label="Duration">{execution.duration as string}</InfoRow>
                )}
                {execution?.tools && Array.isArray(execution.tools) && (
                  <InfoRow label="Tools">
                    <div className="flex gap-1 flex-wrap">
                      {(execution.tools as string[]).map((tool: string) => (
                        <span key={tool} className="inline-flex items-center rounded border px-1.5 py-0.5 text-[11px]">
                          {tool}
                        </span>
                      ))}
                    </div>
                  </InfoRow>
                )}
              </dl>
            </section>
          )}

          {/* Trust */}
          {trust && (
            <section className="rounded-lg border p-4">
              <h2 className="text-sm font-semibold mb-3">Trust</h2>
              <dl>
                <InfoRow label="Trust Level">
                  <TrustBadge level={trustLevel} />
                </InfoRow>
                {trust.creatorProof && (
                  <>
                    <InfoRow label="Signature Type">
                      {trust.creatorProof.type || 'Unknown'}
                    </InfoRow>
                    <InfoRow label="Signer">
                      <code className="text-xs">
                        {trust.creatorProof.signer || 'Unknown'}
                      </code>
                    </InfoRow>
                  </>
                )}
              </dl>
            </section>
          )}

          {/* References */}
          <section className="rounded-lg border p-4">
            <h2 className="text-sm font-semibold mb-3">References</h2>
            <dl>
              {artifact.requestId && (
                <InfoRow label="Request ID">
                  <Link href={`/requests?id=${artifact.requestId}`} className="text-primary hover:underline text-xs font-mono">
                    {artifact.requestId}
                  </Link>
                </InfoRow>
              )}
              {artifact.ventureId && (
                <InfoRow label="Venture">
                  <Link href={`/ventures/${artifact.ventureId}`} className="text-primary hover:underline">
                    {artifact.ventureId}
                  </Link>
                </InfoRow>
              )}
              {artifact.workstreamId && (
                <InfoRow label="Workstream">
                  <Link href={`/workstreams/${artifact.workstreamId}`} className="text-primary hover:underline text-xs font-mono">
                    {artifact.workstreamId}
                  </Link>
                </InfoRow>
              )}
              {artifact.templateId && (
                <InfoRow label="Template">{artifact.templateId}</InfoRow>
              )}
            </dl>
          </section>

          {/* Raw Registration File */}
          {registrationFile && (
            <section className="rounded-lg border p-4">
              <h2 className="text-sm font-semibold mb-3">Registration File</h2>
              <pre className="bg-muted rounded p-3 text-xs overflow-x-auto max-h-96">
                {JSON.stringify(registrationFile, null, 2)}
              </pre>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}
