import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';

export interface GitFixture {
  repoPath: string;
  cleanup: () => void;
}

const TEMPLATE_DIR = path.resolve(process.cwd(), 'tests-next/fixtures/git-template');
const TMP_ROOT = path.resolve(process.cwd(), 'tests-next', '.tmp', 'git-fixtures');

function assertTemplateRepo(): void {
  if (!fs.existsSync(TEMPLATE_DIR)) {
    throw new Error(`Git template directory missing: ${TEMPLATE_DIR}`);
  }
  if (!fs.existsSync(path.join(TEMPLATE_DIR, '.git'))) {
    throw new Error(`Git template at ${TEMPLATE_DIR} is not a repository. Run 'git init' and add desired fixtures.`);
  }
}

export function createGitFixture(): GitFixture {
  assertTemplateRepo();
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const target = path.join(TMP_ROOT, `fixture-${Date.now()}-${randomUUID()}`);
  execSync(`git clone ${JSON.stringify(TEMPLATE_DIR)} ${JSON.stringify(target)}`, { stdio: 'inherit' });

  return {
    repoPath: target,
    cleanup: () => {
      fs.rmSync(target, { recursive: true, force: true });
    },
  };
}

export async function withGitFixture<T>(
  fn: (fixture: GitFixture) => Promise<T> | T
): Promise<T> {
  const fixture = createGitFixture();
  const prevRepoRoot = process.env.CODE_METADATA_REPO_ROOT;
  process.env.CODE_METADATA_REPO_ROOT = fixture.repoPath;
  try {
    return await fn(fixture);
  } finally {
    fixture.cleanup();
    if (typeof prevRepoRoot === 'undefined') {
      delete process.env.CODE_METADATA_REPO_ROOT;
    } else {
      process.env.CODE_METADATA_REPO_ROOT = prevRepoRoot;
    }
  }
}
