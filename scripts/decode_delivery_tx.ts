import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import axios from 'axios';
import { decodeFunctionData, parseAbi } from 'viem';

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option('tx', { type: 'string', demandOption: true, describe: 'Transaction hash' })
    .help()
    .parse();

  const rpcUrl = process.env.MECHX_CHAIN_RPC || process.env.MECH_RPC_HTTP_URL;
  if (!rpcUrl) {
    console.error('Missing RPC URL (set MECHX_CHAIN_RPC or MECH_RPC_HTTP_URL)');
    process.exit(1);
  }

  const txHash = String(argv.tx);
  const rpcResp = await axios.post(rpcUrl, { jsonrpc: '2.0', id: 1, method: 'eth_getTransactionByHash', params: [txHash] }, { timeout: 15000 });
  const input: string | undefined = rpcResp?.data?.result?.input;
  if (!input || !input.startsWith('0x')) {
    console.error('No input found for tx');
    process.exit(1);
  }

  const safeAbi = parseAbi([
    'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures)'
  ]);
  const decodedSafe = decodeFunctionData({ abi: safeAbi, data: input as `0x${string}` });
  const innerData: `0x${string}` | undefined = (decodedSafe?.args?.[2] as any);
  if (!innerData) {
    console.error('No inner data found in execTransaction');
    process.exit(1);
  }

  const agentAbi = parseAbi([
    'function deliverToMarketplace(bytes32[] requestIds, bytes32[] resultDigests)'
  ]);
  const decodedInner = decodeFunctionData({ abi: agentAbi, data: innerData });
  const reqs: readonly string[] = (decodedInner?.args?.[0] as any[]) || [];
  const digests: readonly string[] = (decodedInner?.args?.[1] as any[]) || [];

  const results = [] as { requestIdHex: string; digestHex: string; ipfsHash: string }[];
  for (let i = 0; i < Math.min(reqs.length, digests.length); i++) {
    const rIdHex = String(reqs[i]).toLowerCase();
    const digestHex = String(digests[i]).replace(/^0x/, '').toLowerCase();
    const ipfsHash = `f01551220${digestHex}`;
    results.push({ requestIdHex: rIdHex, digestHex, ipfsHash });
  }

  console.log(JSON.stringify({ txHash, results }, null, 2));
}

main().catch((e) => {
  console.error(e?.message || String(e));
  process.exit(1);
});


