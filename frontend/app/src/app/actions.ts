'use server';

import { revalidatePath } from 'next/cache';
import { supabaseMutate, supabaseAdminQuery } from '@/lib/supabase';

interface CreateVentureInput {
  name: string;
  slug: string;
  description: string;
  category: string;
  problem: string;
  owner_address: string;
}

export async function createVenture(input: CreateVentureInput) {
  const result = await supabaseMutate<{ id: string; slug: string }>('ventures', 'POST', {
    name: input.name,
    slug: input.slug,
    description: input.description,
    owner_address: input.owner_address,
    status: 'proposed',
    creator_type: 'human',
    blueprint: {
      category: input.category,
      problem: input.problem,
      invariants: [],
    },
  });

  if (result.data) {
    revalidatePath('/');
    revalidatePath(`/ventures/${result.data.slug}`);
  }

  return result;
}

interface UpdateVentureTokenInput {
  token_address: string;
  token_symbol: string;
  token_name: string;
  governance_address: string;
  pool_address: string;
  token_metadata: Record<string, unknown>;
}

export async function updateVentureToken(
  ventureId: string,
  input: UpdateVentureTokenInput
) {
  const result = await supabaseMutate<{ id: string }>('ventures', 'PATCH', {
    ...input,
    token_launch_platform: 'doppler',
    status: 'bonding',
  }, ventureId);

  if (result.data) {
    revalidatePath('/');
  }

  return result;
}

// Social Actions

export async function getLikeStatus(ventureId: string, userAddress: string) {
  const result = await supabaseAdminQuery('likes', {
    select: 'venture_id',
    venture_id: `eq.${ventureId}`,
    user_address: `eq.${userAddress}`,
    limit: '1'
  });
  return result.length > 0;
}

export async function toggleLike(ventureId: string, userAddress: string) {
  // Check if already liked
  const existing = await getLikeStatus(ventureId, userAddress);

  if (existing) {
    // Unlike
    return supabaseMutate('likes', 'DELETE', undefined, undefined, {
      venture_id: `eq.${ventureId}`,
      user_address: `eq.${userAddress}`
    });
  } else {
    // Like
    return supabaseMutate('likes', 'POST', {
      venture_id: ventureId,
      user_address: userAddress
    });
  }
}

export interface Comment {
  id: string;
  venture_id: string;
  user_address: string;
  content: string;
  created_at: string;
}

export async function getComments(ventureId: string) {
  return supabaseAdminQuery<Comment>('comments', {
    select: '*',
    venture_id: `eq.${ventureId}`,
    order: 'created_at.desc'
  });
}

export async function postComment(ventureId: string, userAddress: string, content: string) {
  return supabaseMutate<Comment>('comments', 'POST', {
    venture_id: ventureId,
    user_address: userAddress,
    content
  });
}

// KPI Management

export interface KPIInvariant {
  id: string;
  type: 'FLOOR' | 'CEILING' | 'RANGE' | 'BOOLEAN';
  metric?: string;
  condition?: string;
  min?: number;
  max?: number;
  assessment: string;
}

export async function updateVentureKPIs(
  ventureId: string,
  invariants: KPIInvariant[],
  userAddress: string
) {
  // Verify ownership
  const ventures = await supabaseAdminQuery<{ id: string; owner_address: string; blueprint: Record<string, unknown> | null }>(
    'ventures',
    {
      select: 'id,owner_address,blueprint',
      id: `eq.${ventureId}`,
      limit: '1',
    }
  );

  const venture = ventures[0];
  if (!venture) return { error: 'Venture not found' };
  if (venture.owner_address.toLowerCase() !== userAddress.toLowerCase()) {
    return { error: 'Only the venture owner can update KPIs' };
  }

  const existingBlueprint = (venture.blueprint || {}) as Record<string, unknown>;
  const result = await supabaseMutate('ventures', 'PATCH', {
    blueprint: {
      ...existingBlueprint,
      invariants,
    },
  }, ventureId);

  if (!result.error) {
    revalidatePath('/');
    revalidatePath(`/ventures/`);
  }

  return result;
}
