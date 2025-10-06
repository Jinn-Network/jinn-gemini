# Worker Integration Changes Needed

**Document Purpose**: Research and identify all changes needed to incorporate learnings from JINN-186 validation into the production worker codebase.

**Status**: Research Complete - Implementation Pending

---

## 🎯 Summary of Required Changes

Based on validation testing, **5 critical areas** require updates:

1. **Service Configuration (CRITICAL)** - Fix fake IPFS hash causing timeouts
2. **Environment Variables** - Add support for required CLI environment variables  
3. **Chain Configuration** - Fix unsupported chain names
4. **Fund Requirements Format** - Fix type mismatch (strings vs integers)
5. **Configuration Validation** - Add comprehensive validation before deployment

---

## 1. Service Configuration Constants (CRITICAL) ⚠️

### Current State (BROKEN)

**File**: `worker/config/ServiceConfig.ts`

```typescript
export const SERVICE_CONSTANTS = {
  EXAMPLE_IPFS_HASH: "bafybeiflqjig7qlvpfrlqbvlcqv2h7ry6sytcx6fxqzwlpjqvdm7nfxpqy", // ❌ FAKE HASH
  DEFAULT_HOME_CHAIN: "base", // ❌ NOT SUPPORTED
  DEFAULT_RPC_URL: "https://mainnet.base.org",
  DEFAULT_AGENT_FUNDING_WEI: "100000000000000000", // ❌ STRING (should be int)
  DEFAULT_SAFE_FUNDING_WEI: "50000000000000000", // ❌ STRING (should be int)
}
```

### Problems

1. **IPFS Hash is Fake**
   - Hash `bafybeiflqjig7qlvpfrlqbvlcqv2h7ry6sytcx6fxqzwlpjqvdm7nfxpqy` does not exist
   - Causes `ReadTimeout` from `registry.autonolas.tech` during service creation
   - Downloads hang for ~2 minutes before timing out
   - **Impact**: All service deployments will fail

2. **Chain Name Unsupported**
   - `"base"` is not in middleware's `CHAIN_TO_METADATA`
   - Causes error: `"KeyError: 'Chain base not supported'"`
   - **Impact**: Service creation fails immediately with chain error

3. **Fund Requirements Wrong Type**
   - Values are strings but middleware expects integers
   - Causes `TypeError: int() argument must be a string...` during fund calculation
   - **Impact**: Service creation fails at funding calculation step

### Required Changes

```typescript
export const SERVICE_CONSTANTS = {
  // ✅ Use real, working service hash from olas-operate-app
  DEFAULT_SERVICE_HASH: "bafybeihnzvqexxegm6auq7vcpb6prybd2xcz5glbvhos2lmmuazqt75nuq",
  
  // ✅ Use supported chain names (lowercase, in CHAIN_TO_METADATA)
  DEFAULT_HOME_CHAIN: "gnosis", // or "mode", "optimism" 
  
  // ✅ Use appropriate RPC for the chain
  DEFAULT_RPC_URL: "https://gnosis-rpc.publicnode.com",
  
  // ✅ Use integers for fund requirements (not strings)
  DEFAULT_AGENT_FUNDING_WEI: 100000000000000000, // 0.1 ETH
  DEFAULT_SAFE_FUNDING_WEI: 50000000000000000,   // 0.05 ETH
  
  // Reference to canonical working config
  CANONICAL_CONFIG_PATH: "test-service-config.json"
} as const;
```

### Additional Service Hash Options

From `olas-operate-app`, these are verified working hashes:

```typescript
export const VERIFIED_SERVICE_HASHES = {
  // Trader Agent (prediction service) - Agent ID 14
  TRADER: "bafybeihnzvqexxegm6auq7vcpb6prybd2xcz5glbvhos2lmmuazqt75nuq",
  
  // Agents Fun Base Template
  AGENTS_FUN_BASE: "bafybeiardecju3sygh7hwuywka2bgjinbr7vrzob4mpdrookyfsbdmoq2m",
  
  // Modius Service Template  
  MODIUS: "bafybeigtbqigx6sqhg3ffnxnbpq6ieafdyk2gzjulv36dpmug4yy7w5zia",
} as const;
```

---

## 2. Environment Variable Support

### Current State

**Files**: 
- `worker/OlasOperateWrapper.ts` - `_spawnChildProcess()` method
- `worker/OlasServiceManager.ts` - `deployAndStakeService()` method

