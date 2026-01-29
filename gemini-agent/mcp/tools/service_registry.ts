import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { mcpLogger } from '../../../logging/index.js';

// ============================================================================
// Shared Types
// ============================================================================

const serviceTypeEnum = z.enum(['mcp', 'api', 'worker', 'frontend', 'library', 'other']);
const environmentEnum = z.enum(['production', 'staging', 'development', 'preview']);
const providerEnum = z.enum(['railway', 'vercel', 'cloudflare', 'aws', 'gcp', 'azure', 'self-hosted', 'other']);
const deploymentStatusEnum = z.enum(['active', 'stopped', 'failed', 'deploying']);
const healthStatusEnum = z.enum(['healthy', 'unhealthy', 'degraded', 'unknown']);
const interfaceTypeEnum = z.enum(['mcp_tool', 'rest_endpoint', 'graphql', 'grpc', 'websocket', 'webhook', 'other']);
const authTypeEnum = z.enum(['bearer', 'api_key', 'oauth', 'x402', 'none']);
const interfaceStatusEnum = z.enum(['active', 'deprecated', 'removed']);

// ============================================================================
// Service Registry Tool
// ============================================================================

export const serviceRegistryParams = z.object({
  action: z.enum([
    'create_service',
    'get_service',
    'list_services',
    'update_service',
    'delete_service',
    'create_deployment',
    'list_deployments',
    'update_deployment',
    'create_interface',
    'list_interfaces',
    'update_interface',
  ]).describe('The action to perform'),

  // Service fields
  id: z.string().uuid().optional().describe('Service/Deployment/Interface ID for get/update/delete'),
  ventureId: z.string().uuid().optional().describe('Venture ID (required for create_service)'),
  serviceId: z.string().uuid().optional().describe('Service ID (required for deployment/interface operations)'),
  name: z.string().optional().describe('Service/Interface name'),
  slug: z.string().optional().describe('URL-friendly slug'),
  description: z.string().optional().describe('Description'),
  serviceType: serviceTypeEnum.optional().describe('Service type'),
  repositoryUrl: z.string().optional().describe('Git repository URL'),

  // Deployment/Interface shared fields
  version: z.string().optional().describe('Version (for deployments)'),
  config: z.record(z.any()).optional().describe('Additional configuration (for deployments/interfaces)'),
  tags: z.array(z.string()).optional().describe('Tags (for interfaces)'),
  status: z.union([deploymentStatusEnum, interfaceStatusEnum]).optional().describe('Status (for deployments/interfaces)'),

  // Deployment fields
  environment: environmentEnum.optional().describe('Deployment environment'),
  provider: providerEnum.optional().describe('Deployment provider'),
  providerProjectId: z.string().optional().describe('Provider project ID'),
  providerServiceId: z.string().optional().describe('Provider service ID'),
  url: z.string().optional().describe('Primary URL'),
  urls: z.array(z.string()).optional().describe('Additional URLs'),
  healthCheckUrl: z.string().optional().describe('Health check endpoint'),
  healthStatus: healthStatusEnum.optional().describe('Health status'),

  // Interface fields
  interfaceType: interfaceTypeEnum.optional().describe('Interface type'),
  mcpSchema: z.record(z.any()).optional().describe('MCP tool schema'),
  httpMethod: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional().describe('HTTP method'),
  httpPath: z.string().optional().describe('HTTP path pattern'),
  inputSchema: z.record(z.any()).optional().describe('Input JSON Schema'),
  outputSchema: z.record(z.any()).optional().describe('Output JSON Schema'),
  authRequired: z.boolean().optional().describe('Whether auth is required'),
  authType: authTypeEnum.optional().describe('Auth type'),
  rateLimit: z.record(z.any()).optional().describe('Rate limit config'),
  x402Price: z.number().optional().describe('Price in wei for x402'),

  // List filters
  search: z.string().optional().describe('Search query'),
  limit: z.number().optional().describe('Limit results'),
  offset: z.number().optional().describe('Offset for pagination'),
});

export type ServiceRegistryParams = z.infer<typeof serviceRegistryParams>;

