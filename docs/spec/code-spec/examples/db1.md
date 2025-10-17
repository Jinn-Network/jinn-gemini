# Default Behavior: Centralize configuration access

## Follows the default behavior

```ts
import { getRequiredRpcUrl, getOptionalChainId } from '../config';

export async function connect(): Promise<Web3> {
  const rpcUrl = getRequiredRpcUrl();
  const chainId = getOptionalChainId() ?? 8453;

  const web3 = new Web3(rpcUrl);
  const currentChainId = await web3.eth.getChainId();

  if (chainId !== undefined && currentChainId !== chainId) {
    throw new Error(`Unexpected chain id ${currentChainId}; expected ${chainId}`);
  }

  return web3;
}
```

**Why this follows the behavior:** All configuration comes from named helpers defined in the shared config module. The module owns validation and canonical naming, so runtime code never touches `process.env` directly.

---

## Violates the default behavior

```ts
export async function connect(): Promise<Web3> {
  const rpcUrl =
    process.env.RPC_URL ||
    process.env.MECHX_CHAIN_RPC ||
    process.env.MECH_RPC_HTTP_URL ||
    'http://localhost:8545';

  if (!rpcUrl) {
    throw new Error('RPC URL missing');
  }

  const chainId = parseInt(process.env.CHAIN_ID || '8453', 10);

  const web3 = new Web3(rpcUrl);
  const currentChainId = await web3.eth.getChainId();

  if (currentChainId !== chainId) {
    console.warn('Chain ID mismatch, continuing anyway');
  }

  return web3;
}
```

**Why this violates the behavior:** The function pulls values straight from `process.env` with ad-hoc fallbacks. There is no schema validation, no canonical naming, and consumers must read the implementation to discover which env vars matter.