Currently, environment variables CAN be passed via `options.env` parameter, but:
- Not being used consistently
- No default env var setup for required variables
- No validation of required env vars before execution

### Problems

The `operate quickstart` command requires these environment variables in unattended mode:
- `{CHAIN}_LEDGER_RPC` (e.g., `GNOSIS_LEDGER_RPC`)
- `OPERATE_PASSWORD` - Password for wallet operations
- `STAKING_PROGRAM` - Must be `"no_staking"` or `"custom_staking"` (NOT program IDs)

**Current behavior**: Commands fail with `ValueError: {VAR} env var required in unattended mode`

### Required Changes

#### 2.1 Add Environment Defaults

**File**: `worker/OlasOperateWrapper.ts`

```typescript
export interface OperateConfig {
  middlewarePath?: string;
  timeout?: number;
  pythonBinary?: string;
  rpcUrl?: string;
  // ✅ Add environment defaults
  defaultEnv?: {
    operatePassword?: string;
    stakingProgram?: 'no_staking' | 'custom_staking';
    chainLedgerRpc?: Record<string, string>; // e.g., { gnosis: "https://...", mode: "https://..." }
  };
}
```

#### 2.2 Update executeCommand Method

```typescript
async executeCommand(
  command: string,
  args: string[] = [],
  options: { cwd?: string; env?: Record<string, string> } = {}
): Promise<OperateCommandResult> {
  const fullArgs = ['-m', 'operate.cli', command, ...args];
  const cwd = options.cwd || this.middlewarePath;

  // ✅ Merge default environment variables
  const env = {
    ...this._buildDefaultEnv(),
    ...options.env,
  };

  const result = await OlasOperateWrapper._spawnChildProcess(
    this.pythonBinary, 
    fullArgs, 
    { cwd, env, timeout: this.timeout }
  );
  
  return result;
}

/**
 * Build default environment variables for CLI commands
 */
private _buildDefaultEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  
  // Add OPERATE_PASSWORD if configured
  if (this.config.defaultEnv?.operatePassword) {
    env.OPERATE_PASSWORD = this.config.defaultEnv.operatePassword;
  }
  
  // Add STAKING_PROGRAM if configured
  if (this.config.defaultEnv?.stakingProgram) {
    env.STAKING_PROGRAM = this.config.defaultEnv.stakingProgram;
  }
  
  // Add chain-specific RPC URLs
  if (this.config.defaultEnv?.chainLedgerRpc) {
    for (const [chain, rpcUrl] of Object.entries(this.config.defaultEnv.chainLedgerRpc)) {
      const envVar = `${chain.toUpperCase()}_LEDGER_RPC`;
      env[envVar] = rpcUrl;
    }
  }
  
  return env;
}
```

#### 2.3 Update OlasServiceManager Usage

**File**: `worker/OlasServiceManager.ts`

```typescript
async deployAndStakeService(serviceConfigPath?: string): Promise<ServiceInfo> {
  const configPath = serviceConfigPath || this.serviceConfigPath;
  
  // ✅ Load config to extract chain and RPC
  const serviceConfig = await this.loadServiceConfig(configPath);
  const chain = serviceConfig.home_chain;
  const rpcUrl = serviceConfig.configurations[chain]?.rpc;
  
  // ✅ Build environment variables
  const env = this._buildQuickstartEnv(chain, rpcUrl);
  
  // Execute with environment
  const result = await this.operateWrapper.executeCommand(
    'quickstart', 
    [configPath, '--attended=false'],
    { env }
  );
  
  // ... rest of logic
}

/**
 * Build environment variables for quickstart command
 */
private _buildQuickstartEnv(chain: string, rpcUrl: string): Record<string, string> {
  const envVarName = `${chain.toUpperCase()}_LEDGER_RPC`;
  
  return {
    [envVarName]: rpcUrl,
    OPERATE_PASSWORD: process.env.OPERATE_PASSWORD || 'default-password',
    STAKING_PROGRAM: process.env.STAKING_PROGRAM || 'no_staking',
  };
}
```

---

## 3. Chain Configuration Support

### Current State

**File**: `worker/config/ServiceConfig.ts`

```typescript
DEFAULT_HOME_CHAIN: "base", // ❌ NOT SUPPORTED
```

### Problem

The middleware only supports chains defined in `CHAIN_TO_METADATA` in `operate/quickstart/utils.py`:
- ✅ Supported: `"gnosis"`, `"mode"`, `"optimism"`, `"ethereum"`, `"polygon"`, `"arbitrum"`
- ❌ NOT Supported: `"base"`, `"Base"`, any capitalized variants

