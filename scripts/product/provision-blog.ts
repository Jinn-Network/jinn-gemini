#!/usr/bin/env npx tsx
/**
 * Blog Provisioning Script
 * 
 * Automates customer onboarding for the Blog Growth product:
 * 1. Forks the blog template repository
 * 2. Creates a Railway service linked to the forked repo
 * 3. Creates an Umami website for analytics
 * 4. Dispatches the initial blog growth workstream
 * 5. Saves customer config to local JSON
 * 
 * Usage:
 *   yarn provision:blog --customer="acme-corp" --display-name="Acme Corp Blog"
 *   yarn provision:blog --customer="acme-corp" --display-name="Acme Corp Blog" --dry-run
 */

import 'dotenv/config';
import { parseArgs } from 'node:util';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { forkBlogTemplate } from './lib/github.js';
import { createRailwayService } from './lib/railway.js';
import { createUmamiWebsite, findUmamiWebsite } from './lib/umami.js';
import { executeTemplate } from './lib/x402.js';

// Template ID from Ponder (auto-derived from dispatched job)
const BLOG_GROWTH_TEMPLATE_ID = 'blog-growth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../..');
const CUSTOMERS_FILE = join(PROJECT_ROOT, 'data/customers.json');

interface CustomerConfig {
    displayName: string;
    repo: string;
    sshUrl: string;
    railwayServiceId: string;
    domain: string;
    umamiWebsiteId: string;
    workstreamId?: string;
    createdAt: string;
}

interface CustomersData {
    [customerSlug: string]: CustomerConfig;
}

function loadCustomers(): CustomersData {
    if (!existsSync(CUSTOMERS_FILE)) {
        return {};
    }
    return JSON.parse(readFileSync(CUSTOMERS_FILE, 'utf-8'));
}

function saveCustomers(data: CustomersData): void {
    const dir = dirname(CUSTOMERS_FILE);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    writeFileSync(CUSTOMERS_FILE, JSON.stringify(data, null, 2) + '\n');
}

async function launchWorkstream(
    repo: string,
    umamiWebsiteId: string,
    options: { dryRun?: boolean; cyclic?: boolean } = {}
): Promise<string | null> {
    if (options.dryRun) {
        console.log(`[DRY RUN] Would launch workstream with:`);
        console.log(`[DRY RUN]   --repo=${repo}`);
        console.log(`[DRY RUN]   --env UMAMI_WEBSITE_ID=${umamiWebsiteId}`);
        if (options.cyclic) console.log(`[DRY RUN]   --cyclic`);
        return 'dry-run-workstream-id';
    }

    console.log(`Launching blog growth workstream${options.cyclic ? ' (cyclic)' : ''}...`);

    try {
        const cmdParts = [
            'yarn', 'launch:workstream', 'blog-growth-orchestrator',
            `--repo=${repo}`,
            `--env`, `UMAMI_WEBSITE_ID=${umamiWebsiteId}`,
        ];
        if (options.cyclic) {
            cmdParts.push('--cyclic');
        }
        const cmd = cmdParts.join(' ');

        const output = execSync(cmd, {
            cwd: PROJECT_ROOT,
            encoding: 'utf-8',
            stdio: ['inherit', 'pipe', 'inherit'],
        });

        // Extract workstream ID from output
        const match = output.match(/workstream[s]?[\/=]*(0x[a-fA-F0-9]+)/i);
        if (match) {
            console.log(`Workstream launched: ${match[1]}`);
            return match[1];
        }

        console.log('Workstream launched (could not extract ID)');
        return null;
    } catch (error: any) {
        console.error('Failed to launch workstream:', error.message);
        return null;
    }
}

