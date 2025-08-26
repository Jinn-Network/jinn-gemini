import { z } from 'zod';
import dotenv from 'dotenv';

// Load env vars from root .env file (if it exists)
try {
  dotenv.config({ path: process.cwd() + '/.env' });
} catch (error) {
  // Ignore if .env file doesn't exist
}

const workerConfigSchema = z.object({
  WORKER_PRIVATE_KEY: z.string().startsWith('0x').length(66, 'WORKER_PRIVATE_KEY must be a 66-character hex string with 0x prefix'),
  CHAIN_ID: z.coerce.number().int().positive('CHAIN_ID must be a positive integer'),
  RPC_URL: z.string().url('RPC_URL must be a valid HTTP/HTTPS URL'),
  JINN_WALLET_STORAGE_PATH: z.string().optional(), // For e2e testing override
  
  // Supabase configuration (optional for wallet-only mode)
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
});

export type WorkerConfig = z.infer<typeof workerConfigSchema>;

/**
 * Validate and parse worker configuration from environment variables.
 * Exits the process with code 2 if configuration is invalid.
 */
export function parseWorkerConfig(): WorkerConfig {
  try {
    const config = workerConfigSchema.parse(process.env);
    return config;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(issue => {
        const field = issue.path.join('.');
        return `${field}: ${issue.message}`;
      }).join(', ');
      
      console.error(`[FATAL] Configuration validation failed: ${issues}`);
      process.exit(2);
    }
    console.error(`[FATAL] Unknown configuration error: ${error}`);
    process.exit(2);
  }
}

/**
 * Lazy-loaded validated configuration.
 * Will exit the process if configuration is invalid.
 */
export const config = parseWorkerConfig();