### Required Changes

#### 3.1 Update Constants

```typescript
// ✅ Define supported chains
export const SUPPORTED_CHAINS = [
  'gnosis',
  'mode', 
  'optimism',
  'ethereum',
  'polygon',
  'arbitrum'
] as const;

export type SupportedChain = typeof SUPPORTED_CHAINS[number];

export const SERVICE_CONSTANTS = {
  // ✅ Use supported chain
  DEFAULT_HOME_CHAIN: "gnosis" as SupportedChain,
  
  // ✅ Provide RPC mapping
  DEFAULT_RPC_URLS: {
    gnosis: "https://gnosis-rpc.publicnode.com",
    mode: "https://mainnet.mode.network",
    optimism: "https://mainnet.optimism.io",
    ethereum: "https://eth.llamarpc.com",
    polygon: "https://polygon-rpc.com",
    arbitrum: "https://arb1.arbitrum.io/rpc",
  } as Record<SupportedChain, string>,
}
```

#### 3.2 Add Validation

```typescript
/**
 * Validate that chain is supported by middleware
 */
export function validateChainSupport(chain: string): { 
  isSupported: boolean; 
  error?: string; 
} {
  if (!SUPPORTED_CHAINS.includes(chain as SupportedChain)) {
    return {
      isSupported: false,
      error: `Chain "${chain}" not supported. Supported chains: ${SUPPORTED_CHAINS.join(', ')}`
    };
  }
  
  return { isSupported: true };
}

/**
 * Enhanced service config validation
 */
export function validateServiceConfig(config: any): { 
  isValid: boolean; 
  errors: string[]; 
} {
  const errors: string[] = [];
  
  // Existing checks
  if (!config.name) errors.push('Missing service name');
  if (!config.home_chain) errors.push('Missing home_chain');
  
  // ✅ Chain support check
  if (config.home_chain) {
    const chainValidation = validateChainSupport(config.home_chain);
    if (!chainValidation.isSupported) {
      errors.push(chainValidation.error!);
    }
  }
  
  // ✅ Configuration exists for home chain
  if (config.home_chain && !config.configurations?.[config.home_chain]) {
    errors.push(`Missing configuration for home_chain "${config.home_chain}"`);
  }
  
  // ✅ IPFS hash format check
  if (config.hash && !config.hash.startsWith('bafybei')) {
    errors.push('Invalid IPFS hash format (must start with "bafybei")');
  }
  
  // ✅ Fund requirements type check
  const chainConfig = config.configurations?.[config.home_chain];
  if (chainConfig?.fund_requirements) {
    for (const [token, amounts] of Object.entries(chainConfig.fund_requirements)) {
      if (typeof amounts.agent === 'string' || typeof amounts.safe === 'string') {
        errors.push(`Fund requirements must be integers, not strings (found in ${token})`);
      }
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}
```

---

## 4. Fund Requirements Format

### Current State

```typescript
fund_requirements: {
  "0x0000000000000000000000000000000000000000": {
    agent: SERVICE_CONSTANTS.DEFAULT_AGENT_FUNDING_WEI, // String
    safe: SERVICE_CONSTANTS.DEFAULT_SAFE_FUNDING_WEI    // String
  }
}
```

### Problem

The middleware expects integers but gets strings, causing:
```
TypeError: int() argument must be a string, a bytes-like object or a number, not 'NoneType'
```

### Required Changes

#### 4.1 Update Type Definition

**File**: `worker/config/ServiceConfig.ts`

```typescript
export interface ServiceConfigTemplate {
  name: string;
  hash: string;
  description: string;
  image: string;
  service_version: string;
  home_chain: SupportedChain; // ✅ Use type-safe chain
  configurations: {
    [chain: string]: {
      staking_program_id: string;
      nft: string;
      rpc: string;
      threshold: number;
      agent_id: number;
      use_staking: boolean;
      use_mech_marketplace: boolean;
      cost_of_bond: string; // Bond remains string (wei)
      fund_requirements: {
        [address: string]: {
          agent: number; // ✅ Changed from string to number
          safe: number;  // ✅ Changed from string to number
        };
      };
    };
  };
  env_variables: Record<string, any>;
}
```

#### 4.2 Update Constant Values

