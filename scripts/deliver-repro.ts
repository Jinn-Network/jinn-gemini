import 'dotenv/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { deliverViaSafe } from '@jinn-network/mech-client-ts/dist/post_deliver.js';

function getArg(flag: string, fallback?: string) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('-')
    ? process.argv[i + 1]
    : fallback;
}

async function main() {
  const requestId = getArg('--request-id') || getArg('-r');
  if (!requestId) {
    console.error('Usage: tsx scripts/deliver-repro.ts --request-id <id> [--content-file <path>]');
    process.exit(1);
  }

  const chainConfig = process.env.MECH_CHAIN_CONFIG || 'base';
  const targetMechAddress = (process.env.MECH_ADDRESS || process.env.MECH_WORKER_ADDRESS || '').trim();
  const safeAddress = (process.env.MECH_SAFE_ADDRESS || '').trim();
  const rpcHttpUrl = (process.env.RPC_URL || process.env.MECHX_CHAIN_RPC || process.env.MECH_RPC_HTTP_URL || '').trim();

  if (!targetMechAddress || !safeAddress) {
    console.error('Missing MECH_ADDRESS or MECH_SAFE_ADDRESS');
    process.exit(1);
  }

  const contentFile = getArg('--content-file') || getArg('-f');
  let resultContent: Record<string, any> = {
    requestId: String(requestId),
    output: `Delivery repro at ${new Date().toISOString()}`,
    telemetry: {},
  };
  if (contentFile) {
    const p = resolve(contentFile);
    resultContent = JSON.parse(readFileSync(p, 'utf8'));
  }

  const privateKeyEnv = (process.env.MECH_PRIVATE_KEY || '').trim();
  const privateKeyPath = process.env.MECH_PRIVATE_KEY_PATH || 'mech_private_key.txt';

  const payload: any = {
    chainConfig,
    requestId: String(requestId),
    resultContent,
    targetMechAddress,
    safeAddress,
    ...(privateKeyEnv ? { privateKey: privateKeyEnv } : { privateKeyPath }),
    ...(rpcHttpUrl ? { rpcHttpUrl } : {}),
    wait: true,
  };

  console.log('[deliver-repro] Payload preview (sans secrets):', {
    chainConfig,
    requestId: payload.requestId,
    targetMechAddress,
    safeAddress,
    hasPrivateKey: Boolean(privateKeyEnv),
    hasRpcOverride: Boolean(rpcHttpUrl),
  });

  const res = await (deliverViaSafe as any)(payload);
  console.log('[deliver-repro] Result:', res);
}

main().catch((e) => {
  console.error('[deliver-repro] Error:', e?.message || e);
  process.exit(1);
});
