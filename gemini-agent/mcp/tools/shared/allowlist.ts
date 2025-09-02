import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Define a simple type for the allowlist structure
type Allowlist = { [chainId: string]: { contracts: { [address: string]: { allowedSelectors: string[] } } } };

let allowlist: Allowlist | null = null;

export async function getAllowlist(): Promise<Allowlist> {
  if (allowlist) {
    return allowlist;
  }
  
  // Use dynamic path resolved from project root
  const configPath = path.resolve(process.cwd(), 'worker/config/allowlists.json');

  try {
    const fileContent = await fs.readFile(configPath, 'utf-8');
    allowlist = JSON.parse(fileContent);
    return allowlist!;
  } catch (error) {
    console.error(`Failed to load or parse allowlist from ${configPath}:`, error);
    throw new Error('Could not load or parse allowlist configuration.');
  }
}
