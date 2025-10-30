import { resolvePrivateKey, KeyConfig } from './src/config';
import { writeFileSync, unlinkSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

async function main(): Promise<void> {
  console.log('Testing private key resolution...\n');

  // Test 1: Environment variable resolution
  process.env.TEST_MECH_KEY = '0xTEST_ENV_KEY';
  const envConfig: KeyConfig = { source: 'env', envVar: 'TEST_MECH_KEY' };
  const envResolved = resolvePrivateKey(envConfig);
  console.log('Test 1 - env config:', envResolved === '0xTEST_ENV_KEY' ? 'PASS' : 'FAIL');

  // Test 2: File resolution
  const tempFile = './test_key_temp.txt';
  writeFileSync(tempFile, '0xTEST_FILE_KEY', 'utf8');
  const fileConfig: KeyConfig = { source: 'file', filePath: tempFile };
  const fileResolved = resolvePrivateKey(fileConfig);
  unlinkSync(tempFile);
  console.log('Test 2 - file config:', fileResolved === '0xTEST_FILE_KEY' ? 'PASS' : 'FAIL');

  // Test 3: Direct value
  const valueConfig: KeyConfig = { source: 'value', value: '0xTEST_DIRECT_KEY' };
  const valueResolved = resolvePrivateKey(valueConfig);
  console.log('Test 3 - direct value:', valueResolved === '0xTEST_DIRECT_KEY' ? 'PASS' : 'FAIL');

  // Test 4: Fallback chain (env)
  process.env.MECH_PRIVATE_KEY = '0xTEST_FALLBACK_ENV';
  const fallbackEnv = resolvePrivateKey();
  console.log('Test 4 - fallback env:', fallbackEnv === '0xTEST_FALLBACK_ENV' ? 'PASS' : 'FAIL');

  // Test 5: Fallback chain (file)
  delete process.env.MECH_PRIVATE_KEY;
  writeFileSync('ethereum_private_key.txt', '0xTEST_FALLBACK_FILE', 'utf8');
  const fallbackFile = resolvePrivateKey();
  unlinkSync('ethereum_private_key.txt');
  console.log('Test 5 - fallback file:', fallbackFile === '0xTEST_FALLBACK_FILE' ? 'PASS' : 'FAIL');

  // Test 6: No file creation from env
  process.env.MECH_PRIVATE_KEY = '0xTEST_NO_FILE_CREATE';
  const noWriteKey = resolvePrivateKey();
  const fileExists = existsSync('ethereum_private_key.txt');
  console.log('Test 6 - no file creation:', !fileExists && noWriteKey === '0xTEST_NO_FILE_CREATE' ? 'PASS' : 'FAIL');

  delete process.env.MECH_PRIVATE_KEY;
  delete process.env.TEST_MECH_KEY;

  // Test 7: Operate directory explicit config
  const operateRoot = mkdtempSync(join(tmpdir(), 'operate-test-'));
  const servicesDir = join(operateRoot, 'services');
  mkdirSync(servicesDir);
  const serviceDir = join(servicesDir, 'sc-test');
  mkdirSync(serviceDir);
  const keysPath = join(serviceDir, 'keys.json');
  writeFileSync(
    keysPath,
    JSON.stringify([
      {
        address: '0x2187949a10809E79477326ca9f2d04519a841684',
        private_key: '0xTEST_OPERATE_KEY',
        ledger: 'ethereum',
      },
    ]),
    'utf8'
  );

  const operateConfig: KeyConfig = { source: 'operate', operateDir: operateRoot };
  const operateResolved = resolvePrivateKey(operateConfig);
  console.log('Test 7 - operate config:', operateResolved === '0xTEST_OPERATE_KEY' ? 'PASS' : 'FAIL');

  // Test 8: Fallback chain (operate)
  process.env.OPERATE_HOME = operateRoot;
  const fallbackOperate = resolvePrivateKey();
  console.log('Test 8 - fallback operate:', fallbackOperate === '0xTEST_OPERATE_KEY' ? 'PASS' : 'FAIL');

  delete process.env.OPERATE_HOME;
  rmSync(operateRoot, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

