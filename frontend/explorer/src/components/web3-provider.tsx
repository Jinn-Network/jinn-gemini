'use client'

import { useState } from 'react'
import { WagmiProvider, State } from 'wagmi'
import { RainbowKitProvider, darkTheme, lightTheme } from '@rainbow-me/rainbowkit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from '@/lib/vote/wagmi-config'
import { useTheme } from 'next-themes'
import '@rainbow-me/rainbowkit/styles.css'

export function Web3Provider({
  children,
  initialState,
}: {
  children: React.ReactNode
  initialState?: State
}) {
  const [queryClient] = useState(() => new QueryClient())
  const { resolvedTheme } = useTheme()

  return (
    <WagmiProvider config={wagmiConfig} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={resolvedTheme === 'dark' ? darkTheme() : lightTheme()}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
