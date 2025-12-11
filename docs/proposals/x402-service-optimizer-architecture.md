# x402 Service Optimizer – MVP Architecture

**Scope:** Hackathon MVP  
**Date:** December 2024

---

## Overview

An x402-protected service that analyzes x402 endpoints and produces optimization reports.

- **Input:** Single endpoint URL
- **Output:** Optimization report (competitive positioning, pricing analysis, recommendations)
- **Framework:** Hono + x402-hono middleware
- **Deployment:** Railway
- **Build approach:** Service built using Jinn workstream (dogfooding)

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  USER                                                            │
│  • Submits endpoint URL                                          │
│  • Pays via x402                                                 │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  OPTIMIZER SERVICE (Hono on Railway)                             │
│                                                                  │
│  POST /analyze     → Validate, dispatch to OLAS, return jobId    │
│  GET /status/:id   → Query Ponder, return status + report URL    │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  JINN INFRASTRUCTURE (Existing)                                  │
│                                                                  │
│  MechMarketplace → Ponder → Worker → Agent → Delivery            │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  OUTPUT                                                          │
│                                                                  │
│  optimization-report.md (IPFS artifact)                          │
└──────────────────────────────────────────────────────────────────┘
```

---

## API

```typescript
// POST /analyze
{ endpointUrl: string }
→ { jobId: string, statusUrl: string }

// GET /status/:jobId
→ { status: 'pending' | 'in_progress' | 'completed' | 'failed', reportUrl?: string }
```

---

## Optimizer Service

**Scaffold:**
```bash
npx create-x402
# Select: Hono — x402-hono middleware
```

**Structure:**
```
services/x402-optimizer/
├── src/
│   ├── index.ts              # Hono app + x402 middleware
│   ├── routes/
│   │   ├── analyze.ts        # POST /analyze
│   │   └── status.ts         # GET /status/:jobId
│   └── lib/
│       ├── dispatch.ts       # Job dispatch to OLAS
│       └── ponder.ts         # Query job status
├── package.json
├── railway.json
└── .env
```

**x402 Middleware:**
```typescript
import { Hono } from 'hono';
import { paymentMiddleware } from 'x402-hono';

const app = new Hono();

app.use('/analyze', paymentMiddleware(
  process.env.PAYMENT_WALLET_ADDRESS,
  process.env.ANALYSIS_PRICE || '$0.50',
  { network: process.env.NETWORK || 'base-sepolia' }
));

app.post('/analyze', async (c) => {
  const { endpointUrl } = await c.req.json();
  const jobId = await dispatchAnalysisJob(endpointUrl);
  return c.json({ jobId, statusUrl: `/status/${jobId}` });
});
```

**Job Dispatch:**
```typescript
import { MechClient } from '@jinn/mech-client-ts';

export async function dispatchAnalysisJob(endpointUrl: string): Promise<string> {
  const client = new MechClient({
    rpcUrl: process.env.RPC_URL,
    mechAddress: process.env.MECH_ADDRESS,
    privateKey: process.env.PRIVATE_KEY,
  });

  return client.postRequest({
    prompt: `Analyze x402 service at ${endpointUrl} and produce optimization report`,
    additionalContext: {
      blueprint: analysisBlueprint,
      endpointUrl,
      networkId: 'jinn',
    },
    model: 'gemini-2.5-flash',
    enabledTools: ['web_fetch', 'google_web_search'],
  });
}
```

---

## Analysis Blueprint

```json
{
  "assertions": [
    {
      "id": "DISCOVER-001",
      "assertion": "Discover service capabilities from endpoint URL alone",
      "examples": {
        "do": ["Probe /.well-known/x402", "Trigger 402 to get pricing", "Infer from responses"],
        "dont": ["Require OpenAPI spec", "Fail if no spec found"]
      },
      "commentary": "User only provides URL; Jinn discovers everything"
    },
    {
      "id": "ECO-001",
      "assertion": "Research at least 10 x402 services in ecosystem",
      "examples": {
        "do": ["Query x402 Bazaar", "Search GitHub", "Check x402 docs"],
        "dont": ["Assume ecosystem empty"]
      },
      "commentary": "Need ecosystem context for meaningful comparison"
    },
    {
      "id": "TEST-001",
      "assertion": "Perform live testing of the endpoint",
      "examples": {
        "do": ["Test responses", "Measure latency", "Verify 402 flow"],
        "dont": ["Skip testing", "Excessive requests"]
      },
      "commentary": "Live testing provides ground truth"
    },
    {
      "id": "POS-001",
      "assertion": "Compare against at least 3 similar services",
      "examples": {
        "do": ["Compare pricing", "Note feature differences"],
        "dont": ["Compare unrelated services"]
      },
      "commentary": "Recommendations need comparative context"
    },
    {
      "id": "REC-001",
      "assertion": "Include at least 3 actionable recommendations",
      "examples": {
        "do": ["Specific pricing adjustments", "Concrete feature suggestions"],
        "dont": ["Vague advice"]
      },
      "commentary": "Value = actionable insights"
    }
  ]
}
```

---

## Workstream Decomposition

```
ROOT: x402 Service Analysis
├── CHILD 1: Ecosystem Research
│   └── Output: ecosystem.json (list of x402 services, pricing, features)
├── CHILD 2: Service Discovery
│   └── Output: service.json (discovered capabilities, pricing, test results)
├── CHILD 3: Competitive Positioning
│   └── Output: position.json (comparison, feature matrix)
└── SYNTHESIS: Report Generation
    └── Output: optimization-report.md
```

---

## Environment Variables

```bash
# x402
PAYMENT_WALLET_ADDRESS=0x...
ANALYSIS_PRICE=$0.50
NETWORK=base-sepolia

# Jinn
PONDER_GRAPHQL_URL=https://jinn-gemini-production.up.railway.app/graphql
RPC_URL=https://...
MECH_ADDRESS=0x...
PRIVATE_KEY=0x...

# Server
PORT=3000
```

---

## Railway Deployment

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": { "builder": "NIXPACKS" },
  "deploy": {
    "startCommand": "yarn start",
    "healthcheckPath": "/health"
  }
}
```

```bash
railway login && railway init && railway up
```

---

## Build via Jinn Workstream

The optimizer service is built using Jinn (dogfooding).

**Blueprint assertions:**
- SCAFFOLD-001: Use `npx create-x402` Hono template
- API-001: POST /analyze accepting `{ endpointUrl }`
- DISPATCH-001: Dispatch to OLAS via mech-client-ts
- STATUS-001: GET /status/:jobId querying Ponder
- DEPLOY-001: Configure for Railway

---

## Timeline

| Phase | Duration |
|-------|----------|
| Blueprint + workstream setup | 1 day |
| Service build (via Jinn) | 2-3 days |
| OLAS integration | 2 days |
| Analysis blueprint testing | 2 days |
| End-to-end testing | 2 days |
| Demo | 1 day |

**Total: ~10-11 days**

---

## Success Criteria

- [ ] x402 payment works (testnet → mainnet)
- [ ] Job dispatches to OLAS
- [ ] Analysis workstream produces report
- [ ] Status endpoint reflects job state
- [ ] At least 3 real analyses completed
- [ ] Demo video ready

---

## Open Questions

1. Pricing: $0.50 per analysis?
2. Timeout handling for long analyses?
3. Error handling for unreachable endpoints?
4. Landing page or API-only?

---

## Future (Not MVP)

- PR generation for open source repos
- Continuous monitoring / weekly re-analysis
- Custom analysis parameters

See `x402-service-factory-proposal.md` for longer-term vision.