```typescript
export const SERVICE_CONSTANTS = {
  // ✅ Use integers for fund requirements
  DEFAULT_AGENT_FUNDING_WEI: 100000000000000000, // 0.1 ETH
  DEFAULT_SAFE_FUNDING_WEI: 50000000000000000,   // 0.05 ETH
  
  // Bond amount remains string (used in contract calls)
  DEFAULT_SERVICE_BOND_WEI: "10000000000000000", // 0.01 ETH
}
```

#### 4.3 Update createDefaultServiceConfig

```typescript
export function createDefaultServiceConfig(
  overrides: Partial<ServiceConfigTemplate> = {}
): ServiceConfigTemplate {
  const homeChain = overrides.home_chain || SERVICE_CONSTANTS.DEFAULT_HOME_CHAIN;
  
  return {
    name: "default-service",
    hash: SERVICE_CONSTANTS.DEFAULT_SERVICE_HASH, // ✅ Real hash
    description: "Default OLAS service configuration",
    image: `https://operate.olas.network/_next/image?url=%2Fimages%2Fprediction-agent.png&w=3840&q=75`,
    service_version: "v0.26.3",
    home_chain: homeChain,
    configurations: {
      [homeChain]: {
        staking_program_id: SERVICE_CONSTANTS.DEFAULT_STAKING_PROGRAM_ID,
        nft: SERVICE_CONSTANTS.DEFAULT_SERVICE_HASH,
        rpc: SERVICE_CONSTANTS.DEFAULT_RPC_URLS[homeChain],
        threshold: 1,
        agent_id: 14, // ✅ Real agent ID that works with pearl_beta
        use_staking: true,
        use_mech_marketplace: false,
        cost_of_bond: SERVICE_CONSTANTS.DEFAULT_SERVICE_BOND_WEI,
        fund_requirements: {
          "0x0000000000000000000000000000000000000000": {
            agent: SERVICE_CONSTANTS.DEFAULT_AGENT_FUNDING_WEI, // ✅ Integer
            safe: SERVICE_CONSTANTS.DEFAULT_SAFE_FUNDING_WEI    // ✅ Integer
          }
        }
      }
    },
    env_variables: {},
    ...overrides
  };
}
```

---

## 5. Configuration Validation Enhancement

### Current State

Minimal validation in `validateServiceConfig()`:
- Only checks for existence of fields
- No type checking
- No format validation
- No chain support validation

### Required Changes

See comprehensive validation function in **Section 3.2** above.

Additional validation to add:

```typescript
/**
 * Validate service config before deployment
 * Throws detailed error if invalid
 */
export function validateServiceConfigOrThrow(config: any): void {
  const validation = validateServiceConfig(config);
  
  if (!validation.isValid) {
    const errorMessage = [
      'Service configuration validation failed:',
      ...validation.errors.map((err, i) => `  ${i + 1}. ${err}`)
    ].join('\n');
    
    throw new Error(errorMessage);
  }
}

/**
 * Validate service config file before loading
 */
export async function validateServiceConfigFile(
  configPath: string
): Promise<{ isValid: boolean; errors: string[]; config?: any }> {
  try {
    const fs = await import('fs/promises');
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content);
    
    const validation = validateServiceConfig(config);
    
    return {
      ...validation,
      config: validation.isValid ? config : undefined
    };
  } catch (error) {
    return {
      isValid: false,
      errors: [`Failed to load config file: ${error instanceof Error ? error.message : String(error)}`]
    };
  }
}
```

#### Usage in OlasServiceManager

```typescript
async deployAndStakeService(serviceConfigPath?: string): Promise<ServiceInfo> {
  const configPath = serviceConfigPath || this.serviceConfigPath;
  
  // ✅ Validate config before attempting deployment
  const validation = await validateServiceConfigFile(configPath);
  if (!validation.isValid) {
    serviceLogger.error({ errors: validation.errors, configPath }, 
      "Service configuration validation failed");
    throw new Error(`Invalid service configuration:\n${validation.errors.join('\n')}`);
  }
  
  serviceLogger.info({ configPath }, "Service configuration validated successfully");
  
  // Continue with deployment...
}
```

---

## 6. Additional Improvements

### 6.1 Add Service Hash Registry

**New File**: `worker/config/ServiceHashRegistry.ts`

```typescript
/**
 * Registry of verified, working OLAS service hashes
 * These hashes have been validated to exist on IPFS and work with the middleware
 */
