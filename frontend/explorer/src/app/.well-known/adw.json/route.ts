import { NextResponse } from 'next/server'

/**
 * ADW Discovery Endpoint
 *
 * Returns a well-known JSON document that allows ADW-aware clients to discover
 * this node's document capabilities, catalog endpoints, and supported document types.
 *
 * See: ADW Specification v0.1, Section 8 (Discovery Protocol)
 */
export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://explorer.jinn.network'
  const indexerUrl = process.env.NEXT_PUBLIC_SUBGRAPH_URL || 'https://indexer.jinn.network/graphql'

  return NextResponse.json({
    '@context': 'https://adw.dev/v0.1',
    type: 'https://adw.dev/v0.1#discovery',
    name: 'Jinn Network',
    description: 'Decentralized agent work network — ADW-compliant document registry',
    version: '0.1',

    // Supported document types
    documentTypes: [
      'adw:Artifact',
      'adw:Blueprint',
      'adw:Template',
      'adw:Skill',
      'adw:Configuration',
      'adw:Knowledge',
      'adw:AgentCard',
    ],

    // Catalog endpoints
    catalogs: {
      artifacts: `${baseUrl}/adw?type=adw:Artifact`,
      blueprints: `${baseUrl}/adw?type=adw:Blueprint`,
      templates: `${baseUrl}/adw?type=adw:Template`,
    },

    // API endpoints
    api: {
      graphql: indexerUrl,
      explorer: `${baseUrl}/adw`,
    },

    // On-chain registries (Base)
    registries: {
      chain: 'eip155:8453',
      documentRegistry: process.env.NEXT_PUBLIC_ADW_DOCUMENT_REGISTRY || null,
      reputationRegistry: process.env.NEXT_PUBLIC_ADW_REPUTATION_REGISTRY || null,
      validationRegistry: process.env.NEXT_PUBLIC_ADW_VALIDATION_REGISTRY || null,
    },

    // Storage configuration
    storage: {
      primary: 'ipfs',
      gateway: 'https://gateway.autonolas.tech/ipfs/',
    },
  }, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
