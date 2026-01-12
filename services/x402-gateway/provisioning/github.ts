/**
 * GitHub provisioning for x402 gateway
 * Creates blog repos from the jinn-blog template
 */

import { Octokit } from '@octokit/rest';

const TEMPLATE_OWNER = 'Jinn-Network';
const TEMPLATE_REPO = 'jinn-blog';

export interface GitHubProvisionResult {
  repoUrl: string;
  sshUrl: string;
  htmlUrl: string;
  fullName: string;
}

/**
 * Create a new repo from the blog template for a customer
 */
export async function provisionGitHubRepo(
  customerSlug: string
): Promise<GitHubProvisionResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is required for provisioning');
  }

  const newRepoName = `blog-${customerSlug}`;
  const fullName = `${TEMPLATE_OWNER}/${newRepoName}`;

  const octokit = new Octokit({ auth: token });

  // Check if repo already exists (idempotent)
  try {
    const existing = await octokit.repos.get({
      owner: TEMPLATE_OWNER,
      repo: newRepoName,
    });
    if (existing.data) {
      console.log(`[provision] GitHub repo ${fullName} already exists, using existing`);
      return {
        repoUrl: existing.data.clone_url,
        sshUrl: existing.data.ssh_url,
        htmlUrl: existing.data.html_url,
        fullName: existing.data.full_name,
      };
    }
  } catch (e: any) {
    if (e.status !== 404) {
      throw e;
    }
    // 404 means repo doesn't exist, proceed with creation
  }

  // Create repo from template
  console.log(`[provision] Creating GitHub repo ${fullName} from template...`);

  const response = await octokit.repos.createUsingTemplate({
    template_owner: TEMPLATE_OWNER,
    template_repo: TEMPLATE_REPO,
    name: newRepoName,
    owner: TEMPLATE_OWNER,
    description: `Blog for ${customerSlug}`,
    private: false,
    include_all_branches: false,
  });

  console.log(`[provision] GitHub repo created: ${response.data.html_url}`);

  return {
    repoUrl: response.data.clone_url,
    sshUrl: response.data.ssh_url,
    htmlUrl: response.data.html_url,
    fullName: response.data.full_name,
  };
}
