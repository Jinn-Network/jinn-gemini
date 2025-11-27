# Real-time SSE Server Setup

This directory contains a real-time Server-Sent Events (SSE) server that broadcasts Ponder database changes to connected clients.

## Architecture

```
PostgreSQL Triggers → LISTEN/NOTIFY → SSE Server → Frontend Clients
```

## Setup

### 1. Apply Database Triggers

Connect to your PostgreSQL database and run the migration:

```bash
psql $PONDER_DATABASE_URL -f migrations/add_realtime_triggers.sql
```

### 2. Start the Realtime Server

The server runs alongside Ponder. You can start them together:

```bash
# Development (from repo root)
yarn ponder:dev  # Starts Ponder on port 42069
tsx ponder/realtime-server.ts  # Starts SSE server on port 42070

# Or use concurrently
concurrently "yarn ponder:dev" "tsx ponder/realtime-server.ts" --names "ponder,realtime"
```

### 3. Environment Variables

The realtime server requires:

- `PONDER_DATABASE_URL` or `DATABASE_URL` - PostgreSQL connection string
- `REALTIME_PORT` (optional, default: 42070) - Port for SSE server
- `REALTIME_CORS_ORIGIN` (optional, default: *) - CORS origin

## Testing Locally

### Test SSE Connection

```bash
curl -N http://localhost:42070/events
```

You should see:
```
event: connected
data: {"message":"SSE connection established","timestamp":"..."}

: heartbeat
```

### Test Trigger a Change

Insert a test record to trigger notifications:

```sql
-- This will trigger a notification
INSERT INTO "request" (id, "mech", "sender", "ipfsHash", "blockNumber", "blockTimestamp")
VALUES ('test-request-id', '0x...', '0x...', 'QmTest', 123, 1234567890);
```

### Health Check

```bash
curl http://localhost:42070/health
```

Response:
```json
{
  "status": "ok",
  "clients": 2,
  "timestamp": "2024-11-27T..."
}
```

## Railway Deployment

The `railway.json` file configures Railway to:
1. Run Ponder GraphQL server on port 42069
2. Run SSE realtime server on port 42070

Both services share the same `PONDER_DATABASE_URL` environment variable.

### Required Railway Environment Variables

- `PONDER_DATABASE_URL` - PostgreSQL connection string
- `MECH_ADDRESS` - Mech contract address
- `RPC_URL` or `BASE_RPC_URL` - Base network RPC endpoint

## Frontend Integration

The frontend automatically connects to the SSE server using:

```typescript
import { useRealtimeData } from '@/hooks/use-realtime-data'

function MyComponent() {
  const { status, subscribe } = useRealtimeData()
  
  useEffect(() => {
    const unsubscribe = subscribe('request:updated', (data) => {
      console.log('Request updated:', data)
      // Refetch data
    })
    return unsubscribe
  }, [subscribe])
}
```

## Event Types

The SSE server broadcasts these event types:

- `request:created` - New marketplace request
- `request:updated` - Request status changed
- `artifact:created` - New artifact uploaded
- `delivery:created` - Job delivered
- `jobDefinition:created` - New job definition
- `jobDefinition:updated` - Job definition updated

## Troubleshooting

### No events received

1. Check if triggers are installed:
   ```sql
   SELECT tgname FROM pg_trigger WHERE tgname LIKE '%_changes_trigger';
   ```

2. Check PostgreSQL connection in realtime server logs

3. Verify PONDER_DATABASE_URL is correct

### Connection drops frequently

The server sends heartbeat messages every 30 seconds to keep connections alive. If you're behind a proxy or load balancer, ensure it doesn't timeout SSE connections.

### CORS errors

Set `REALTIME_CORS_ORIGIN` to your frontend domain:
```bash
REALTIME_CORS_ORIGIN=https://yourdomain.com
```

