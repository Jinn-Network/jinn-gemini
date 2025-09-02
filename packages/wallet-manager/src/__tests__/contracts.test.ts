/**
 * Unit tests for Safe contract resolution functionality.
 * 
 * These tests verify that the contract resolution logic correctly
 * resolves Safe contract addresses for supported chains and versions.
 */

import { resolveSafeContracts, createContractNetworks } from '../contracts';

describe('Safe Contract Resolution', () => {
  describe('resolveSafeContracts', () => {
    it('should resolve all contract addresses for Base mainnet', () => {
      const contracts = resolveSafeContracts(8453, '1.4.1');
      
      // Verify all addresses are present and properly formatted
      expect(contracts.safeMasterCopyAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(contracts.safeProxyFactoryAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(contracts.multiSendAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(contracts.multiSendCallOnlyAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(contracts.fallbackHandlerAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      
      // Verify addresses are non-zero
      expect(contracts.safeMasterCopyAddress).not.toBe('0x0000000000000000000000000000000000000000');
      expect(contracts.safeProxyFactoryAddress).not.toBe('0x0000000000000000000000000000000000000000');
      expect(contracts.multiSendAddress).not.toBe('0x0000000000000000000000000000000000000000');
      expect(contracts.multiSendCallOnlyAddress).not.toBe('0x0000000000000000000000000000000000000000');
      expect(contracts.fallbackHandlerAddress).not.toBe('0x0000000000000000000000000000000000000000');
      
      // Verify addresses are unique (where they should be)
      const addresses = [
        contracts.safeMasterCopyAddress,
        contracts.safeProxyFactoryAddress,
        contracts.multiSendAddress,
        contracts.multiSendCallOnlyAddress,
        contracts.fallbackHandlerAddress
      ];
      const uniqueAddresses = new Set(addresses);
      expect(uniqueAddresses.size).toBe(addresses.length);
    });

    it('should resolve all contract addresses for Base Sepolia', () => {
      const contracts = resolveSafeContracts(84532, '1.4.1');
      
      // Verify all addresses are present and properly formatted
      expect(contracts.safeMasterCopyAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(contracts.safeProxyFactoryAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(contracts.multiSendAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(contracts.multiSendCallOnlyAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(contracts.fallbackHandlerAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      
      // Verify addresses are non-zero
      expect(contracts.safeMasterCopyAddress).not.toBe('0x0000000000000000000000000000000000000000');
      expect(contracts.safeProxyFactoryAddress).not.toBe('0x0000000000000000000000000000000000000000');
      expect(contracts.multiSendAddress).not.toBe('0x0000000000000000000000000000000000000000');
      expect(contracts.multiSendCallOnlyAddress).not.toBe('0x0000000000000000000000000000000000000000');
      expect(contracts.fallbackHandlerAddress).not.toBe('0x0000000000000000000000000000000000000000');
    });

    it('should throw an error for unsupported chain ID', () => {
      expect(() => {
        resolveSafeContracts(999999, '1.4.1');
      }).toThrow(/not deployed on chain 999999/);
    });

    it('should provide specific error messages for missing contracts', () => {
      // Test with a chain that might not have all Safe contracts
      expect(() => {
        resolveSafeContracts(999999, '1.4.1');
      }).toThrow(/Safe singleton version 1\.4\.1 not deployed on chain 999999/);
    });

    it('should return consistent addresses for the same chain', () => {
      const contracts1 = resolveSafeContracts(8453, '1.4.1');
      const contracts2 = resolveSafeContracts(8453, '1.4.1');
      
      expect(contracts1.safeMasterCopyAddress).toBe(contracts2.safeMasterCopyAddress);
      expect(contracts1.safeProxyFactoryAddress).toBe(contracts2.safeProxyFactoryAddress);
      expect(contracts1.multiSendAddress).toBe(contracts2.multiSendAddress);
      expect(contracts1.multiSendCallOnlyAddress).toBe(contracts2.multiSendCallOnlyAddress);
      expect(contracts1.fallbackHandlerAddress).toBe(contracts2.fallbackHandlerAddress);
    });

    it('should handle different chains independently', () => {
      const baseContracts = resolveSafeContracts(8453, '1.4.1');
      const sepoliaContracts = resolveSafeContracts(84532, '1.4.1');
      
      // Both should return valid contracts (addresses may be same for Safe canonical deployments)
      expect(baseContracts.safeMasterCopyAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(sepoliaContracts.safeMasterCopyAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      
      // Contracts should be non-zero for both chains
      expect(baseContracts.safeMasterCopyAddress).not.toBe('0x0000000000000000000000000000000000000000');
      expect(sepoliaContracts.safeMasterCopyAddress).not.toBe('0x0000000000000000000000000000000000000000');
      
      // Function should work independently for each chain
      expect(baseContracts).toHaveProperty('safeMasterCopyAddress');
      expect(baseContracts).toHaveProperty('safeProxyFactoryAddress');
      expect(sepoliaContracts).toHaveProperty('safeMasterCopyAddress');
      expect(sepoliaContracts).toHaveProperty('safeProxyFactoryAddress');
    });
  });

  describe('createContractNetworks', () => {
    it('should create a properly formatted contract networks object', () => {
      const contracts = resolveSafeContracts(8453, '1.4.1');
      const contractNetworks = createContractNetworks(8453, contracts);
      
      expect(contractNetworks).toHaveProperty('8453');
      expect(contractNetworks[8453]).toEqual(contracts);
      expect(contractNetworks[8453].safeMasterCopyAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(contractNetworks[8453].safeProxyFactoryAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(contractNetworks[8453].multiSendAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(contractNetworks[8453].multiSendCallOnlyAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(contractNetworks[8453].fallbackHandlerAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should work with different chain IDs', () => {
      const baseContracts = resolveSafeContracts(8453, '1.4.1');
      const sepoliaContracts = resolveSafeContracts(84532, '1.4.1');
      
      const baseNetworks = createContractNetworks(8453, baseContracts);
      const sepoliaNetworks = createContractNetworks(84532, sepoliaContracts);
      
      expect(baseNetworks).toHaveProperty('8453');
      expect(baseNetworks).not.toHaveProperty('84532');
      expect(sepoliaNetworks).toHaveProperty('84532');
      expect(sepoliaNetworks).not.toHaveProperty('8453');
      
      expect(baseNetworks[8453]).toEqual(baseContracts);
      expect(sepoliaNetworks[84532]).toEqual(sepoliaContracts);
    });
  });
});
