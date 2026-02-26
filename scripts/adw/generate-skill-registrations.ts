#!/usr/bin/env tsx
/**
 * Generate ADW Registration Files for all skills in jinn-node/src/gemini-extension/skills/
 *
 * Usage:
 *   tsx scripts/adw/generate-skill-registrations.ts [--dry-run] [--output <dir>]
 *
 * Reads each skill directory (looking for SKILL.md or README.md), builds an
 * ADW Registration File, and writes it to the output directory.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'

const ADW_CONTEXT = 'https://adw.dev/v0.1'
const ADW_REGISTRATION_TYPE = 'https://adw.dev/v0.1#registration'

interface RegistrationFile {
  type: string
  '@context': string
  documentType: string
  version: string
  name: string
  description: string
  contentHash: string
  creator: string
  created: string
  tags?: string[]
  profile?: Record<string, unknown>
}

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function extractDescription(markdown: string): string {
  // Extract first non-empty, non-heading line as description
  const lines = markdown.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('---')) continue
    if (trimmed.startsWith('>')) return trimmed.replace(/^>\s*/, '')
    return trimmed
  }
  return ''
}

// Parse CLI args
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const outputIdx = args.indexOf('--output')
const outputDir = outputIdx !== -1 ? args[outputIdx + 1] : '.adw/skills'
const skillsDir = join(process.cwd(), 'jinn-node', 'src', 'gemini-extension', 'skills')

if (!existsSync(skillsDir)) {
  console.error(`Error: skills directory not found at ${skillsDir}`)
  process.exit(1)
}

const skillDirs = readdirSync(skillsDir).filter(name => {
  const full = join(skillsDir, name)
  return statSync(full).isDirectory()
})

console.log(`Found ${skillDirs.length} skill directories`)

if (!dryRun) {
  mkdirSync(outputDir, { recursive: true })
}

let generated = 0

for (const skillName of skillDirs) {
  const skillPath = join(skillsDir, skillName)

  // Find the main documentation file
  let docContent = ''
  let docFile = ''
  for (const candidate of ['SKILL.md', 'README.md', 'skill.md']) {
    const path = join(skillPath, candidate)
    if (existsSync(path)) {
      docContent = readFileSync(path, 'utf-8')
      docFile = candidate
      break
    }
  }

  if (!docContent) {
    console.log(`  [skip] ${skillName}/ — no SKILL.md or README.md found`)
    continue
  }

  const hash = contentHash(docContent)
  const description = extractDescription(docContent)

  // Look for triggers or allowed tools in the skill doc
  const toolMatches = docContent.match(/tools?:\s*\[([^\]]+)\]/i)
  const tools = toolMatches
    ? toolMatches[1].split(',').map(t => t.trim().replace(/['"]/g, ''))
    : []

  const registration: RegistrationFile = {
    type: ADW_REGISTRATION_TYPE,
    '@context': ADW_CONTEXT,
    documentType: 'adw:Skill',
    version: '1.0.0',
    name: skillName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    description: description.slice(0, 300),
    contentHash: hash,
    creator: 'eip155:8453:jinn-network',
    created: new Date().toISOString(),
    tags: [skillName, 'skill'],
    profile: {
      format: 'markdown',
      ...(tools.length > 0 ? { allowedTools: tools } : {}),
    },
  }

  if (dryRun) {
    console.log(`[dry-run] ${skillName}/${docFile} -> ${skillName}.registration.json (hash: ${hash.slice(0, 12)}...)`)
  } else {
    const outPath = join(outputDir, `${skillName}.registration.json`)
    writeFileSync(outPath, JSON.stringify(registration, null, 2))
    console.log(`  ${skillName}/${docFile} -> ${outPath}`)
  }
  generated++
}

console.log(`\n${dryRun ? 'Would generate' : 'Generated'} ${generated} registration files${dryRun ? '' : ` in ${outputDir}/`}`)
