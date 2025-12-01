'use client'

import Link from "next/link"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"

interface SiteHeaderProps {
  title?: string
  subtitle?: string
  backLink?: {
    href: string
    label: string
  }
}

export function SiteHeader({ title, subtitle, backLink }: SiteHeaderProps) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        {backLink && (
          <Link 
            href={backLink.href} 
            className="text-xs text-blue-600 hover:text-blue-800"
          >
            ← {backLink.label}
          </Link>
        )}
        {title && (
          <h1 className="text-lg font-semibold truncate">
            {title}
          </h1>
        )}
        {subtitle && (
          <p className="text-xs text-muted-foreground truncate">
            {subtitle}
          </p>
        )}
      </div>
    </header>
  )
}

