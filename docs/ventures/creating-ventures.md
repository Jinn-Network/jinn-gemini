# Creating Ventures

This guide covers how to create and configure ventures in the Jinn platform.

## Prerequisites

- Valid Ethereum address for ownership
- Blueprint defining your venture's invariants
- Understanding of your service architecture

## Blueprint Design

A blueprint defines the success criteria (invariants) for your venture:

```json
{
  "invariants": [
    {
      "id": "inv-availability",
      "name": "Service Availability",
      "description": "All production services maintain 99.9% uptime",
      "type": "availability",
      "threshold": 0.999
    },
    {
      "id": "inv-latency",
      "name": "Response Time",
      "description": "API latency under 200ms p95",
      "type": "performance",
      "threshold": 200
    },
    {
      "id": "inv-security",
      "name": "Security Compliance",
      "description": "All endpoints require authentication",
      "type": "security"
    }
  ]
}
```

### Invariant Types

| Type | Description |
|------|-------------|
| `availability` | Uptime and reliability metrics |
| `performance` | Latency, throughput, resource usage |
| `security` | Authentication, authorization, encryption |
| `quality` | Code coverage, documentation, standards |
| `cost` | Budget constraints, resource limits |

## Creating via CLI

### Basic Creation

```bash
yarn tsx scripts/ventures/mint.ts \
  --name "My Venture" \
  --ownerAddress "0x1234567890abcdef1234567890abcdef12345678" \
  --blueprint '{"invariants": []}'
```

### Full Options

```bash
yarn tsx scripts/ventures/mint.ts \
  --name "Production Platform" \
  --slug "prod-platform" \
  --description "Enterprise production platform" \
  --ownerAddress "0x1234567890abcdef1234567890abcdef12345678" \
  --blueprint '{"invariants": [...]}' \
  --tags "enterprise,production" \
  --featured true \
  --status "active"
```

## Creating via MCP Tool

```json
{
  "tool": "venture_mint",
  "params": {
    "name": "My Venture",
    "slug": "my-venture",
    "description": "Description of the venture",
    "ownerAddress": "0x1234567890abcdef1234567890abcdef12345678",
    "blueprint": "{\"invariants\": [...]}",
    "tags": ["tag1", "tag2"],
    "featured": false,
    "status": "active"
  }
}
```

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `name` | Yes | Venture display name |
| `ownerAddress` | Yes | Ethereum address (0x...) |
| `blueprint` | Yes | JSON string with invariants array |
| `slug` | No | URL-friendly identifier (auto-generated) |
| `description` | No | Long description |
| `rootWorkstreamId` | No | Associated workstream UUID |
| `jobTemplateId` | No | x402 job template UUID |
| `config` | No | Additional configuration object |
| `tags` | No | Array of discovery tags |
| `featured` | No | Whether to feature (default: false) |
| `status` | No | active, paused, archived (default: active) |

## Post-Creation Steps

After creating a venture:

1. **Register Services**
   ```json
   {
     "tool": "service_registry",
     "params": {
       "action": "create_service",
       "ventureId": "<venture-uuid>",
       "name": "API Service",
       "serviceType": "api"
     }
   }
   ```

2. **Add Deployments**
   ```json
   {
     "tool": "service_registry",
     "params": {
       "action": "create_deployment",
       "serviceId": "<service-uuid>",
       "environment": "production",
       "provider": "railway"
     }
   }
   ```

3. **Register Interfaces**
   ```json
   {
     "tool": "service_registry",
     "params": {
       "action": "create_interface",
       "serviceId": "<service-uuid>",
       "name": "get_users",
       "interfaceType": "rest_endpoint"
     }
   }
   ```

## Updating Ventures

```bash
yarn tsx scripts/ventures/update.ts \
  --id "<venture-uuid>" \
  --status "paused" \
  --description "Updated description"
```

Or via MCP:

```json
{
  "tool": "venture_update",
  "params": {
    "id": "<venture-uuid>",
    "status": "paused"
  }
}
```

## Best Practices

1. **Define Clear Invariants**: Be specific about success criteria
2. **Use Meaningful Tags**: Enable discovery across the platform
3. **Document Services**: Add descriptions and documentation
4. **Monitor Health**: Track deployment health status
5. **Version Services**: Use semantic versioning
