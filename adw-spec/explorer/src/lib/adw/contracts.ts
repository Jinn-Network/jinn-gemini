import { ADWDocumentRegistryABI, ADWReputationRegistryABI, ADWValidationRegistryABI } from './abi'

// Default: local Hardhat node addresses (from seed-adw-documents.ts)
// Override via NEXT_PUBLIC_ env vars for Tenderly VNet or production deployments
export const DOCUMENT_REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_DOCUMENT_REGISTRY ?? '0x40Eac2B201D12b13b442c330eED0A2aB04b06DeE') as `0x${string}`
export const REPUTATION_REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_REPUTATION_REGISTRY ?? '0x6dF7f8d643DD140fCE38C5bf346A11DA4a4B0330') as `0x${string}`
export const VALIDATION_REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_VALIDATION_REGISTRY ?? '0xC552bd9f22f8BB9CFa898A11f12B8D676D8155F6') as `0x${string}`

// Block at which ADW contracts were deployed. Set via env var for production.
export const ADW_DEPLOYMENT_BLOCK = BigInt(process.env.ADW_DEPLOYMENT_BLOCK || '0')

export const documentRegistryContract = {
  address: DOCUMENT_REGISTRY_ADDRESS,
  abi: ADWDocumentRegistryABI,
} as const

export const reputationRegistryContract = {
  address: REPUTATION_REGISTRY_ADDRESS,
  abi: ADWReputationRegistryABI,
} as const

export const validationRegistryContract = {
  address: VALIDATION_REGISTRY_ADDRESS,
  abi: ADWValidationRegistryABI,
} as const

export const DOCUMENT_TYPES = [
  'adw:Blueprint',
  'adw:Skill',
  'adw:Template',
  'adw:Artifact',
  'adw:Configuration',
  'adw:Knowledge',
  'adw:AgentCard',
] as const

export type DocumentType = (typeof DOCUMENT_TYPES)[number]
