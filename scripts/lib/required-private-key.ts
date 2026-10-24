/** Read wallet secrets from the environment without including values in errors. */
export function requiredPrivateKey(name: string): string {
  const value = process.env[name];
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be set to a 0x-prefixed 32-byte private key`);
  }
  return value;
}
