/**
 * SimplifiedServiceBootstrap - JINN-202
 * 
 * Uses middleware's native attended mode instead of custom orchestration.
 * 
 * Key differences from InteractiveServiceBootstrap:
 * - Single quickstart call (not two)
 * - ATTENDED=true (middleware shows prompts)
 * - Streams all output (no filtering)
 * - No manual funding checks
 * - No state synchronization
 * - ~150 lines vs 575 lines
 * 
 * Middleware handles:
 * - Master EOA/Safe detection and reuse
 * - Agent key generation
 * - Balance checking with real-time polling
 * - Interactive funding prompts
 * - Service deployment and staking
 * - Error handling and retries
 * 
 * We only provide:
 * - Service configuration (template JSON)
 * - Environment variables (ATTENDED=true, RPC, password)
 * - Intro text explaining what to expect
 */

import { OlasOperateWrapper } from './OlasOperateWrapper.js';
import { OlasServiceManager } from './OlasServiceManager.js';
import { logger } from './logger.js';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDefaultServiceConfig } from './config/ServiceConfig.js';
import { enableMechMarketplaceInConfig } from './config/MechConfig.js';

const bootstrapLogger = logger.child({ component: "SIMPLIFIED-BOOTSTRAP" });

export interface SimplifiedBootstrapConfig {
  chain: 'base' | 'gnosis' | 'mode' | 'optimism';
  operatePassword: string;
  rpcUrl: string;
  deployMech?: boolean;
  mechMarketplaceAddress?: string;
  /**
   * Mech request price in wei (e.g., '5000000000000' for 0.000005 ETH)
   * Defaults to '10000000000000000' (0.01 ETH) if not specified
   */
  mechRequestPrice?: string;
  /**
   * Override RPC URL (e.g. for Tenderly Virtual TestNet)
   * If set, this takes precedence over rpcUrl
   */
  tenderlyRpcUrl?: string;
  /**
   * Staking program configuration (JINN-204)
   * Defaults to 'custom_staking' (AgentsFun1 on Base)
   */
  stakingProgram?: 'no_staking' | 'custom_staking';
  /**
   * Custom staking contract address (if stakingProgram is 'custom_staking')
   */
  customStakingAddress?: string;
}

export interface SimplifiedBootstrapResult {
  success: boolean;
  serviceConfigId?: string;
  serviceSafeAddress?: string;
  error?: string;
  configPath?: string;
}

export class SimplifiedServiceBootstrap {
  private config: SimplifiedBootstrapConfig;
  private operateWrapper?: OlasOperateWrapper;

  constructor(config: SimplifiedBootstrapConfig) {
    this.config = config;
    
    // Validate required config
    if (!config.operatePassword) {
      throw new Error('operatePassword is required (prevents password prompt)');
    }
    if (!config.rpcUrl) {
      throw new Error('rpcUrl is required');
    }
    
    bootstrapLogger.info({ 
      chain: config.chain,
      deployMech: config.deployMech || false 
    }, "SimplifiedServiceBootstrap initialized");
  }

