import { Web3 } from 'web3';
import { Contract } from 'web3-eth-contract';
import WebSocket from 'ws';
import { get_mech_config, getPrivateKey, ConfirmationType } from './config';
import { pushMetadataToIpfs } from './ipfs';
import {
  createWebSocketConnection,
  registerEventHandlers,
  watchForRequestId,
  watchForDataUrlFromWss,
} from './wss';
import { readFileSync } from 'fs';
import axios from 'axios';

// Constants
const MAX_RETRIES = 3;
const WAIT_SLEEP = 3.0;
const TIMEOUT = 300.0;

export const CHAIN_TO_PRICE_TOKEN: { [chainId: number]: string } = {
  100: '0x21cE6799A22A3Da84B7c44a814a9c79ab1d2A50D',
  42161: '',
  137: '',
  8453: '0xB3921F8D8215603f0Bd521341Ac45eA8f2d274c1',
  42220: '',
  10: '',
};

export interface MarketplaceInteractOptions {
  prompts: string[];
  priorityMech: string;
  usePrepaid?: boolean;
  useOffchain?: boolean;
  mechOffchainUrl?: string;
  tools?: string[];
  extraAttributes?: Record<string, any>;
  privateKeyPath?: string;
  confirmationType?: ConfirmationType;
  retries?: number;
  timeout?: number;
  sleep?: number;
  postOnly?: boolean;
  chainConfig?: string;
}

export interface MarketplaceInteractResult {
  transactionHash?: string;
  transactionUrl?: string;
  requestId?: string;
  data?: any;
}

function getAbi(abiPath: string): any[] {
  try {
    const abiContent = readFileSync(abiPath, 'utf8');
    return JSON.parse(abiContent);
  } catch (error) {
    throw new Error(`Failed to load ABI from ${abiPath}: ${error}`);
  }
}

function getContract(contractAddress: string, abi: any[], web3: Web3): Contract<any> {
  return new web3.eth.Contract(abi, contractAddress);
}

function getEventSignatures(abi: any[]): { request: string; deliver: string } {
  const signatures: { request: string; deliver: string } = { request: '', deliver: '' };
  for (const item of abi) {
    if (item.type === 'event') {
      if (item.name === 'Request') {
        signatures.request = `0x${item.name.toLowerCase()}`;
      } else if (item.name === 'Deliver') {
        signatures.deliver = `0x${item.name.toLowerCase()}`;
      }
    }
  }
  return signatures;
}

async function sendRequest(
  web3: Web3,
  mechContract: Contract<any>,
  gasLimit: number,
  prompt: string,
  tool: string,
  price: number,
  extraAttributes?: Record<string, any>,
  retries?: number,
  timeout?: number,
  sleep?: number
): Promise<string | null> {
  const [truncatedHash, fullHash] = await pushMetadataToIpfs(prompt, tool, extraAttributes);
  console.log(`  - Prompt uploaded: https://gateway.autonolas.tech/ipfs/${fullHash.slice(3)}`);

  const methodName = 'request';
  const methodArgs = { data: truncatedHash };

  const tries = retries || MAX_RETRIES;
  const timeoutMs = (timeout || TIMEOUT) * 1000;
  const sleepMs = (sleep || WAIT_SLEEP) * 1000;
  const deadline = Date.now() + timeoutMs;

  for (let attempt = 0; attempt < tries && Date.now() < deadline; attempt++) {
    try {
      const accounts = await web3.eth.getAccounts();
      const from = accounts[0];
      const tx = mechContract.methods[methodName](methodArgs.data);
      const receipt = await tx.send({
        from,
        value: String(price),
        gas: String(gasLimit),
      });
      return receipt.transactionHash;
    } catch (error) {
      console.log(`Error occurred while sending the transaction: ${error}; Retrying in ${sleepMs}ms`);
      await new Promise(resolve => setTimeout(resolve, sleepMs));
    }
  }
  return null;
}

async function waitForDataUrl(
  requestId: string,
  ws: WebSocket,
  mechContract: Contract<any>,
  deliverSignature: string,
  web3: Web3,
  confirmationType: ConfirmationType = ConfirmationType.WAIT_FOR_BOTH
): Promise<string | null> {
    return await watchForDataUrlFromWss(
      requestId,
      ws,
      mechContract,
      deliverSignature,
      web3
    );
}

export async function marketplaceInteract(options: MarketplaceInteractOptions): Promise<MarketplaceInteractResult | null> {
  const {
    prompts,
    priorityMech,
    tools,
    extraAttributes,
    privateKeyPath,
    confirmationType = ConfirmationType.WAIT_FOR_BOTH,
    retries,
    timeout,
    sleep,
    postOnly = false,
    chainConfig,
  } = options;

  const mechConfig = get_mech_config(chainConfig);
  const privateKey = getPrivateKey(privateKeyPath);
  const web3 = new Web3(mechConfig.rpc_url);
  const ws = createWebSocketConnection(mechConfig.wss_endpoint);
  const account = web3.eth.accounts.privateKeyToAccount(privateKey);
  web3.eth.accounts.wallet.add(account);

  const selectedTool = tools ? tools[0] : 'openai-gpt-3.5-turbo';
  const abi = getAbi('./src/abis/ServiceMech.json');
  const mechContract = getContract(priorityMech, abi, web3);
  const { request: requestSignature, deliver: deliverSignature } = getEventSignatures(abi);

  registerEventHandlers(
    ws,
    priorityMech,
    account.address,
    requestSignature,
    deliverSignature
  );

  console.log('Sending Marketplace Mech request...');
  const price = mechConfig.price || 10_000_000_000_000_000;

  const transactionDigest = await sendRequest(
    web3,
    mechContract,
    mechConfig.gas_limit,
    prompts[0],
    selectedTool,
    price,
    extraAttributes,
    retries,
    timeout,
    sleep
  );

  if (!transactionDigest) {
    console.log('Unable to send request');
    return null;
  }

  const transactionUrlFormatted = mechConfig.transaction_url.replace('{transaction_digest}', transactionDigest);
  console.log(`  - Transaction sent: ${transactionUrlFormatted}`);
  console.log('  - Waiting for transaction receipt...');

  const requestId = await watchForRequestId(
    ws,
    mechContract,
    web3,
    requestSignature
  );

  console.log(`  - Created on-chain request with ID ${requestId}`);
  console.log('');

  if (postOnly) {
    return {
      transactionHash: transactionDigest,
      transactionUrl: transactionUrlFormatted,
      requestId: requestId,
    };
  }

  console.log('Waiting for Mech deliver...');

  const dataUrl = await waitForDataUrl(
    requestId,
    ws,
    mechContract,
    deliverSignature,
    web3,
    confirmationType
  );

  if (dataUrl) {
    console.log(`  - Data arrived: ${dataUrl}`);
    try {
      const response = await axios.get(`${dataUrl}/${requestId}`, { timeout: 60000 });
      const data = response.data;
      console.log('  - Data from agent:');
      console.log(JSON.stringify(data, null, 2));
      return data;
    } catch (error) {
      console.error('Error fetching data:', error);
      return null;
    }
  }

  return null;
}
