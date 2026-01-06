import { Metadata } from 'next'
import { SiteHeader } from '@/components/site-header'
import { TemplatesCatalog } from '@/components/templates-catalog'

export const metadata: Metadata = {
  title: 'Job Templates',
  description: 'Browse and execute job templates via x402 payments',
}

export default function TemplatesPage() {
  const breadcrumbs = [
    { label: 'Templates' }
  ]

  return (
    <>
      <SiteHeader breadcrumbs={breadcrumbs} />
      <div className="p-4 md:p-6">
        <TemplatesCatalog />
      </div>
    </>
  )
}

