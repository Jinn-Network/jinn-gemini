export interface ProxyConfig {
  port: number;
  bearerToken: string;
  upstreamUrls: string[];
  healthCheckIntervalMs: number;
  requestTimeoutMs: number;
}

export function loadConfig(): ProxyConfig {
  const token = process.env.RPC_PROXY_BEARER_TOKEN;
  if (!token) throw new Error('RPC_PROXY_BEARER_TOKEN is required');

  const raw = process.env.RPC_UPSTREAM_URLS || '';
  const upstreamUrls = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (upstreamUrls.length === 0) {
    throw new Error('RPC_UPSTREAM_URLS must contain at least one URL');
  }

  return {
    port: parseInt(process.env.PORT || '3000', 10),
    bearerToken: token,
    upstreamUrls,
    healthCheckIntervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '30000', 10),
    requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '10000', 10),
  };
}