async function main() {
    const { values } = parseArgs({
        options: {
            customer: { type: 'string', short: 'c' },
            'display-name': { type: 'string', short: 'n' },
            config: { type: 'string', short: 'C' },
            cyclic: { type: 'boolean', default: false },
            'dry-run': { type: 'boolean', default: false },
            'skip-workstream': { type: 'boolean', default: false },
            'use-x402': { type: 'boolean', default: false },
            help: { type: 'boolean', short: 'h' },
        },
        strict: true,
    });

    if (values.help) {
        console.log(`
Blog Provisioning Script

Usage:
  yarn provision:blog --customer=<slug> --display-name=<name> [options]

Options:
  -c, --customer       Customer slug (lowercase, used for repo name) [required]
  -n, --display-name   Human-readable blog name [required]
  -C, --config         Path to JSON config file with template inputs
  --cyclic             Run workstream continuously (auto-restart)
  --dry-run            Preview without creating resources
  --skip-workstream    Skip dispatching the initial workstream
  --use-x402           Use x402 gateway API instead of direct dispatch
  -h, --help           Show this help message

Examples:
  yarn provision:blog --customer="acme-corp" --display-name="Acme Corp Blog"
  yarn provision:blog --customer="the-lamp" --display-name="The Lamp" --config=configs/the-lamp.json --use-x402
`);
        process.exit(0);
    }

    const customerSlug = values.customer;
    const displayName = values['display-name'];
    const configPath = values.config;
    const dryRun = values['dry-run'] ?? false;
    const skipWorkstream = values['skip-workstream'] ?? false;
    const useX402 = values['use-x402'] ?? false;

    // Load config file if provided
    let blogConfig: Record<string, unknown> = {};
    if (configPath) {
        const configFullPath = configPath.startsWith('/') ? configPath : join(PROJECT_ROOT, configPath);
        if (!existsSync(configFullPath)) {
            console.error(`Error: Config file not found: ${configFullPath}`);
            process.exit(1);
        }
        blogConfig = JSON.parse(readFileSync(configFullPath, 'utf-8'));
        console.log(`Loaded config from: ${configFullPath}`);
    }

    if (!customerSlug) {
        console.error('Error: --customer is required');
        process.exit(1);
    }

    if (!displayName) {
        console.error('Error: --display-name is required');
        process.exit(1);
    }

    // Validate customer slug format
    if (!/^[a-z0-9-]+$/.test(customerSlug)) {
        console.error('Error: --customer must be lowercase alphanumeric with hyphens only');
        process.exit(1);
    }

    // Check if customer already exists
    const customers = loadCustomers();
    if (customers[customerSlug] && !dryRun) {
        console.error(`Error: Customer "${customerSlug}" already exists`);
        console.error(`  Repo: ${customers[customerSlug].repo}`);
        console.error(`  Domain: ${customers[customerSlug].domain}`);
        process.exit(1);
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Provisioning Blog: ${displayName}`);
    console.log(`Customer Slug: ${customerSlug}`);
    if (dryRun) console.log('Mode: DRY RUN');
    console.log(`${'='.repeat(60)}\n`);

    // Step 1: Fork template repository
    console.log('Step 1/5: Forking blog template repository...');
    const forkResult = await forkBlogTemplate(customerSlug, { dryRun });
    console.log(`  ✓ Repository: ${forkResult.fullName}\n`);

    // Step 2: Create Railway service
    console.log('Step 2/5: Creating Railway service...');
    const railwayResult = await createRailwayService(
        customerSlug,
        forkResult.sshUrl,
        { dryRun }
    );
    console.log(`  ✓ Service ID: ${railwayResult.serviceId}`);
    console.log(`  ✓ Domain: ${railwayResult.domain}\n`);

    // Step 3: Create Umami website
    console.log('Step 3/5: Creating Umami website...');

    // Check if website already exists
    let umamiResult = dryRun ? null : await findUmamiWebsite(railwayResult.domain);
    if (umamiResult) {
        console.log(`  (Website already exists, using existing)`);
    } else {
        umamiResult = await createUmamiWebsite(displayName, railwayResult.domain, { dryRun });
    }
    console.log(`  ✓ Website ID: ${umamiResult!.websiteId}\n`);

    // Step 4: Launch workstream (via x402 gateway or direct dispatch)
    let workstreamId: string | null = null;
    let requestId: string | null = null;
    let statusUrl: string | null = null;

    if (!skipWorkstream) {
        if (useX402) {
            console.log('Step 4/5: Executing via x402 gateway...');
            const result = await executeTemplate(
                BLOG_GROWTH_TEMPLATE_ID,
                {
                    blogName: displayName,
                    mission: blogConfig.mission as string ?? 'Build thought leadership in the blog topic',
                    strategy: blogConfig.strategy as string ?? 'Create high-quality content for the target audience',
                    sources: blogConfig.sources as string[] ?? [],
                    referrals: blogConfig.referrals as string ?? '',
                    umamiWebsiteId: umamiResult!.websiteId,
                    repoUrl: forkResult.fullName,
                    domain: railwayResult.domain,
                },
                { dryRun }
            );
            requestId = result.requestId;
            statusUrl = result.statusUrl;
            console.log(`  ✓ Request ID: ${requestId}`);
            console.log(`  ✓ Status URL: ${statusUrl}\n`);
        } else {
            console.log('Step 4/5: Launching blog growth workstream (direct dispatch)...');
            workstreamId = await launchWorkstream(
                forkResult.fullName,
                umamiResult!.websiteId,
                { dryRun, cyclic: values.cyclic ?? false }
            );
            if (workstreamId) {
                console.log(`  ✓ Workstream ID: ${workstreamId}\n`);
            } else {
                console.log(`  ⚠ Workstream launched but ID not captured\n`);
            }
        }
    } else {
        console.log('Step 4/5: Skipping workstream (--skip-workstream)\n');
    }

    // Step 5: Save customer config
    console.log('Step 5/5: Saving customer configuration...');
    if (!dryRun) {
        customers[customerSlug] = {
            displayName,
            repo: forkResult.fullName,
            sshUrl: forkResult.sshUrl,
            railwayServiceId: railwayResult.serviceId,
            domain: railwayResult.domain,
            umamiWebsiteId: umamiResult!.websiteId,
            workstreamId: workstreamId ?? undefined,
            createdAt: new Date().toISOString(),
        };
        saveCustomers(customers);
        console.log(`  ✓ Saved to: ${CUSTOMERS_FILE}\n`);
    } else {
        console.log(`  [DRY RUN] Would save to: ${CUSTOMERS_FILE}\n`);
    }

    // Summary
    console.log(`${'='.repeat(60)}`);
    console.log('✅ Provisioning Complete!\n');
    console.log(`Blog URL:      https://${railwayResult.domain}`);
    console.log(`GitHub Repo:   ${forkResult.htmlUrl}`);
    console.log(`Umami ID:      ${umamiResult!.websiteId}`);
    if (requestId) {
        console.log(`Request ID:    ${requestId}`);
        console.log(`Status URL:    ${statusUrl}`);
    } else if (workstreamId) {
        console.log(`Workstream:    https://explorer.jinn.network/workstreams/${workstreamId}`);
    }
    console.log(`${'='.repeat(60)}\n`);

    if (dryRun) {
        console.log('This was a dry run. No resources were created.\n');
    }
}

main().catch((error) => {
    console.error('\n❌ Provisioning failed:', error.message);
    process.exit(1);
});
