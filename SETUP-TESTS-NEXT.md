# Tests-Next Setup Status

## ✅ Completed Setup

1. **Operate Profile**: Copied compromised test profile to `tests-next/fixtures/operate-profile/`
   - Production profile backed up to `service-backups/operate-profile-backup-20251114-124117/`
   - Test keys now in place (agent: `0xCC97C9c46451c13c0294871BA1c4bbEC94bb0C5a`)
2. **Git Template**: Already exists at `tests-next/fixtures/git-template/` with `.git` directory
3. **Configuration Files**: 
   - `.env.test` created with all required variables
   - Copied from `.env`: SUPABASE_POSTGRES_URL, GITHUB_TOKEN, GIT_AUTHOR_NAME/EMAIL
   - Copied from `.env`: TENDERLY credentials, TEST_GITHUB_REPO
   - Added OPERATE_PROFILE_DIR pointing to test fixtures
4. **Test Helper Update**: Added blueprint support to `createTestJob()` helper

## ✅ Funding Issue Resolved

The Tenderly VNet funding is now working correctly:
- Agent address funded: `0xCC97C9c46451c13c0294871BA1c4bbEC94bb0C5a` with 100 ETH
- Safe address funded: `0x608d976Da1Dd9BC53aeA87Abe74e1306Ab96280c` with 100 ETH
- Transactions are submitting successfully

**Key fixes applied:**
1. Added `WORKER_PRIVATE_KEY` to `.env.test` (must match agent address)
2. Updated `tenderly-runner.ts` to prefer `WORKER_PRIVATE_KEY` from env
3. Fixed `getOperateDir()` to re-evaluate `OPERATE_PROFILE_DIR` on each call (not cached at module load)
4. Increased funding amounts from 10/20 ETH to 100/100 ETH

## ✅ No Manual Steps Required

All configuration is complete:

- ✅ `.env.test` created and populated with all required secrets
- ✅ OPERATE_PROFILE_DIR set to `tests-next/fixtures/operate-profile`
- ✅ Compromised test keys in place (Safe: `0x608d976Da1Dd9BC53aeA87Abe74e1306Ab96280c`)
- ✅ Tenderly credentials configured
- ✅ Test repo configured: `git@github.com/oaksprout/jinn-gemini-test`
- ✅ Git author info set (Oaksprout)
- ✅ Supabase Postgres URL configured

## 🧪 Running Tests

Once the manual steps are complete:

```bash
# Run just the memory system test
yarn vitest run --config vitest.config.next.ts --project system-next tests-next/system/memory-system.system.test.ts

# Run all unit tests (fast)
yarn test:unit:next

# Run all integration tests
yarn test:integration:next

# Run all system tests (requires full setup)
yarn test:system:next

# Run everything
yarn test:next
```

## 📁 Directory Structure

```
tests-next/
├── fixtures/
│   ├── git-template/          ✅ Contains test git repo with .git
│   │   └── .git/              (used as local remote for tests)
│   └── operate-profile/       ✅ Contains .operate data (keys, services, etc.)
│       ├── keys/
│       ├── services/
│       └── wallets/
├── helpers/                   Test helper functions
├── integration/               Integration tests
├── system/                    System tests (requires full environment)
│   └── memory-system.system.test.ts
└── unit/                      Unit tests (no external deps)
```

## 🔍 What Each Secret Does

- **TENDERLY_ACCESS_KEY/ACCOUNT/PROJECT**: Creates ephemeral blockchain test networks (VNets) for isolated testing
- **TEST_GITHUB_REPO**: Tests git lineage, branch creation, and PR workflows without touching your real repo
- **SUPABASE_POSTGRES_URL**: Database for Ponder indexing (stores embeddings, artifacts, request metadata)
- **GIT_AUTHOR_NAME/EMAIL**: Attribution for commits created during tests
- **GITHUB_TOKEN**: Allows tests to push branches and create PRs in test repo

## 📊 Test Logs

System tests create detailed logs in `logs/test-run/<timestamp>/`:
- `ponder.log` - Ponder indexer output
- `control-api.log` - Control API output
- Test failures will print relevant log tails automatically

## ⚠️ Important Notes

1. **Never commit secrets**: `.env.test` is in `.gitignore`
2. **Use test data only**: The operate-profile should contain non-production keys
3. **Dedicated test repo**: Don't use your main repo as `TEST_GITHUB_REPO`
4. **Database isolation**: Use a test Supabase project, not production

