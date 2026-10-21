require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;

const hasSupabaseConfig = Boolean(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.SUPABASE_URL !== 'https://your-project.supabase.co'
);

const supabase = hasSupabaseConfig
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

const demoTelemetry = [
  {
    id: 'demo-1',
    device_id: 'SCT-013',
    water_level_cm: 66.8,
    pressure_kpa: 6.55,
    motor_current_a: 2.41,
    pump_on: true,
    received_at: new Date().toISOString(),
  },
];

async function saveTelemetryRecord(payload) {
  if (!supabase) {
    const reading = {
      id: `demo-${Date.now()}`,
      ...payload,
      received_at: new Date().toISOString(),
    };

    demoTelemetry.push(reading);
    if (demoTelemetry.length > 200) {
      demoTelemetry.shift();
    }

    return reading;
  }

  const { data, error } = await supabase
    .from('telemetry')
    .insert(payload)
    .select('id, device_id, water_level_cm, pressure_kpa, motor_current_a, pump_on, received_at')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function fetchLatestTelemetry(deviceId) {
  if (!supabase) {
    const matches = demoTelemetry.filter((record) => record.device_id === deviceId);
    return matches[matches.length - 1] || demoTelemetry[demoTelemetry.length - 1];
  }

  const { data, error } = await supabase
    .from('telemetry')
    .select('id, device_id, water_level_cm, pressure_kpa, motor_current_a, pump_on, received_at')
    .eq('device_id', deviceId)
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function fetchHistoryTelemetry(deviceId) {
  if (!supabase) {
    const matches = demoTelemetry.filter((record) => record.device_id === deviceId);
    return matches.slice(-100);
  }

  const { data, error } = await supabase
    .from('telemetry')
    .select('device_id, water_level_cm, pressure_kpa, motor_current_a, pump_on, received_at')
    .eq('device_id', deviceId)
    .order('received_at', { ascending: false })
    .limit(100);

  if (error) {
    throw error;
  }

  return (data || []).reverse();
}

const DEVICE_KEY = process.env.DEVICE_API_KEY || 'dev-device-key';

app.use(express.json({ limit: '10kb' }));

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:8000,http://127.0.0.1:8000')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('CORS blocked'));
  },
  methods: ['GET', 'POST'],
  credentials: true,
}));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'JalNetra Telemetry API' });
});

app.get('/', (req, res) => {
  res.json({
    service: 'JalNetra Telemetry API',
    ok: true,
    endpoints: [
      'GET /api/health',
      'POST /api/telemetry',
      'GET /api/telemetry/latest?device_id=SCT-013',
      'GET /api/telemetry/history?device_id=SCT-013',
    ],
  });
});

app.post('/api/telemetry', async (req, res) => {
  const deviceKey = req.get('x-device-key');

  if (!deviceKey || deviceKey !== DEVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized device' });
  }

  const body = req.body || {};
  const {
    device_id,
    water_level_cm,
    pressure_kpa,
    motor_current_a,
    pump_on,
  } = body;

  const validNumber = (val) => typeof val === 'number' && Number.isFinite(val);

  if (
    typeof device_id !== 'string' ||
    device_id.length < 1 ||
    device_id.length > 64 ||
    !validNumber(water_level_cm) ||
    !validNumber(pressure_kpa) ||
    !validNumber(motor_current_a) ||
    typeof pump_on !== 'boolean' ||
    water_level_cm < 0 ||
    pressure_kpa < 0 ||
    motor_current_a < 0
  ) {
    return res.status(400).json({ error: 'Invalid telemetry payload' });
  }

  try {
    const data = await saveTelemetryRecord({
      device_id,
      water_level_cm,
      pressure_kpa,
      motor_current_a,
      pump_on,
    });

    return res.status(201).json({ ok: true, reading: data });
  } catch (error) {
    console.error('Telemetry insert error:', error.message);
    return res.status(500).json({ error: 'Could not save telemetry' });
  }
});

app.get('/api/telemetry/latest', async (req, res) => {
  const deviceId = String(req.query.device_id || 'SCT-013');

  try {
    const data = await fetchLatestTelemetry(deviceId);

    if (!data) {
      return res.status(404).json({ error: 'No telemetry found for device' });
    }

    return res.json(data);
  } catch (error) {
    console.error('Telemetry read error:', error.message);
    return res.status(500).json({ error: 'Could not read telemetry' });
  }
});

app.get('/api/telemetry/history', async (req, res) => {
  const deviceId = String(req.query.device_id || 'SCT-013');

  try {
    const data = await fetchHistoryTelemetry(deviceId);
    res.json(data);
  } catch (error) {
    console.error('History read error:', error.message);
    return res.status(500).json({ error: 'Could not read history' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`JalNetra API listening on http://localhost:${PORT}`);
});
