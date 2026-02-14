'use server'

import { getDeliveryCountSince } from '@/lib/staking/queries'

export async function getServiceEpochActivity(multisig: string, checkpoint: number) {
  const count = await getDeliveryCountSince(multisig, String(checkpoint))
  return { deliveryCount: count }
}
