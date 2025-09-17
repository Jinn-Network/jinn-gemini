import 'dotenv/config';
import { Web3 } from 'web3';
import artifact from 'mech-client-ts/dist/abis/AgentMech.json' assert { type: 'json' };

async function main() {
  const rpc = process.env.MECH_RPC_HTTP_URL || process.env.MECHX_CHAIN_RPC;
  const mech = (process.env.MECH_WORKER_ADDRESS || '').trim();
  const safe = (process.env.MECH_SAFE_ADDRESS || '').trim();
  if (!rpc || !mech || !safe) {
    console.error('Missing MECH_RPC_HTTP_URL/MECHX_CHAIN_RPC or MECH_WORKER_ADDRESS or MECH_SAFE_ADDRESS');
    process.exit(1);
  }
  const abi = (artifact as any).abi || (artifact as any);
  const web3 = new Web3(rpc);
  const code = await web3.eth.getCode(mech);
  const isContract = code && code !== '0x' && code !== '0x0';
  const c = new web3.eth.Contract(abi as any, mech);
  let mechMarketplace: string | undefined;
  let maxDeliveryRate: string | undefined;
  let isOperator: boolean | undefined;
  try {
    mechMarketplace = await c.methods.mechMarketplace().call();
  } catch {}
  try {
    maxDeliveryRate = await c.methods.maxDeliveryRate().call();
  } catch {}
  try {
    isOperator = await c.methods.isOperator(safe).call();
  } catch {}
  
  const sanitize = (v: any) => (typeof v === 'bigint' ? v.toString() : v);
  console.log(JSON.stringify({
    rpc,
    mech,
    safe,
    isContract,
    mechMarketplace: sanitize(mechMarketplace),
    maxDeliveryRate: sanitize(maxDeliveryRate),
    isOperator
  }, null, 2));

}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
