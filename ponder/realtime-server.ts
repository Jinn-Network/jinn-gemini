import express from 'express';
import { Pool } from 'pg';
import cors from 'cors';

const app = express();
const port = parseInt(process.env.REALTIME_PORT || '42070', 10);

// CORS configuration
app.use(cors({
  origin: process.env.REALTIME_CORS_ORIGIN || '*',
  credentials: true
}));

// Database connection pool
const pool = new Pool({
  connectionString: process.env.PONDER_DATABASE_URL || process.env.DATABASE_URL
});

// Active SSE connections
const clients = new Set<express.Response>();

// Helper to send SSE message
function sendEvent(res: express.Response, event: string, data: any) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Broadcast event to all connected clients
function broadcast(event: string, data: any) {
  console.log(`[SSE] Broadcasting ${event}:`, data);
  clients.forEach(client => {
    try {
      sendEvent(client, event, data);
    } catch (error) {
      console.error('[SSE] Error sending to client:', error);
      clients.delete(client);
    }
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    clients: clients.size,
    timestamp: new Date().toISOString()
  });
});

// SSE endpoint
app.get('/events', (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  
  // Add client to active connections
  clients.add(res);
  console.log(`[SSE] Client connected. Total clients: ${clients.size}`);
  
  // Send initial connection message
  sendEvent(res, 'connected', {
    message: 'SSE connection established',
    timestamp: new Date().toISOString()
  });
  
  // Send heartbeat every 30 seconds to keep connection alive
  const heartbeatInterval = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (error) {
      console.error('[SSE] Heartbeat error:', error);
      clearInterval(heartbeatInterval);
      clients.delete(res);
    }
  }, 30000);
  
  // Cleanup on client disconnect
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    clients.delete(res);
    console.log(`[SSE] Client disconnected. Total clients: ${clients.size}`);
  });
});

// Start PostgreSQL LISTEN/NOTIFY listener
async function startDatabaseListener() {
  try {
    const client = await pool.connect();
    console.log('[DB] Connected to PostgreSQL for LISTEN/NOTIFY');
    
    // Listen to all change channels
    await client.query('LISTEN request_changes');
    await client.query('LISTEN artifact_changes');
    await client.query('LISTEN delivery_changes');
    await client.query('LISTEN job_definition_changes');
    
    console.log('[DB] Listening to: request_changes, artifact_changes, delivery_changes, job_definition_changes');
    
    // Handle notifications
    client.on('notification', (msg) => {
      const channel = msg.channel;
      let payload: any;
      
      try {
        payload = msg.payload ? JSON.parse(msg.payload) : {};
      } catch (error) {
        console.error('[DB] Error parsing notification payload:', error);
        payload = { raw: msg.payload };
      }
      
      console.log(`[DB] Notification from ${channel}:`, payload);
      
      // Map database channels to SSE events
      let event: string;
      switch (channel) {
        case 'request_changes':
          event = payload.operation === 'INSERT' ? 'request:created' : 'request:updated';
          break;
        case 'artifact_changes':
          event = 'artifact:created';
          break;
        case 'delivery_changes':
          event = 'delivery:created';
          break;
        case 'job_definition_changes':
          event = payload.operation === 'INSERT' ? 'jobDefinition:created' : 'jobDefinition:updated';
          break;
        default:
          event = 'unknown';
      }
      
      // Broadcast to all SSE clients
      broadcast(event, {
        ...payload,
        timestamp: new Date().toISOString()
      });
    });
    
    // Handle connection errors
    client.on('error', (err) => {
      console.error('[DB] PostgreSQL client error:', err);
      // Try to reconnect
      setTimeout(() => {
        console.log('[DB] Attempting to reconnect...');
        startDatabaseListener();
      }, 5000);
    });
    
  } catch (error) {
    console.error('[DB] Error connecting to PostgreSQL:', error);
    // Retry connection
    setTimeout(() => {
      console.log('[DB] Retrying database connection...');
      startDatabaseListener();
    }, 5000);
  }
}

// Start server
app.listen(port, () => {
  console.log(`[SSE Server] Listening on port ${port}`);
  console.log(`[SSE Server] Health check: http://localhost:${port}/health`);
  console.log(`[SSE Server] Events stream: http://localhost:${port}/events`);
  
  // Start database listener
  startDatabaseListener();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SSE Server] SIGTERM received, closing server...');
  // Close all SSE connections
  clients.forEach(client => {
    try {
      client.end();
    } catch (error) {
      // Ignore errors during shutdown
    }
  });
  clients.clear();
  
  // Close database pool
  pool.end(() => {
    console.log('[SSE Server] Database pool closed');
    process.exit(0);
  });
});

