
/*
  ============================================================================
  RESCUE ALERT BACKEND - single file Express server
  ============================================================================
  Catches the JSON the rescue node POSTs to /api/rescue-alert, logs it,
  stores it in memory, and returns a confirmation.

  RUN IT:
    npm init -y
    npm install express
    node server.js

  Server listens on port 3000 by default (change PORT below or via env var).

  In rescue_node.ino set:
    BACKEND_URL = "http://<this-machine's-LAN-IP>:3000/api/rescue-alert";
  (the rescue node ESP32 must be able to reach this machine over the network
  it's connected to via HOME_WIFI_SSID - so run this server on a laptop/PC
  or cloud host that's reachable from that same WiFi, or deploy it and use
  its public URL instead.)
  ============================================================================
*/

import express from 'express';

const app = express();
const PORT = 5500;

// Parse JSON bodies (the rescue node sends Content-Type: application/json)
app.use(express.json({ limit: '1mb' }));

// In-memory store of every alert received - fine for a prototype,
// swap for a real database (Mongo/Postgres/etc.) later.
const alerts = [];

// ---------------------------------------------------------------------------
// Main endpoint the rescue node calls
// ---------------------------------------------------------------------------
app.post('/api/rescue-alert', (req, res) => {
  const payload = req.body;

  // Basic shape validation - matches the JSON structure built by the nodes
  const header = payload && payload.header;
  const body = payload && payload.body;

  if (!header || !body) {
    console.log('[REJECTED] Malformed payload:', JSON.stringify(payload));
    return res.status(400).json({ status: 'error', message: 'Missing header or body' });
  }

  const record = {
    received_at_server: new Date().toISOString(),
    origin_node_id: header.origin_node_id || null,
    message_id: header.message_id || null,
    timestamp_ms: header.timestamp_ms ?? null,
    path: header.path || [],
    received_at_rescue_node: header.received_at_rescue_node || null,
    location: body.location || null,
    address: body.address || null,
    message: body.message || null,
  };

  alerts.push(record);

  console.log('--------------------------------------------------');
  console.log('[ALERT RECEIVED]');
  console.log(`  Origin node:   ${record.origin_node_id}`);
  console.log(`  Message ID:    ${record.message_id}`);
  console.log(`  Path:          ${record.path.join(' -> ')}`);
  console.log(`  Location:      ${JSON.stringify(record.location)}`);
  console.log(`  Address:       ${record.address}`);
  console.log(`  Message:       ${record.message}`);
  console.log(`  Rescue-node time: ${record.received_at_rescue_node}`);
  console.log('--------------------------------------------------');

  res.status(200).json({ status: 'ok', stored: true, alert_id: alerts.length - 1 });
});

// ---------------------------------------------------------------------------
// Helper endpoints for the prototype - not required by the ESP32 code,
// but handy for checking what's arrived without digging through logs.
// ---------------------------------------------------------------------------

// List every alert received so far
app.get('/api/rescue-alert', (req, res) => {
  res.status(200).json({ count: alerts.length, alerts });
});

// Fetch a single alert by its index
app.get('/api/rescue-alert/:id', (req, res) => {
  const alert = alerts[req.params.id];
  if (!alert) {
    return res.status(404).json({ status: 'error', message: 'Alert not found' });
  }
  res.status(200).json(alert);
});

// Simple health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime_seconds: process.uptime() });
});

app.listen(PORT, () => {
  console.log(`Rescue alert backend listening on port ${PORT}`);
  console.log(`POST alerts to: http://<this-machine-ip>:${PORT}/api/rescue-alert`);
});