export const serviceRegistrySchema = {
  description: `Unified service registry for managing services, deployments, and interfaces.

ACTIONS:
- create_service: Register a new service (requires: ventureId, name, serviceType)
- get_service: Get service by ID (requires: id)
- list_services: List services with filters (optional: ventureId, serviceType, search, limit, offset)
- update_service: Update service (requires: id, plus fields to update)
- delete_service: Delete service (requires: id)
- create_deployment: Add deployment (requires: serviceId, environment, provider)
- list_deployments: List deployments (optional: serviceId, environment, provider, status)
- update_deployment: Update deployment (requires: id, plus fields to update)
- create_interface: Add interface (requires: serviceId, name, interfaceType)
- list_interfaces: List interfaces (optional: serviceId, interfaceType, authType, status)
- update_interface: Update interface (requires: id, plus fields to update)

Returns: { result: <data>, meta: { ok, code?, message? } }`,
  inputSchema: serviceRegistryParams.shape,
};

/**
 * Generate a URL-friendly slug from a name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Unified service registry operations.
 */
export async function serviceRegistry(args: unknown) {
  try {
    const parsed = serviceRegistryParams.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: { ok: false, code: 'VALIDATION_ERROR', message: parsed.error.message }
          })
        }]
      };
    }

    const params = parsed.data;

    switch (params.action) {
      // ======================================================================
      // Service Operations
      // ======================================================================
      case 'create_service': {
        if (!params.ventureId || !params.name || !params.serviceType) {
          return errorResponse('VALIDATION_ERROR', 'create_service requires ventureId, name, and serviceType');
        }

        const slug = params.slug || generateSlug(params.name);
        const record = {
          venture_id: params.ventureId,
          name: params.name,
          slug,
          description: params.description || null,
          service_type: params.serviceType,
          repository_url: params.repositoryUrl || null,
        };

        const { data, error } = await supabase
          .from('services')
          .insert(record)
          .select()
          .single();

        if (error) return dbErrorResponse(error.message, 'create_service');
        mcpLogger.info({ serviceId: data.id, name: params.name }, 'Created service');
        return successResponse({ service: data });
      }

      case 'get_service': {
        if (!params.id) {
          return errorResponse('VALIDATION_ERROR', 'get_service requires id');
        }

        const { data, error } = await supabase
          .from('services')
          .select('*')
          .eq('id', params.id)
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            return errorResponse('NOT_FOUND', `Service not found: ${params.id}`);
          }
          return dbErrorResponse(error.message, 'get_service');
        }
        return successResponse({ service: data });
      }

      case 'list_services': {
        let query = supabase
          .from('services')
          .select('*')
          .order('created_at', { ascending: false });

        if (params.ventureId) query = query.eq('venture_id', params.ventureId);
        if (params.serviceType) query = query.eq('service_type', params.serviceType);
        if (params.search) {
          query = query.or(`name.ilike.%${params.search}%,description.ilike.%${params.search}%`);
        }
        if (params.limit) query = query.limit(params.limit);
        if (params.offset) query = query.range(params.offset, params.offset + (params.limit || 50) - 1);

        const { data, error } = await query;
        if (error) return dbErrorResponse(error.message, 'list_services');
        return successResponse({ services: data, count: data.length });
      }

      case 'update_service': {
        if (!params.id) {
          return errorResponse('VALIDATION_ERROR', 'update_service requires id');
        }

        const record: Record<string, unknown> = {};
        if (params.name !== undefined) record.name = params.name;
        if (params.slug !== undefined) record.slug = params.slug;
        if (params.description !== undefined) record.description = params.description;
        if (params.serviceType !== undefined) record.service_type = params.serviceType;
        if (params.repositoryUrl !== undefined) record.repository_url = params.repositoryUrl;

        if (Object.keys(record).length === 0) {
          return errorResponse('VALIDATION_ERROR', 'No fields to update');
        }

        const { data, error } = await supabase
          .from('services')
          .update(record)
          .eq('id', params.id)
          .select()
          .single();

        if (error) return dbErrorResponse(error.message, 'update_service');
        mcpLogger.info({ serviceId: data.id }, 'Updated service');
        return successResponse({ service: data });
      }

      case 'delete_service': {
        if (!params.id) {
          return errorResponse('VALIDATION_ERROR', 'delete_service requires id');
        }

        const { error } = await supabase
          .from('services')
          .delete()
          .eq('id', params.id);

        if (error) return dbErrorResponse(error.message, 'delete_service');
        mcpLogger.info({ serviceId: params.id }, 'Deleted service');
        return successResponse({ deleted: true, id: params.id });
      }

      // ======================================================================
      // Deployment Operations
      // ======================================================================
      case 'create_deployment': {
        if (!params.serviceId || !params.environment || !params.provider) {
          return errorResponse('VALIDATION_ERROR', 'create_deployment requires serviceId, environment, and provider');
        }

        const record = {
          service_id: params.serviceId,
          environment: params.environment,
          provider: params.provider,
          provider_project_id: params.providerProjectId || null,
          provider_service_id: params.providerServiceId || null,
          url: params.url || null,
          urls: params.urls || [],
          version: params.version || null,
          config: params.config || {},
          health_check_url: params.healthCheckUrl || null,
          status: params.status || 'active',
          deployed_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from('deployments')
          .insert(record)
          .select()
          .single();

        if (error) return dbErrorResponse(error.message, 'create_deployment');
        mcpLogger.info({ deploymentId: data.id, serviceId: params.serviceId }, 'Created deployment');
        return successResponse({ deployment: data });
      }

      case 'list_deployments': {
        let query = supabase
          .from('deployments')
          .select('*')
          .order('deployed_at', { ascending: false });

        if (params.serviceId) query = query.eq('service_id', params.serviceId);
        if (params.environment) query = query.eq('environment', params.environment);
        if (params.provider) query = query.eq('provider', params.provider);
        if (params.status) query = query.eq('status', params.status);
        if (params.healthStatus) query = query.eq('health_status', params.healthStatus);
        if (params.limit) query = query.limit(params.limit);
        if (params.offset) query = query.range(params.offset, params.offset + (params.limit || 50) - 1);

        const { data, error } = await query;
        if (error) return dbErrorResponse(error.message, 'list_deployments');
        return successResponse({ deployments: data, count: data.length });
      }

      case 'update_deployment': {
        if (!params.id) {
          return errorResponse('VALIDATION_ERROR', 'update_deployment requires id');
        }

        const record: Record<string, unknown> = {};
        if (params.environment !== undefined) record.environment = params.environment;
        if (params.provider !== undefined) record.provider = params.provider;
        if (params.providerProjectId !== undefined) record.provider_project_id = params.providerProjectId;
        if (params.providerServiceId !== undefined) record.provider_service_id = params.providerServiceId;
        if (params.url !== undefined) record.url = params.url;
        if (params.urls !== undefined) record.urls = params.urls;
        if (params.version !== undefined) record.version = params.version;
        if (params.config !== undefined) record.config = params.config;
        if (params.healthCheckUrl !== undefined) record.health_check_url = params.healthCheckUrl;
        if (params.healthStatus !== undefined) {
          record.health_status = params.healthStatus;
          record.last_health_check = new Date().toISOString();
        }
        if (params.status !== undefined) record.status = params.status;

        if (Object.keys(record).length === 0) {
          return errorResponse('VALIDATION_ERROR', 'No fields to update');
        }

        const { data, error } = await supabase
          .from('deployments')
          .update(record)
          .eq('id', params.id)
          .select()
          .single();

        if (error) return dbErrorResponse(error.message, 'update_deployment');
        mcpLogger.info({ deploymentId: data.id }, 'Updated deployment');
        return successResponse({ deployment: data });
      }

      // ======================================================================
      // Interface Operations
      // ======================================================================
      case 'create_interface': {
        if (!params.serviceId || !params.name || !params.interfaceType) {
          return errorResponse('VALIDATION_ERROR', 'create_interface requires serviceId, name, and interfaceType');
        }

        const record = {
          service_id: params.serviceId,
          name: params.name,
          interface_type: params.interfaceType,
          description: params.description || null,
          mcp_schema: params.mcpSchema || null,
          http_method: params.httpMethod || null,
          http_path: params.httpPath || null,
          input_schema: params.inputSchema || null,
          output_schema: params.outputSchema || null,
          auth_required: params.authRequired || false,
          auth_type: params.authType || null,
          rate_limit: params.rateLimit || null,
          x402_price: params.x402Price || 0,
          config: params.config || {},
          tags: params.tags || [],
          status: params.status || 'active',
        };

        const { data, error } = await supabase
          .from('interfaces')
          .insert(record)
          .select()
          .single();

        if (error) return dbErrorResponse(error.message, 'create_interface');
        mcpLogger.info({ interfaceId: data.id, name: params.name }, 'Created interface');
        return successResponse({ interface: data });
      }

      case 'list_interfaces': {
        let query = supabase
          .from('interfaces')
          .select('*')
          .order('created_at', { ascending: false });

        if (params.serviceId) query = query.eq('service_id', params.serviceId);
        if (params.interfaceType) query = query.eq('interface_type', params.interfaceType);
        if (params.authType) query = query.eq('auth_type', params.authType);
        if (params.status) query = query.eq('status', params.status);
        if (params.search) {
          query = query.or(`name.ilike.%${params.search}%,description.ilike.%${params.search}%`);
        }
        if (params.limit) query = query.limit(params.limit);
        if (params.offset) query = query.range(params.offset, params.offset + (params.limit || 50) - 1);

        const { data, error } = await query;
        if (error) return dbErrorResponse(error.message, 'list_interfaces');
        return successResponse({ interfaces: data, count: data.length });
      }

      case 'update_interface': {
        if (!params.id) {
          return errorResponse('VALIDATION_ERROR', 'update_interface requires id');
        }

        const record: Record<string, unknown> = {};
        if (params.name !== undefined) record.name = params.name;
        if (params.interfaceType !== undefined) record.interface_type = params.interfaceType;
        if (params.description !== undefined) record.description = params.description;
        if (params.mcpSchema !== undefined) record.mcp_schema = params.mcpSchema;
        if (params.httpMethod !== undefined) record.http_method = params.httpMethod;
        if (params.httpPath !== undefined) record.http_path = params.httpPath;
        if (params.inputSchema !== undefined) record.input_schema = params.inputSchema;
        if (params.outputSchema !== undefined) record.output_schema = params.outputSchema;
        if (params.authRequired !== undefined) record.auth_required = params.authRequired;
        if (params.authType !== undefined) record.auth_type = params.authType;
        if (params.rateLimit !== undefined) record.rate_limit = params.rateLimit;
        if (params.x402Price !== undefined) record.x402_price = params.x402Price;
        if (params.config !== undefined) record.config = params.config;
        if (params.tags !== undefined) record.tags = params.tags;
        if (params.status !== undefined) record.status = params.status;

        if (Object.keys(record).length === 0) {
          return errorResponse('VALIDATION_ERROR', 'No fields to update');
        }

        const { data, error } = await supabase
          .from('interfaces')
          .update(record)
          .eq('id', params.id)
          .select()
          .single();

        if (error) return dbErrorResponse(error.message, 'update_interface');
        mcpLogger.info({ interfaceId: data.id }, 'Updated interface');
        return successResponse({ interface: data });
      }

      default:
        return errorResponse('VALIDATION_ERROR', `Unknown action: ${params.action}`);
    }

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    mcpLogger.error({ error: message }, 'service_registry failed');
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          data: null,
          meta: { ok: false, code: 'EXECUTION_ERROR', message }
        })
      }]
    };
  }
}

// ============================================================================
// Response Helpers
// ============================================================================

function successResponse(data: unknown) {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        data,
        meta: { ok: true }
      })
    }]
  };
}

function errorResponse(code: string, message: string) {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        data: null,
        meta: { ok: false, code, message }
      })
    }]
  };
}

function dbErrorResponse(message: string, action: string) {
  mcpLogger.error({ error: message, action }, 'service_registry database error');
  return errorResponse('DATABASE_ERROR', message);
}
