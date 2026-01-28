/**
 * Ventures & Services Registry Data Layer
 *
 * Fetches data from Supabase via REST API.
 * Uses NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
 */

// Types
export interface Venture {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  owner_address: string;
  blueprint: {
    invariants: Array<{
      id: string;
      name: string;
      description?: string;
      type?: string;
    }>;
  };
  root_workstream_id: string | null;
  job_template_id: string | null;
  config: Record<string, unknown>;
  tags: string[];
  featured: boolean;
  status: 'active' | 'paused' | 'archived';
  created_at: string;
  updated_at: string;
}

export interface Service {
  id: string;
  venture_id: string;
  name: string;
  slug: string;
  description: string | null;
  service_type: 'mcp' | 'api' | 'worker' | 'frontend' | 'library' | 'other';
  repository_url: string | null;
  primary_language: string | null;
  version: string | null;
  config: Record<string, unknown>;
  tags: string[];
  status: 'active' | 'deprecated' | 'archived';
  created_at: string;
  updated_at: string;
  venture?: Venture;
}

export interface Deployment {
  id: string;
  service_id: string;
  environment: 'production' | 'staging' | 'development' | 'preview';
  provider: 'railway' | 'vercel' | 'cloudflare' | 'aws' | 'gcp' | 'azure' | 'self-hosted' | 'other';
  provider_project_id: string | null;
  provider_service_id: string | null;
  url: string | null;
  urls: string[];
  version: string | null;
  config: Record<string, unknown>;
  health_check_url: string | null;
  last_health_check: string | null;
  health_status: 'healthy' | 'unhealthy' | 'degraded' | 'unknown';
  status: 'active' | 'stopped' | 'failed' | 'deploying';
  deployed_at: string;
  created_at: string;
  updated_at: string;
}

export interface Interface {
  id: string;
  service_id: string;
  name: string;
  interface_type: 'mcp_tool' | 'rest_endpoint' | 'graphql' | 'grpc' | 'websocket' | 'webhook' | 'other';
  description: string | null;
  mcp_schema: Record<string, unknown> | null;
  http_method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | null;
  http_path: string | null;
  input_schema: Record<string, unknown> | null;
  output_schema: Record<string, unknown> | null;
  auth_required: boolean;
  auth_type: 'bearer' | 'api_key' | 'oauth' | 'x402' | 'none' | null;
  rate_limit: Record<string, unknown> | null;
  x402_price: number;
  config: Record<string, unknown>;
  tags: string[];
  status: 'active' | 'deprecated' | 'removed';
  created_at: string;
  updated_at: string;
}

// Supabase REST API helper
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function supabaseQuery<T>(
  table: string,
  params: Record<string, string> = {}
): Promise<T[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('Supabase not configured, returning empty array');
    return [];
  }

  const searchParams = new URLSearchParams(params);
  const url = `${SUPABASE_URL}/rest/v1/${table}?${searchParams}`;

  const response = await fetch(url, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    next: { revalidate: 60 }, // Cache for 60 seconds
  });

  if (!response.ok) {
    console.error(`Supabase query failed: ${response.status}`);
    return [];
  }

  return response.json();
}

// Venture Queries
export async function getVentures(): Promise<Venture[]> {
  return supabaseQuery<Venture>('ventures', {
    select: '*',
    order: 'created_at.desc',
  });
}

export async function getFeaturedVentures(): Promise<Venture[]> {
  return supabaseQuery<Venture>('ventures', {
    select: '*',
    featured: 'eq.true',
    status: 'eq.active',
    order: 'created_at.desc',
  });
}

export async function getVenture(id: string): Promise<Venture | null> {
  const ventures = await supabaseQuery<Venture>('ventures', {
    select: '*',
    id: `eq.${id}`,
    limit: '1',
  });
  return ventures[0] || null;
}

export async function getVentureBySlug(slug: string): Promise<Venture | null> {
  const ventures = await supabaseQuery<Venture>('ventures', {
    select: '*',
    slug: `eq.${slug}`,
    limit: '1',
  });
  return ventures[0] || null;
}

// Service Queries
export async function getServices(options: {
  ventureId?: string;
  serviceType?: string;
  status?: string;
  limit?: number;
} = {}): Promise<Service[]> {
  const params: Record<string, string> = {
    select: '*',
    order: 'created_at.desc',
  };

  if (options.ventureId) params.venture_id = `eq.${options.ventureId}`;
  if (options.serviceType) params.service_type = `eq.${options.serviceType}`;
  if (options.status) params.status = `eq.${options.status}`;
  if (options.limit) params.limit = String(options.limit);

  return supabaseQuery<Service>('services', params);
}

export async function getService(id: string): Promise<Service | null> {
  const services = await supabaseQuery<Service>('services', {
    select: '*',
    id: `eq.${id}`,
    limit: '1',
  });
  return services[0] || null;
}

export async function getVentureServices(ventureId: string): Promise<Service[]> {
  return getServices({ ventureId, status: 'active' });
}

// Deployment Queries
export async function getDeployments(serviceId: string): Promise<Deployment[]> {
  return supabaseQuery<Deployment>('deployments', {
    select: '*',
    service_id: `eq.${serviceId}`,
    order: 'deployed_at.desc',
  });
}

export async function getHealthyDeployments(environment?: string): Promise<Deployment[]> {
  const params: Record<string, string> = {
    select: '*',
    health_status: 'eq.healthy',
    status: 'eq.active',
    order: 'deployed_at.desc',
  };

  if (environment) params.environment = `eq.${environment}`;

  return supabaseQuery<Deployment>('deployments', params);
}

// Interface Queries
export async function getInterfaces(serviceId: string): Promise<Interface[]> {
  return supabaseQuery<Interface>('interfaces', {
    select: '*',
    service_id: `eq.${serviceId}`,
    order: 'created_at.desc',
  });
}

export async function getMcpTools(options: {
  serviceId?: string;
  limit?: number;
} = {}): Promise<Interface[]> {
  const params: Record<string, string> = {
    select: '*',
    interface_type: 'eq.mcp_tool',
    status: 'eq.active',
    order: 'created_at.desc',
  };

  if (options.serviceId) params.service_id = `eq.${options.serviceId}`;
  if (options.limit) params.limit = String(options.limit);

  return supabaseQuery<Interface>('interfaces', params);
}

// Combined Queries
export async function getServiceWithDetails(serviceId: string): Promise<{
  service: Service | null;
  deployments: Deployment[];
  interfaces: Interface[];
}> {
  const [service, deployments, interfaces] = await Promise.all([
    getService(serviceId),
    getDeployments(serviceId),
    getInterfaces(serviceId),
  ]);

  return { service, deployments, interfaces };
}

export async function getVentureWithServices(ventureId: string): Promise<{
  venture: Venture | null;
  services: Service[];
}> {
  const [venture, services] = await Promise.all([
    getVenture(ventureId),
    getVentureServices(ventureId),
  ]);

  return { venture, services };
}
