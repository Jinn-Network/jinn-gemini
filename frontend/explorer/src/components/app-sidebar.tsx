'use client'

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight, Workflow, Briefcase, FileText } from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { navigationItems } from "@/lib/utils"
import { RealtimeStatusIndicator } from "@/components/realtime-status-indicator"
import { useRealtimeData } from "@/hooks/use-realtime-data"

export function AppSidebar() {
  const pathname = usePathname()
  const { status: realtimeStatus } = useRealtimeData('requests', { enabled: true })

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <h2 className="text-lg font-bold text-sidebar-foreground px-2 group-data-[collapsible=icon]:hidden">
          Jinn Explorer
        </h2>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationItems.map((item) => {
                const isActive = pathname === `/${item.collection}` || 
                  (item.subItems?.some(subItem => pathname === `/${subItem.collection}`))

                if (item.subItems) {
                  // Collapsible item with sub-items
                  return (
                    <Collapsible
                      key={item.collection}
                      defaultOpen={true}
                      className="group/collapsible"
                    >
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton isActive={isActive}>
                            <Briefcase />
                            <span>{item.label}</span>
                            <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {item.subItems.map((subItem) => {
                              const isSubItemActive = pathname === `/${subItem.collection}`
                              return (
                                <SidebarMenuSubItem key={subItem.collection}>
                                  <SidebarMenuSubButton
                                    asChild
                                    isActive={isSubItemActive}
                                  >
                                    <Link href={`/${subItem.collection}`}>
                                      <span>{subItem.label}</span>
                                    </Link>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              )
                            })}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  )
                }

                // Regular menu item without sub-items
                const Icon = item.collection === 'workstreams' ? Workflow : FileText
                return (
                  <SidebarMenuItem key={item.collection}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link href={`/${item.collection}`}>
                        <Icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center px-2 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 [&_span]:group-data-[collapsible=icon]:hidden">
          <RealtimeStatusIndicator status={realtimeStatus} />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

