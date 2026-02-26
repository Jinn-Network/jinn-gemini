import { createConfig, http, cookieStorage, createStorage } from 'wagmi'
import { base, hardhat } from 'wagmi/chains'
import { getDefaultConfig } from 'connectkit'

// Use hardhat local chain for dev, base for production
const useLocal = !process.env.NEXT_PUBLIC_RPC_URL

const config = useLocal
  ? getDefaultConfig({
      chains: [hardhat],
      transports: { [hardhat.id]: http('http://127.0.0.1:8545') },
      walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '',
      appName: 'ADW Explorer',
    })
  : getDefaultConfig({
      chains: [base],
      transports: { [base.id]: http(process.env.NEXT_PUBLIC_RPC_URL) },
      walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '',
      appName: 'ADW Explorer',
    })

export const wagmiConfig = createConfig({
  ...config,
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
})
