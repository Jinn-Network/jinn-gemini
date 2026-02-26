#!/usr/bin/env tsx
/**
 * Generate ADW Registration Files for venture templates stored in Supabase.
 *
 * Usage:
 *   tsx scripts/adw/generate-template-registrations.ts [--dry-run] [--output <dir>]
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.
 * Fetches templates from the templates table and generates Registration Files.
 */

import { writeFileSync, mkdirSync } from 'fs'
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

// Parse CLI args
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const outputIdx = args.indexOf('--output')
const outputDir = outputIdx !== -1 ? args[outputIdx + 1] : '.adw/templates'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required')
  console.error('Set them in .env or export them before running this script')
  process.exit(1)
}

async function main() {
  // Fetch templates from Supabase
  const response = await fetch(`${supabaseUrl}/rest/v1/templates?select=*`, {
    headers: {
      apikey: supabaseKey!,
      Authorization: `Bearer ${supabaseKey}`,
    },
  })

  if (!response.ok) {
    console.error(`Error fetching templates: ${response.status} ${response.statusText}`)
    process.exit(1)
  }

  const templates = await response.json() as Array<Record<string, unknown>>
  console.log(`Found ${templates.length} templates in Supabase`)

  if (!dryRun) {
    mkdirSync(outputDir, { recursive: true })
  }

  let generated = 0

  for (const template of templates) {
    const raw = JSON.stringify(template)
    const hash = contentHash(raw)
    const id = String(template.id || 'unknown')
    const name = String(template.name || template.template_name || id)
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

    const registration: RegistrationFile = {
      type: ADW_REGISTRATION_TYPE,
      '@context': ADW_CONTEXT,
      documentType: 'adw:Template',
      version: '1.0.0',
      name,
      description: String(template.description || ''),
      contentHash: hash,
      creator: 'eip155:8453:jinn-network',
      created: new Date().toISOString(),
      tags: [slug, 'template'],
      profile: {
        ...(template.blueprint_hash ? { blueprintHash: template.blueprint_hash } : {}),
        ...(template.input_schema ? { inputSchema: template.input_schema } : {}),
        ...(template.output_spec ? { outputSpec: template.output_spec } : {}),
        ...(template.status ? { status: template.status } : {}),
      },
    }

    if (dryRun) {
      console.log(`[dry-run] ${name} (${id}) -> ${slug}.registration.json`)
    } else {
      const outPath = join(outputDir, `${slug}.registration.json`)
      writeFileSync(outPath, JSON.stringify(registration, null, 2))
      console.log(`  ${name} -> ${outPath}`)
    }
    generated++
  }

  console.log(`\n${dryRun ? 'Would generate' : 'Generated'} ${generated} registration files${dryRun ? '' : ` in ${outputDir}/`}`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
