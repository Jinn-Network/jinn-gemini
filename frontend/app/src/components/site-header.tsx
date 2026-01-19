'use client'

import Link from "next/link"
import { Separator } from "@/components/ui/separator"
import {
    Breadcrumb,
    BreadcrumbList,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { ExternalLink } from "lucide-react"
import { EXPLORER_URL } from '@/lib/featured-services';

interface BreadcrumbItemType {
    label: string
    href?: string
}

interface SiteHeaderProps {
    breadcrumbs?: BreadcrumbItemType[]
}

export function SiteHeader({ breadcrumbs }: SiteHeaderProps) {
    const showBreadcrumbs = breadcrumbs && breadcrumbs.length > 0

    return (
        <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b px-4">
            <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    {/* If we want a vertical separator after a title, we could add it, but breadcrumbs handle separators natively.
                The user asked for "Jinn then separator then service instance name".
                Breadcrumbs: Jinn > Service Instance Name. This is exactly that.
            */}
                    {showBreadcrumbs && (
                        <Breadcrumb>
                            <BreadcrumbList>
                                {breadcrumbs.map((item, index) => (
                                    <div key={index} className="contents">
                                        <BreadcrumbItem>
                                            {index === breadcrumbs.length - 1 ? (
                                                <BreadcrumbPage className="font-semibold truncate">
                                                    {item.label}
                                                </BreadcrumbPage>
                                            ) : item.href ? (
                                                <BreadcrumbLink asChild>
                                                    <Link href={item.href} className="font-semibold hover:text-foreground">
                                                        {item.label}
                                                    </Link>
                                                </BreadcrumbLink>
                                            ) : (
                                                <span className="font-semibold">{item.label}</span>
                                            )}
                                        </BreadcrumbItem>
                                        {index < breadcrumbs.length - 1 && <BreadcrumbSeparator />}
                                    </div>
                                ))}
                            </BreadcrumbList>
                        </Breadcrumb>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-4">
                <a
                    href={EXPLORER_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                    Explorer
                    <ExternalLink className="h-3 w-3" />
                </a>
            </div>
        </header>
    )
}
