// VoteWeighting contract on Ethereum Mainnet
export const VOTE_WEIGHTING_ADDRESS = '0x95418b46d5566D3d1ea62C12Aea91227E566c5c1' as const

// veOLAS contract on Ethereum Mainnet
export const VE_OLAS_ADDRESS = '0x7e01A500805f8A52Fad229b3015AD130A332B7b3' as const

// Jinn v2 staking contract on Base
export const JINN_V2_STAKING_CONTRACT = '0x66A92CDa5B319DCCcAC6c1cECbb690CA3Fb59488' as const

// Nominee as bytes32 (address left-padded to 32 bytes)
export const JINN_NOMINEE_BYTES32 =
  '0x00000000000000000000000066a92cda5b319dcccac6c1cecbb690ca3fb59488' as `0x${string}`

// Base chain ID
export const NOMINEE_CHAIN_ID = BigInt(8453)

// Max vote weight (100% = 10000 basis points)
export const MAX_WEIGHT_BPS = 10000

export const voteWeightingAbi = [
  {
    type: 'function',
    name: 'voteForNomineeWeights',
    inputs: [
      { name: 'account', type: 'bytes32' },
      { name: 'chainId', type: 'uint256' },
      { name: 'weight', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'voteUserPower',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getNomineeWeight',
    inputs: [
      { name: 'account', type: 'bytes32' },
      { name: 'chainId', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getWeightsSum',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'nomineeRelativeWeight',
    inputs: [
      { name: 'account', type: 'bytes32' },
      { name: 'chainId', type: 'uint256' },
      { name: 'time', type: 'uint256' },
    ],
    outputs: [
      { name: 'weight', type: 'uint256' },
      { name: 'totalWeight', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const

export const veOlasAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const
