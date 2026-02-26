'use client'

import { useState } from 'react'
import { WagmiProvider, cookieToInitialState } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConnectKitProvider } from 'connectkit'
import { wagmiConfig } from '@/lib/wagmi-config'
import { AppSidebar } from "@/components/app-sidebar"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"

interface ClientLayoutProps {
  children: React.ReactNode
  cookieHeader?: string | null
}

export function ClientLayout({ children, cookieHeader }: ClientLayoutProps) {
  const [queryClient] = useState(() => new QueryClient())
  const initialState = cookieToInitialState(wagmiConfig, cookieHeader ?? undefined)

  return (
    <WagmiProvider config={wagmiConfig} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider>
          <TooltipProvider>
            <SidebarProvider
              style={
                {
                  "--sidebar-width": "12rem",
                } as React.CSSProperties
              }
            >
              <AppSidebar />
              <SidebarInset>
                {children}
              </SidebarInset>
            </SidebarProvider>
          </TooltipProvider>
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
