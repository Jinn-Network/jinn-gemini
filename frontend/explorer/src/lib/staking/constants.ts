export const JINN_STAKING_CONTRACT = '0x0dfaFbf570e9E813507aAE18aA08dFbA0aBc5139' as const

export const TARGET_DELIVERIES_PER_EPOCH = 60
export const LIVENESS_PERIOD = 86400 // 1 day in seconds

export const stakingAbi = [
  {
    type: 'function',
    name: 'tsCheckpoint',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getServiceIds',
    inputs: [],
    outputs: [{ name: '', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'mapServiceInfo',
    inputs: [{ name: 'serviceId', type: 'uint256' }],
    outputs: [
      { name: 'multisig', type: 'address' },
      { name: 'owner', type: 'address' },
      { name: 'nonces', type: 'uint256[]' },
      { name: 'tsStart', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const