  /**
   * Run the complete bootstrap process using middleware's native attended mode
   */
  async bootstrap(): Promise<SimplifiedBootstrapResult> {
    try {
      // Step 1: Create operate wrapper with ATTENDED=true
      await this.initializeWrapper();
      
      // Step 2: Create quickstart config file
      const configPath = await this.createQuickstartConfig();
      
      // Step 3: Show user intro (what to expect)
      this.printIntro();
      
      // Step 4: Hand off to middleware's quickstart (attended mode)
      const result = await this.runQuickstart(configPath);
      
      // Step 5: Extract results from middleware output
      return this.extractResults(result, configPath);
      
    } catch (error) {
      bootstrapLogger.error({ error }, "Bootstrap failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Initialize OlasOperateWrapper with ATTENDED=true configuration
   */
  private async initializeWrapper(): Promise<void> {
    const isTenderly = process.env.TENDERLY_ENABLED === 'true';
    const effectiveRpcUrl = isTenderly ? process.env.TENDERLY_RPC_URL || this.config.rpcUrl : this.config.rpcUrl;
    
    bootstrapLogger.info({
      mode: isTenderly ? 'tenderly' : 'mainnet',
      rpc: effectiveRpcUrl
    }, "Initializing operate wrapper with attended mode");
    
    // Build RPC environment variables
    const chainLedgerRpc: Record<string, string> = {
      [this.config.chain]: effectiveRpcUrl
    };
    
    // Respect ATTENDED and STAKING_PROGRAM from environment
    this.operateWrapper = await OlasOperateWrapper.create({
      rpcUrl: effectiveRpcUrl,
      timeout: 30 * 60 * 1000, // 30 minutes
      defaultEnv: {
        operatePassword: this.config.operatePassword,
        stakingProgram: this.config.stakingProgram || 'no_staking', // Default to no_staking for safety
        customStakingAddress: this.config.customStakingAddress,
        chainLedgerRpc,
        attended: process.env.ATTENDED?.toLowerCase() === 'true'
      }
    });
    
    bootstrapLogger.info({
      mode: isTenderly ? 'tenderly' : 'mainnet',
      attended: process.env.ATTENDED?.toLowerCase() === 'true',
      stakingProgram: this.config.stakingProgram || 'no_staking'
    }, "Wrapper initialized");
  }

  /**
   * Create quickstart configuration file
   */
  private async createQuickstartConfig(): Promise<string> {
    bootstrapLogger.info("Creating quickstart config");
    
    // Determine effective RPC URL (Tenderly or mainnet)
    const isTenderly = process.env.TENDERLY_ENABLED === 'true';
    const effectiveRpcUrl = isTenderly ? process.env.TENDERLY_RPC_URL || this.config.rpcUrl : this.config.rpcUrl;
    
    // Use unique service name to force new service creation (not reuse existing)
    const serviceName = `jinn-service-${Date.now()}`;
    
    // Create base service config with home_chain set
    const serviceConfig = createDefaultServiceConfig({
      name: serviceName,
      home_chain: this.config.chain
    });
    
    // Override RPC URL (Tenderly or mainnet)
    if (effectiveRpcUrl && serviceConfig.configurations[this.config.chain]) {
      serviceConfig.configurations[this.config.chain].rpc = effectiveRpcUrl;
    }
    
    // JINN-204: Staking configuration handling
    // For ATTENDED mode: Leave staking_program_id unset so middleware prompts user
    // For UNATTENDED mode: Set explicitly to avoid prompts
    // Check the ATTENDED env var that will be passed to the middleware command
    const attendedEnvVar = this.operateWrapper?.env?.ATTENDED;
    const isAttended = attendedEnvVar === 'true' || attendedEnvVar === true;
    
    if (serviceConfig.configurations[this.config.chain]) {
      if (isAttended) {
        // ATTENDED MODE: Remove staking config to trigger middleware prompt
        // User will be prompted to select staking option interactively
        delete serviceConfig.configurations[this.config.chain].staking_program_id;
        delete serviceConfig.configurations[this.config.chain].use_staking;
        
        bootstrapLogger.info("Attended mode: Removed staking config to enable interactive prompt");
      } else {
        // UNATTENDED MODE: Set explicitly to avoid prompts
        const stakingProgram = this.config.stakingProgram || 'custom_staking';
        serviceConfig.configurations[this.config.chain].staking_program_id = 
          stakingProgram === 'custom_staking' ? 'agents_fun_1' : 'no_staking';
        serviceConfig.configurations[this.config.chain].use_staking = 
          stakingProgram === 'custom_staking';
        
        bootstrapLogger.info({
          stakingProgram,
          staking_program_id: serviceConfig.configurations[this.config.chain].staking_program_id,
          use_staking: serviceConfig.configurations[this.config.chain].use_staking
        }, "Unattended mode: Configured staking in service config");
      }
    }
    
    // Add mech configuration if requested
    if (this.config.deployMech) {
      const mechPrice = this.config.mechRequestPrice || '10000000000000000'; // Default: 0.01 ETH
      bootstrapLogger.info({ mechRequestPrice: mechPrice }, "Enabling mech marketplace deployment");
      enableMechMarketplaceInConfig(
        serviceConfig,
        this.config.mechMarketplaceAddress || '0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020',
        mechPrice
      );
    }
    
    // Write to temp file
    const configPath = join(tmpdir(), `jinn-simplified-bootstrap-${Date.now()}.json`);
    writeFileSync(configPath, JSON.stringify(serviceConfig, null, 2));
    
    bootstrapLogger.info({ 
      configPath,
      mode: isTenderly ? 'tenderly' : 'mainnet',
      rpc: effectiveRpcUrl
    }, "Quickstart config created");
    return configPath;
  }

  /**
   * Print intro explaining what user will see
   */
  private printIntro(): void {
    console.log('\n' + '='.repeat(80));
    console.log('  🚀 OLAS Service Setup - Simplified Bootstrap (JINN-202)');
    console.log('='.repeat(80));
    console.log('');
    console.log(`Network: ${this.config.chain.toUpperCase()}`);
    console.log(`RPC: ${this.config.rpcUrl}`);
    console.log(`Mech Deployment: ${this.config.deployMech ? 'YES' : 'NO'}`);
    console.log('');
    console.log('📋 The middleware will handle the complete setup process:');
    console.log('');
    console.log('   1. Detect or create Master EOA');
    console.log('   2. Detect or create Master Safe');
    console.log('   3. Prompt for staking configuration choice');
    console.log('   4. Create Agent Key');
    console.log('   5. Prompt you to fund Agent Key (~0.001 ETH)');
    console.log('   6. Deploy Service Safe on-chain');
    console.log('   7. Prompt you to fund Service Safe (~0.001 ETH + 100 OLAS)');
    console.log('   8. Stake service in staking contract');
    if (this.config.deployMech) {
      console.log('   9. Deploy mech contract');
    }
    console.log('');
    console.log('⚠️  IMPORTANT (Staking Configuration):');
    console.log('   • You will be prompted to select a staking option:');
    console.log('     [1] No staking');
    console.log('     [2] Custom staking contract');
    console.log('   • For AgentsFun1, select option 2');
    console.log('   • Paste contract address: 0x2585e63df7BD9De8e058884D496658a030b5c6ce');
    console.log('');
    console.log('⚠️  IMPORTANT (Funding):');
    console.log('   • The middleware will pause and show funding instructions');
    console.log('   • Fund the exact addresses shown when prompted');
    console.log('   • Wait for transaction confirmation before continuing');
    console.log('   • The process auto-continues when funding is detected');
    console.log('   • Total time: 5-10 minutes (depending on funding speed)');
    console.log('');
    console.log('🔄 If you interrupt (Ctrl+C):');
    console.log('   • Partial state is automatically cleaned on next run');
    console.log('   • You can safely retry from the beginning');
    console.log('');
    console.log('='.repeat(80));
    console.log('');
    console.log('🚀 Starting quickstart in attended mode...');
    console.log('');
  }

  /**
   * Run middleware quickstart command
   */
  private async runQuickstart(configPath: string): Promise<string> {
    if (!this.operateWrapper) {
      throw new Error('Wrapper not initialized');
    }
    
    bootstrapLogger.info({ configPath }, "Executing quickstart command");
    
    const stakingProgram = this.config.stakingProgram || 'custom_staking';
    bootstrapLogger.info({ stakingProgram }, "Staking program configured");
    
    // Use ATTENDED env var from wrapper (can be 'true', 'false', true, or false)
    const attendedEnvVar = this.operateWrapper?.env?.ATTENDED;
    const isAttended = attendedEnvVar === 'true' || attendedEnvVar === true;
    
    bootstrapLogger.info({ attended: isAttended }, "Running quickstart");
    
    // Execute quickstart command with appropriate mode
    const result = await this.operateWrapper.executeCommand(
      'quickstart',
      [configPath, `--attended=${isAttended}`],
      {
        stream: true, // Show all middleware output (no filtering)
        timeoutMs: 30 * 60 * 1000, // 30 minutes
        interactive: isAttended // Enable stdin only for attended mode
      }
    );
    
    if (!result.success) {
      throw new Error(`Quickstart failed: ${result.stderr || result.stdout}`);
    }
    
    bootstrapLogger.info("Quickstart completed successfully");
    return result.stdout;
  }

  /**
   * Extract service information from quickstart output
   */
  private extractResults(
    output: string, 
    configPath: string
  ): SimplifiedBootstrapResult {
    // The middleware doesn't return structured output from quickstart
    // Service info is stored in .operate/services/sc-{uuid}/config.json
    // We could parse the output logs or use OlasServiceManager to list services
    
    bootstrapLogger.info("Extracting service information");
    
    // Look for service config ID in output
    const serviceIdMatch = output.match(/service[_\s](?:config[_\s])?id[:\s]+([a-z0-9-]+)/i);
    const serviceConfigId = serviceIdMatch?.[1];
    
    // Look for Safe address in output
    const safeMatch = output.match(/(?:service[_\s])?safe[:\s]+(0x[a-fA-F0-9]{40})/i);
    const serviceSafeAddress = safeMatch?.[1];
    
    const result: SimplifiedBootstrapResult = {
      success: true,
      serviceConfigId,
      serviceSafeAddress,
      configPath
    };
    
    bootstrapLogger.info({ 
      serviceConfigId,
      serviceSafeAddress 
    }, "Bootstrap completed");
    
    return result;
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    if (this.operateWrapper) {
      await this.operateWrapper.stopServer();
    }
  }
}

