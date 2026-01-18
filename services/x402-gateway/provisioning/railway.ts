/**
 * Railway provisioning for x402 gateway
 * Creates Railway services linked to customer repos
 */

const RAILWAY_API_URL = 'https://backboard.railway.com/graphql/v2';

export interface RailwayProvisionResult {
  serviceId: string;
  domain: string;
  projectId: string;
  environmentId: string;
}

/**
 * Create a Railway service for a customer blog
 */
export async function provisionRailwayService(
  customerSlug: string,
  repoFullName: string
): Promise<RailwayProvisionResult> {
  const token = process.env.RAILWAY_API_TOKEN;
  // Use BLOG_RAILWAY_PROJECT_ID to avoid collision with Railway's auto-injected RAILWAY_PROJECT_ID
  const projectId = process.env.BLOG_RAILWAY_PROJECT_ID;

  if (!token) {
    throw new Error('RAILWAY_API_TOKEN environment variable is required for provisioning');
  }
  if (!projectId) {
    throw new Error('BLOG_RAILWAY_PROJECT_ID environment variable is required for provisioning');
  }

  const serviceName = `blog-${customerSlug}`;

  // Create service
  console.log(`[provision] Creating Railway service: ${serviceName}...`);

  const createServiceMutation = `
    mutation ServiceCreate($input: ServiceCreateInput!) {
      serviceCreate(input: $input) {
        id
        name
      }
    }
  `;

  const createResponse = await fetch(RAILWAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      query: createServiceMutation,
      variables: {
        input: {
          projectId,
          name: serviceName,
          source: {
            repo: repoFullName,
          },
        },
      },
    }),
  });

  const createResult = await createResponse.json();
  if (createResult.errors) {
    throw new Error(`Railway API error: ${JSON.stringify(createResult.errors)}`);
  }

  const serviceId = createResult.data?.serviceCreate?.id;
  if (!serviceId) {
    throw new Error('Failed to create Railway service - no ID returned');
  }

  console.log(`[provision] Railway service created: ${serviceId}`);

  // Get project's default environment
  const envQuery = `
    query GetProjectEnvironments($projectId: String!) {
      project(id: $projectId) {
        environments {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    }
  `;

  const envResponse = await fetch(RAILWAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      query: envQuery,
      variables: { projectId },
    }),
  });

  const envResult = await envResponse.json();
  const environments = envResult.data?.project?.environments?.edges || [];
  const productionEnv = environments.find((e: any) => e.node.name === 'production');
  const environmentId = productionEnv?.node?.id || environments[0]?.node?.id;

  // Generate domain
  const domainMutation = `
    mutation ServiceDomainCreate($input: ServiceDomainCreateInput!) {
      serviceDomainCreate(input: $input) {
        domain
      }
    }
  `;

  const domainResponse = await fetch(RAILWAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      query: domainMutation,
      variables: {
        input: {
          serviceId,
          environmentId,
        },
      },
    }),
  });

  const domainResult = await domainResponse.json();
  const generatedDomain = domainResult.data?.serviceDomainCreate?.domain || `${serviceName}.up.railway.app`;

  console.log(`[provision] Railway domain: ${generatedDomain}`);

  // Trigger deployment
  if (environmentId) {
    console.log(`[provision] Triggering Railway deployment...`);
    const deployMutation = `
      mutation ServiceInstanceDeploy($serviceId: String!, $environmentId: String!) {
        serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId, latestCommit: true)
      }
    `;

    const deployResponse = await fetch(RAILWAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: deployMutation,
        variables: {
          serviceId,
          environmentId,
        },
      }),
    });
    const deployResult = await deployResponse.json();
    if (deployResult.errors) {
      console.warn(`[provision] Deployment trigger warning: ${JSON.stringify(deployResult.errors)}`);
    } else {
      console.log(`[provision] Deployment triggered successfully`);
    }
  }

  return {
    serviceId,
    domain: generatedDomain,
    projectId,
    environmentId: environmentId || '',
  };
}

/**
 * Set environment variables on a Railway service
 */
export async function setRailwayServiceVariables(
  projectId: string,
  serviceId: string,
  environmentId: string,
  variables: Record<string, string>
): Promise<void> {
  const token = process.env.RAILWAY_API_TOKEN;
  if (!token) {
    throw new Error('RAILWAY_API_TOKEN environment variable is required');
  }

  const upsertMutation = `
    mutation VariableUpsert($input: VariableUpsertInput!) {
      variableUpsert(input: $input)
    }
  `;

  for (const [name, value] of Object.entries(variables)) {
    console.log(`[provision] Setting Railway variable: ${name}...`);

    const response = await fetch(RAILWAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: upsertMutation,
        variables: {
          input: {
            projectId,
            serviceId,
            environmentId,
            name,
            value,
          },
        },
      }),
    });

    const result = await response.json();
    if (result.errors) {
      console.warn(`[provision] Warning: Failed to set ${name}: ${JSON.stringify(result.errors)}`);
    }
  }

  console.log(`[provision] Railway variables configured successfully`);
}
