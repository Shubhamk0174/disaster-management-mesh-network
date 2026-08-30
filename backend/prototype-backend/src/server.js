import express from 'express';
import { env } from './config/env.js';
import { supabase } from './config/db.js';

const app = express();

app.use(express.json({ limit: '1mb' }));


// ============================================================
// POST /api/rescue-alert
// Receives the simple ESP32 payload
// ============================================================

app.post('/api/rescue-alert', async (req, res) => {

  const payload = req.body;

  console.log();
  console.log('==================================================');
  console.log('[BACKEND] RESCUE ALERT RECEIVED');
  console.log('==================================================');

  console.log(
    '[BACKEND] Payload:',
    JSON.stringify(payload)
  );


  // ----------------------------------------------------------
  // Validate payload
  // ----------------------------------------------------------

  if (
    !payload ||
    !payload.node ||
    !payload.message ||
    !payload.location
  ) {

    console.log(
      '[REJECTED] Malformed payload:',
      JSON.stringify(payload)
    );

    return res.status(400).json({
      status: 'error',
      message: 'Missing node, message, or location'
    });
  }


  // ----------------------------------------------------------
  // Create database record
  // ----------------------------------------------------------

  const record = {

    // No message_id in the simple ESP32 payload
    message_id: null,

    origin_node_id:
      payload.node,

    timestamp_ms:
      null,

    path:
      [payload.node],

    location:
      payload.location,

    address:
      payload.address || null,

    message:
      payload.message,

    received_at_rescue_node:
      null,

    received_at_server:
      new Date().toISOString()
  };


  console.log(
    '[BACKEND] Database record:',
    JSON.stringify(record)
  );


  // ----------------------------------------------------------
  // Insert into Supabase
  // ----------------------------------------------------------

  const {
    data,
    error
  } = await supabase
    .from('rescue_alerts')
    .insert(record)
    .select('id')
    .single();


  if (error) {

    console.error(
      '[DB ERROR]',
      error
    );

    return res.status(500).json({
      status: 'error',
      message: 'Failed to save alert',
      error: error.message
    });
  }


  // ----------------------------------------------------------
  // SUCCESS
  // ----------------------------------------------------------

  console.log('--------------------------------------------------');

  console.log(
    '[ALERT SAVED] ID:',
    data.id
  );

  console.log(
    'Origin node:',
    record.origin_node_id
  );

  console.log(
    'Location:',
    JSON.stringify(record.location)
  );

  console.log(
    'Address:',
    record.address
  );

  console.log(
    'Message:',
    record.message
  );

  console.log('--------------------------------------------------');


  const response = {

    status: 'ok',

    stored: true,

    alert_id: data.id
  };


  console.log(
    '[ALERT RESPONSE]',
    JSON.stringify(response)
  );


  return res
    .status(200)
    .json(response);
});


// ============================================================
// GET /api/rescue-alert
// List alerts
// ============================================================

app.get('/api/rescue-alert', async (_req, res) => {

  const {
    data,
    error
  } = await supabase
    .from('rescue_alerts')
    .select('*')
    .order(
      'received_at_server',
      {
        ascending: false
      }
    );


  if (error) {

    return res.status(500).json({
      status: 'error',
      message: error.message
    });
  }


  return res.status(200).json({
    count: data.length,
    alerts: data
  });
});


// ============================================================
// GET /api/rescue-alert/:id
// Get one alert
// ============================================================

app.get(
  '/api/rescue-alert/:id',
  async (req, res) => {

    const {
      data,
      error
    } = await supabase
      .from('rescue_alerts')
      .select('*')
      .eq(
        'id',
        req.params.id
      )
      .single();


    if (error || !data) {

      return res.status(404).json({
        status: 'error',
        message: 'Alert not found'
      });
    }


    return res.status(200).json(data);
  }
);


// ============================================================
// HEALTH
// ============================================================

app.get('/health', (_req, res) => {

  res.status(200).json({
    status: 'ok',
    uptime_seconds: process.uptime()
  });
});


// ============================================================
// START SERVER
// ============================================================

app.listen(
  env.PORT,
  () => {

    console.log(
      `Rescue alert backend listening on port ${env.PORT}`
    );

    console.log(
      `POST alerts to /api/rescue-alert`
    );
  }
);