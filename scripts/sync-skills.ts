#!/usr/bin/env tsx
/**
 * Sync skills from the central skills/ directory to agent-specific directories.
 *
 * Supports both symlinks (default, Unix/macOS) and copy mode (Windows or explicit).
 *
 * Usage:
 *   yarn skills:sync           # Create symlinks (default)
 *   yarn skills:sync --copy    # Copy files instead of symlinks
 *   yarn skills:sync --dry-run # Show what would be done without doing it
 */

import { readdirSync, existsSync, mkdirSync, rmSync, symlinkSync, cpSync, lstatSync, readlinkSync } from 'fs';
import { join, relative, resolve } from 'path';

// Agent directories that should receive skills
const AGENT_DIRS = [
  '.claude/skills',
  '.gemini/skills',
  '.codex/skills',   // Codex CLI (if used)
  '.cursor/skills',  // Cursor (if used)
  'gemini-extension/skills',  // Autonomous agent extension (installed to GEMINI_HOME)
];

// Source directory for canonical skills
const SKILLS_DIR = 'skills';

// Parse args
const args = process.argv.slice(2);
const useCopy = args.includes('--copy');
const dryRun = args.includes('--dry-run');

function log(msg: string) {
  console.log(msg);
}

function getSkills(): string[] {
  const skillsPath = resolve(SKILLS_DIR);
  if (!existsSync(skillsPath)) {
    console.error(`Skills directory not found: ${skillsPath}`);
    process.exit(1);
  }

  return readdirSync(skillsPath, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .filter(d => existsSync(join(skillsPath, d.name, 'SKILL.md')))
    .map(d => d.name);
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    if (dryRun) {
      log(`  Would create directory: ${dir}`);
    } else {
      mkdirSync(dir, { recursive: true });
      log(`  Created directory: ${dir}`);
    }
  }
}

function syncSkill(skill: string, targetDir: string) {
  const sourcePath = resolve(SKILLS_DIR, skill);
  const targetPath = resolve(targetDir, skill);

  // Check if target already exists
  if (existsSync(targetPath) || lstatSync(targetPath, { throwIfNoEntry: false })) {
    // Check if it's already a correct symlink
    try {
      const stats = lstatSync(targetPath);
      if (stats.isSymbolicLink()) {
        const linkTarget = readlinkSync(targetPath);
        const expectedTarget = relative(targetDir, sourcePath);
        if (linkTarget === expectedTarget || resolve(targetDir, linkTarget) === sourcePath) {
          log(`  ✓ ${targetDir}/${skill} (symlink OK)`);
          return;
        }
      }
    } catch { }

    // Remove existing (different) target
    if (dryRun) {
      log(`  Would remove existing: ${targetPath}`);
    } else {
      rmSync(targetPath, { recursive: true, force: true });
    }
  }

  if (useCopy) {
    // Copy mode
    if (dryRun) {
      log(`  Would copy: ${sourcePath} -> ${targetPath}`);
    } else {
      cpSync(sourcePath, targetPath, { recursive: true });
      log(`  ✓ ${targetDir}/${skill} (copied)`);
    }
  } else {
    // Symlink mode
    const relativeSource = relative(targetDir, sourcePath);
    if (dryRun) {
      log(`  Would symlink: ${targetPath} -> ${relativeSource}`);
    } else {
      symlinkSync(relativeSource, targetPath);
      log(`  ✓ ${targetDir}/${skill} (symlinked)`);
    }
  }
}

function main() {
  log('='.repeat(60));
  log('Skills Sync');
  log(`Mode: ${useCopy ? 'copy' : 'symlink'}${dryRun ? ' (dry run)' : ''}`);
  log('='.repeat(60));
  log('');

  const skills = getSkills();
  if (skills.length === 0) {
    log('No skills found in skills/ directory.');
    return;
  }

  log(`Found ${skills.length} skill(s): ${skills.join(', ')}`);
  log('');

  for (const agentDir of AGENT_DIRS) {
    log(`${agentDir}/`);
    ensureDir(agentDir);

    for (const skill of skills) {
      syncSkill(skill, agentDir);
    }
    log('');
  }

  log('='.repeat(60));
  if (dryRun) {
    log('Dry run complete. No changes made.');
  } else {
    log('Sync complete!');
  }
}

main();