export interface ServiceTemplate {
  hash: string;
  name: string;
  description: string;
  agentId: number;
  compatibleChains: string[];
  stakingPrograms: string[];
  verified: boolean;
}

export const SERVICE_HASH_REGISTRY: Record<string, ServiceTemplate> = {
  'trader-agent': {
    hash: 'bafybeihnzvqexxegm6auq7vcpb6prybd2xcz5glbvhos2lmmuazqt75nuq',
    name: 'Trader Agent',
    description: 'Prediction market trading service',
    agentId: 14,
    compatibleChains: ['gnosis', 'mode', 'optimism'],
    stakingPrograms: ['pearl_beta', 'no_staking'],
    verified: true,
  },
  'agents-fun-base': {
    hash: 'bafybeiardecju3sygh7hwuywka2bgjinbr7vrzob4mpdrookyfsbdmoq2m',
    name: 'Agents Fun Base',
    description: 'Base template for fun agents',
    agentId: 1,
    compatibleChains: ['gnosis'],
    stakingPrograms: ['no_staking'],
    verified: true,
  },
  'modius': {
    hash: 'bafybeigtbqigx6sqhg3ffnxnbpq6ieafdyk2gzjulv36dpmug4yy7w5zia',
    name: 'Modius Service',
    description: 'Modius service template',
    agentId: 1,
    compatibleChains: ['gnosis'],
    stakingPrograms: ['no_staking'],
    verified: true,
  },
};

/**
 * Get service template by key
 */
export function getServiceTemplate(key: string): ServiceTemplate | undefined {
  return SERVICE_HASH_REGISTRY[key];
}

/**
 * Validate service hash exists in IPFS
 */
export function isVerifiedServiceHash(hash: string): boolean {
  return Object.values(SERVICE_HASH_REGISTRY).some(
    template => template.hash === hash && template.verified
  );
}
```

### 6.2 Add Deployment Logging Utility

**New File**: `worker/utils/DeploymentLogger.ts`

```typescript
/**
 * Enhanced logging for service deployment with progress tracking
 * Based on learnings from JINN-186 validation
 */
import { logger } from '../logger.js';

const deployLogger = logger.child({ component: "DEPLOYMENT-PROGRESS" });

export interface DeploymentPhase {
  phase: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  startTime?: Date;
  endTime?: Date;
  details?: Record<string, any>;
}

export class DeploymentProgressTracker {
  private phases: Map<string, DeploymentPhase> = new Map();
  
  startPhase(phaseName: string, details?: Record<string, any>): void {
    this.phases.set(phaseName, {
      phase: phaseName,
      status: 'in_progress',
      startTime: new Date(),
      details
    });
    
    deployLogger.info({ phase: phaseName, details }, `▶️  Starting: ${phaseName}`);
  }
  
  completePhase(phaseName: string, details?: Record<string, any>): void {
    const phase = this.phases.get(phaseName);
    if (phase) {
      phase.status = 'completed';
      phase.endTime = new Date();
      phase.details = { ...phase.details, ...details };
      
      const duration = phase.endTime.getTime() - phase.startTime!.getTime();
      deployLogger.info({ 
        phase: phaseName, 
        duration: `${(duration / 1000).toFixed(2)}s`,
        details 
      }, `✅ Completed: ${phaseName}`);
    }
  }
  
  failPhase(phaseName: string, error: Error | string): void {
    const phase = this.phases.get(phaseName);
    if (phase) {
      phase.status = 'failed';
      phase.endTime = new Date();
      
      deployLogger.error({ 
        phase: phaseName, 
        error: error instanceof Error ? error.message : error 
      }, `❌ Failed: ${phaseName}`);
    }
  }
  
