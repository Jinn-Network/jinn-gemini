#!/usr/bin/env tsx
/**
 * Generate ADW Registration Files for all blueprints in blueprints/
 *
 * Usage:
 *   tsx scripts/adw/generate-blueprint-registrations.ts [--dry-run] [--output <dir>]
 *
 * Reads each .json file in blueprints/, builds an ADW Registration File,
 * and writes it to the output directory (default: .adw/blueprints/).
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs'
import { join, basename } from 'path'
import { createHash } from 'crypto'

// Inline the types and builder to keep the script self-contained
// (avoids needing to compile the jinn-node package first)

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
  storage?: Array<{ provider: string; uri: string; gateway?: string }>
  profile?: Record<string, unknown>
}

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

// Parse CLI args
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const outputIdx = args.indexOf('--output')
const outputDir = outputIdx !== -1 ? args[outputIdx + 1] : '.adw/blueprints'
const blueprintsDir = join(process.cwd(), 'blueprints')

if (!existsSync(blueprintsDir)) {
  console.error(`Error: blueprints/ directory not found at ${blueprintsDir}`)
  process.exit(1)
}

const files = readdirSync(blueprintsDir).filter(f => f.endsWith('.json'))
console.log(`Found ${files.length} blueprint files`)

if (!dryRun) {
  mkdirSync(outputDir, { recursive: true })
}

let generated = 0

for (const file of files) {
  const filePath = join(blueprintsDir, file)
  const raw = readFileSync(filePath, 'utf-8')
  const blueprint = JSON.parse(raw)

  const hash = contentHash(raw)
  const slug = basename(file, '.json')

  const invariants = (blueprint.invariants || []).map((inv: Record<string, unknown>) => ({
    id: inv.id,
    type: inv.type,
    condition: inv.condition,
    assessment: inv.assessment,
  }))

  const registration: RegistrationFile = {
    type: ADW_REGISTRATION_TYPE,
    '@context': ADW_CONTEXT,
    documentType: 'adw:Blueprint',
    version: blueprint.version || '1.0.0',
    name: blueprint.name || slug,
    description: blueprint.description || '',
    contentHash: hash,
    creator: 'eip155:8453:jinn-network',
    created: new Date().toISOString(),
    tags: [slug, 'blueprint', ...(blueprint.enabledTools || [])].filter(Boolean),
    profile: {
      invariants,
      enabledTools: (blueprint.enabledTools || []).map((t: string) => ({ name: t })),
    },
  }

  if (dryRun) {
    console.log(`[dry-run] ${file} -> ${slug}.registration.json (hash: ${hash.slice(0, 12)}...)`)
  } else {
    const outPath = join(outputDir, `${slug}.registration.json`)
    writeFileSync(outPath, JSON.stringify(registration, null, 2))
    console.log(`  ${file} -> ${outPath}`)
  }
  generated++
}

console.log(`\n${dryRun ? 'Would generate' : 'Generated'} ${generated} registration files${dryRun ? '' : ` in ${outputDir}/`}`)
