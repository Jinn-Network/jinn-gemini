#!/usr/bin/env tsx
/**
 * Generic Workstream Launcher
 * 
 * Launches a blueprint-based workstream with automatic GitHub repository creation.
 * 
 * Usage: yarn launch:workstream <blueprint-name> [options]
 * 
 * Options:
 *   --dry-run         Print what would happen without creating repo or dispatching
 *   --model           Specify model (default: gemini-2.5-flash)
 *   --context         Additional context string to inject
 *   --skip-repo       Skip GitHub repository creation (artifact-only mode)
 * 
 * Example:
 *   yarn launch:workstream x402-data-service
 *   yarn launch:workstream x402-data-service.json --dry-run
 */

import 'dotenv/config';
import { dispatchNewJob } from '../gemini-agent/mcp/tools/dispatch_new_job.js';
import { readFile, mkdir, writeFile } from 'fs/promises';
import { join, basename, extname } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { scriptLogger } from '../logging/index.js';

interface GitHubRepoResponse {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  ssh_url: string;
}

async function loadBlueprint(filename: string): Promise<{ content: string; path: string; name: string }> {
  // Auto-append .json if not present
  let blueprintFile = filename;
  if (!blueprintFile.endsWith('.json')) {
    blueprintFile = `${blueprintFile}.json`;
  }

  // Try exact path first, then look in blueprints dir
  let blueprintPath = blueprintFile;
  if (!blueprintFile.includes('/')) {
    blueprintPath = join(process.cwd(), 'blueprints', blueprintFile);
  }
  
  try {
    const content = await readFile(blueprintPath, 'utf-8');
    const name = basename(blueprintPath, extname(blueprintPath));
    return { content, path: blueprintPath, name };
  } catch (err) {
    throw new Error(`Could not load blueprint '${filename}': ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function createGitHubRepo(repoName: string, token: string): Promise<GitHubRepoResponse> {
  const response = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: repoName,
      private: true,
      auto_init: false, // We'll initialize it ourselves
      description: `Workstream repository for ${repoName}`,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    if (response.status === 422 && errorBody.includes('already exists')) {
      throw new RepoExistsError(repoName);
    }
    throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
  }

  return await response.json() as GitHubRepoResponse;
}

class RepoExistsError extends Error {
  constructor(public repoName: string) {
    super(`Repository '${repoName}' already exists`);
    this.name = 'RepoExistsError';
  }
}

async function initializeRepo(localPath: string, repoUrl: string, repoName: string): Promise<void> {
  // Create directory
  await mkdir(localPath, { recursive: true });

  // Initialize git repo
  execSync('git init', { cwd: localPath, stdio: 'pipe' });
  
  // Create initial README
  const readmeContent = `# ${repoName}\n\nWorkstream repository for ${repoName}.\n\nThis repository was automatically created by the Jinn workstream launcher.\n`;
  await writeFile(join(localPath, 'README.md'), readmeContent, 'utf-8');

  // Git initial commit
  execSync('git add README.md', { cwd: localPath, stdio: 'pipe' });
  execSync('git commit -m "Initial commit"', { cwd: localPath, stdio: 'pipe' });
  
  // Create main branch explicitly (in case default is not 'main')
  try {
    execSync('git branch -M main', { cwd: localPath, stdio: 'pipe' });
  } catch {
    // Ignore if already on main
  }

  // Add remote and push
  execSync(`git remote add origin ${repoUrl}`, { cwd: localPath, stdio: 'pipe' });
  execSync('git push -u origin main', { cwd: localPath, stdio: 'pipe' });
}

function parseDispatchResponse(result: any): { jobDefinitionId: string; requestId: string } {
  if (!result.content || !result.content[0] || !result.content[0].text) {
    throw new Error(`Invalid dispatch response format: ${JSON.stringify(result)}`);
  }

  const response = JSON.parse(result.content[0].text);
  
  if (!response.meta?.ok) {
    throw new Error(`Dispatch failed: ${response.meta?.message}`);
  }
  
  const data = response.data;
  const requestId = Array.isArray(data.request_ids) ? data.request_ids[0] : data.request_id;
  const jobDefinitionId = data.jobDefinitionId;
  
  if (!jobDefinitionId) {
    throw new Error('No jobDefinitionId in response');
  }
  
  return { jobDefinitionId, requestId };
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option('dry-run', { type: 'boolean', description: 'Simulate without creating repo or dispatching' })
    .option('model', { type: 'string', default: 'gemini-2.5-flash', description: 'Model to use' })
    .option('context', { type: 'string', description: 'Additional context to inject' })
    .option('skip-repo', { type: 'boolean', description: 'Skip GitHub repository creation (artifact-only mode)' })
    .demandCommand(1, 'Please provide a blueprint filename (e.g., x402-data-service)')
    .help()
    .parse();

  const blueprintArg = String(argv._[0]);
  
  try {
    scriptLogger.info('Loading blueprint...');
    const { content: blueprintContent, path: blueprintPath, name: blueprintName } = await loadBlueprint(blueprintArg);
    scriptLogger.info({ blueprintPath }, 'Blueprint loaded');

    // 3-letter random suffix (used for repo disambiguation and job name)
    const shortId = Math.random().toString(36).substring(2, 5).toUpperCase();
    
    // Convert kebab-case or snake_case to Title Case for job name
    const title = blueprintName
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
      
    const jobName = `${title} – ${shortId}`;

    // Prepare context
    let context = argv.context || '';
    
    let repoPath: string | undefined;
    let repoUrl: string | undefined;

    // GitHub repository creation (unless --skip-repo)
    if (!argv.skipRepo) {
      const githubToken = process.env.GITHUB_TOKEN;
      if (!githubToken) {
        throw new Error('GITHUB_TOKEN environment variable is required for repository creation. Use --skip-repo to launch without a repository.');
      }

      let repoName = blueprintName; // Start with blueprint name
      
      scriptLogger.info({ repoName }, 'Creating GitHub repository');
      
      if (argv.dryRun) {
        scriptLogger.info('[DRY RUN] Would create private repository');
      } else {
        let repo: GitHubRepoResponse;
        try {
          repo = await createGitHubRepo(repoName, githubToken);
        } catch (error) {
          if (error instanceof RepoExistsError) {
            // Repo exists, append suffix and retry
            repoName = `${blueprintName}-${shortId.toLowerCase()}`;
            scriptLogger.info({ repoName }, 'Repository exists, retrying with suffix');
            repo = await createGitHubRepo(repoName, githubToken);
          } else {
            throw error;
          }
        }
        
        repoUrl = repo.html_url;
        scriptLogger.info({ repoUrl }, 'Repository created');

        // Clone to local workstream directory
        const workstreamsDir = join(homedir(), '.jinn', 'workstreams');
        repoPath = join(workstreamsDir, repoName);
        
        scriptLogger.info({ repoPath }, 'Initializing local repository');
        await initializeRepo(repoPath, repo.clone_url, repoName);
        scriptLogger.info('Initialized and pushed to main branch');

        // Add repo context
        if (!context) {
          context = `Repository: ${repoUrl}\nLocal path: ${repoPath}`;
        } else {
          context = `${context}\n\nRepository: ${repoUrl}\nLocal path: ${repoPath}`;
        }
      }
    } else {
      scriptLogger.info('Skipping repository creation (--skip-repo flag set)');
    }

    // Inject context into blueprint
    const blueprintObj = JSON.parse(blueprintContent);
    if (blueprintObj.context) {
      blueprintObj.context = `${blueprintObj.context}\n\n[LAUNCHER CONTEXT]\n${context}`;
    } else {
      blueprintObj.context = context || `Launched via generic launcher on ${new Date().toISOString()}.\nBlueprint: ${blueprintName}`;
    }
    const finalBlueprint = JSON.stringify(blueprintObj);

    scriptLogger.info({
      jobName,
      blueprint: blueprintName,
      model: argv.model,
      repoPath,
    }, 'Job configuration');

    if (argv.dryRun) {
      scriptLogger.info('Dry run complete. No job dispatched.');
      if (repoPath) {
        scriptLogger.info('Note: Repository was NOT created (dry run mode).');
      }
      return;
    }

    scriptLogger.info('Dispatching job...');
    
    // Set CODE_METADATA_REPO_ROOT if we created a repo
    if (repoPath) {
      process.env.CODE_METADATA_REPO_ROOT = repoPath;
      scriptLogger.debug({ CODE_METADATA_REPO_ROOT: repoPath }, 'Set CODE_METADATA_REPO_ROOT');
    }

    const result = await dispatchNewJob({
      jobName,
      blueprint: finalBlueprint,
      model: argv.model,
      enabledTools: [
        'web_search',
        'create_artifact',
        'write_file',
        'read_file',
        'replace',
        'list_directory',
        'run_shell_command',
      ],
    });

    const { requestId } = parseDispatchResponse(result);
    
    scriptLogger.info({
      requestId,
      repoUrl,
      repoPath,
      explorerUrl: `https://explorer.jinn.network/requests/${requestId}`,
      runCommand: `yarn dev:mech --workstream=${requestId} --runs=5`,
    }, 'Workstream dispatched successfully');

  } catch (error) {
    scriptLogger.error({
      err: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
    }, 'Launch failed');
    process.exit(1);
  }
}

main();