  getSummary(): DeploymentPhase[] {
    return Array.from(this.phases.values());
  }
}
```

---

## 7. Testing Requirements

### 7.1 Unit Tests to Update

**Files**:
- `worker/config/ServiceConfig.test.ts` - Add validation tests
- `worker/OlasServiceManager.test.ts` - Update mock configs
- `worker/OlasOperateWrapper.test.ts` - Test env var passing

### 7.2 Integration Tests to Add

**New File**: `worker/OlasServiceManager.integration.test.ts`

```typescript
describe('OlasServiceManager Integration (with real configs)', () => {
  it('should validate canonical service config', async () => {
    const configPath = 'test-service-config.json';
    const validation = await validateServiceConfigFile(configPath);
    
    expect(validation.isValid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });
  
  it('should reject fake IPFS hash', async () => {
    const config = createDefaultServiceConfig({
      hash: 'bafybeiflqjig7qlvpfrlqbvlcqv2h7ry6sytcx6fxqzwlpjqvdm7nfxpqy'
    });
    
    const validation = validateServiceConfig(config);
    expect(validation.isValid).toBe(false);
    expect(validation.errors).toContain(expect.stringContaining('IPFS hash'));
  });
  
  it('should reject unsupported chain', async () => {
    const config = createDefaultServiceConfig({
      home_chain: 'base'
    });
    
    const validation = validateServiceConfig(config);
    expect(validation.isValid).toBe(false);
    expect(validation.errors).toContain(expect.stringContaining('Chain "base" not supported'));
  });
});
```

---

## 8. Migration Path

### Phase 1: Critical Fixes (Immediate)
1. ✅ Update `SERVICE_CONSTANTS.EXAMPLE_IPFS_HASH` to real hash
2. ✅ Change `DEFAULT_HOME_CHAIN` from "base" to "gnosis"
3. ✅ Convert fund requirements from strings to integers
4. ✅ Update type definitions to match

### Phase 2: Environment Variable Support
1. ✅ Add `_buildDefaultEnv()` to `OlasOperateWrapper`
2. ✅ Add `_buildQuickstartEnv()` to `OlasServiceManager`  
3. ✅ Update `deployAndStakeService()` to pass env vars
4. ✅ Add environment validation

### Phase 3: Enhanced Validation
1. ✅ Implement comprehensive `validateServiceConfig()`
2. ✅ Add `validateChainSupport()`
3. ✅ Add `validateServiceConfigFile()`
4. ✅ Integrate validation into deployment flow

### Phase 4: Documentation & Testing
1. ✅ Update unit tests
2. ✅ Add integration tests
3. ✅ Update API documentation
4. ✅ Add migration guide for existing configs

---

## 9. Breaking Changes

### For Existing Service Configurations

❌ **WILL BREAK**:
- Configs using `"base"` as home_chain
- Configs with string values in fund_requirements
- Configs using fake/example IPFS hashes

✅ **MIGRATION REQUIRED**:
```typescript
// Before (broken)
{
  "home_chain": "base",
  "hash": "bafybeiflqjig7qlvpfrlqbvlcqv2h7ry6sytcx6fxqzwlpjqvdm7nfxpqy",
  "configurations": {
    "base": {
      "fund_requirements": {
        "0x0000000000000000000000000000000000000000": {
          "agent": "100000000000000000",
          "safe": "50000000000000000"
        }
      }
    }
  }
}

// After (working)
{
  "home_chain": "gnosis",
  "hash": "bafybeihnzvqexxegm6auq7vcpb6prybd2xcz5glbvhos2lmmuazqt75nuq",
  "configurations": {
    "gnosis": {
      "rpc": "https://gnosis-rpc.publicnode.com",
      "fund_requirements": {
        "0x0000000000000000000000000000000000000000": {
          "agent": 100000000000000000,
          "safe": 50000000000000000
        }
      }
    }
  }
}
```

---

## 10. Reference Implementation

All changes should follow the patterns established in:
- ✅ `scripts/CORE_DO_NOT_DELETE_olas_service_lifecycle_validation.ts`
- ✅ `test-service-config.json`

These files are the **canonical reference** for correct implementation.

---

## Checklist for Implementation

- [ ] Update `SERVICE_CONSTANTS` in `worker/config/ServiceConfig.ts`
- [ ] Add `SUPPORTED_CHAINS` and type definitions
- [ ] Update `ServiceConfigTemplate` interface (fund_requirements to number)
- [ ] Implement comprehensive `validateServiceConfig()`
- [ ] Add `_buildDefaultEnv()` to `OlasOperateWrapper`
- [ ] Add `_buildQuickstartEnv()` to `OlasServiceManager`
- [ ] Update `deployAndStakeService()` to use environment variables
- [ ] Create `ServiceHashRegistry.ts` with verified hashes
- [ ] Add `DeploymentProgressTracker` utility
- [ ] Update all unit tests
- [ ] Add integration tests for validation
- [ ] Update documentation
- [ ] Test with canonical config file
- [ ] Verify no regressions in existing functionality

---

**Document Status**: ✅ Research Complete  
**Next Step**: Begin Phase 1 implementation of critical fixes  
**Related**: JINN-186, JINN-190, JINN-191

