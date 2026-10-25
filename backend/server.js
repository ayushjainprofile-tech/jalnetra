const path = require('path');
// Load .env from project root or backend folder
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;

// --- Gemini AI Configuration ---
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-3.8-flash').trim();

const JALNETRA_SYSTEM_PROMPT = `You are JalNetra AI, an expert Hydrogeologist and SCADA Digital Twin Copilot embedded in the JalNetra Aquifer Management System.
JalNetra monitors borewells and unconfined/confined aquifers in real time using multi-sensor IoT telemetry:
- Hydrostatic Head: Measured via a submerged dip-tube MPS20N0040D pressure sensor. Stevin's law: P = rho * g * h (Pa), where rho = 1000 kg/m^3, g = 9.806 m/s^2.
- Motor Current: Measured via an SCT-013 split-core AC current clamp on the pump power cable. Motor idle: ~0.02 A, Motor active: ~2.45 A.
- Wellhead Tamper Guard: HC-SR04 ultrasonic distance sensor measuring acoustic gap to water. Normal gap is 150-180 cm. If the lid is tampered/opened, acoustic reflection is lost or distance jumps to >250 cm (out of range), triggering a THEFT BREACH alarm.
- Kinetic Derivatives: dh/dt is the rate of water table change in cm/h.
  * Negative dh/dt when pump is OFF indicates external over-extraction from neighboring borewells or severe regional aquifer stress.
  * Negative dh/dt when pump is ON indicates induced mechanical drawdown.
  * Positive dh/dt indicates natural infiltration recharge or post-pumping aquifer recovery.
- Safety Thresholds: Critical dry-run threshold is HC = 10 cm. Pump automatically trips at < 8 cm to prevent mechanical seal burnout and cavitation.
- Subsurface Geological Strata:
  * 0.0 to -0.8m: Organic Topsoil
  * -0.8 to -5.5m: Dense Clay / Silt Aquitard
  * -5.5 to -9.2m: Coarse Sand Saturated Aquifer Zone
  * -9.2 to -10.2m: Impermeable Bedrock Aquiclude

Formatting guidelines:
- Provide clear, authoritative, concise hydrogeological assessments.
- Use markdown formatting with bullet points and bold highlights.
- Categorize diagnostics into: 1) Status & Trend, 2) Hydrogeological Dynamics, 3) Equipment & Security, 4) Recommended Action.`;

function generateDeterministicAnalysis(prompt = '', telemetry = {}) {
  const wl = Number(telemetry.water_level_cm ?? 68);
  const pump = Boolean(telemetry.pump_on);
  const tamper = Boolean(telemetry.tamper);
  const dhdt = Number(telemetry.dhdt ?? 0);
  const current = Number(telemetry.motor_current_a ?? (pump ? 2.45 : 0.02));

  let statusBadge = '🟢 OPTIMAL';
  let dynamicSummary = 'Aquifer is currently in static equilibrium with stable recharge-discharge parity.';
  let pumpSummary = pump ? 'Pump motor running within nominal range (2.45 A).' : 'Pump is currently IDLE.';

  if (tamper) {
    statusBadge = '🔴 CRITICAL SECURITY BREACH';
  } else if (wl <= 12) {
    statusBadge = '🔴 CRITICAL DRY-RUN IMMINENT';
    dynamicSummary = `Water column is at ${wl.toFixed(1)} cm, approaching dry-run cutoff threshold (8 cm).`;
  } else if (!pump && dhdt < -0.05) {
    statusBadge = '🟡 EXTERNAL AQUIFER STRESS';
    dynamicSummary = `Subsurface drawdown rate of ${dhdt.toFixed(2)} cm/h while local pump is OFF confirms external over-extraction by neighboring borewells.`;
  } else if (pump && dhdt < -0.05) {
    dynamicSummary = `Mechanical drawdown occurring at ${Math.abs(dhdt).toFixed(2)} cm/h in coarse sand aquifer.`;
  }

  const notice = GEMINI_API_KEY
    ? ''
    : '\n\n> ℹ️ *Offline Physics Engine — To enable live Google Gemini 1.5/2.5 AI, add your `GEMINI_API_KEY` in `backend/.env`.*';

  return `### 🌊 JalNetra Hydrogeological Assessment
**System Health:** ${statusBadge}

- **Aquifer Dynamics:** ${dynamicSummary}
- **Hydrostatic State:** Water level is **${wl.toFixed(1)} cm** ($P \\approx ${(wl * 98.06).toFixed(0)} \\text{ Pa}$).
- **Motor & Wellhead:** ${pumpSummary} SCT-013 current: **${current.toFixed(2)} A**. Wellhead lid: ${tamper ? '**BREACHED (Ultrasonic beam lost)**' : '**SEALED & SECURE**'}.
- **Recommendations:**
  * ${wl < 20 ? 'Suspend pumping cycles immediately to permit piezometric recovery.' : 'Sustain regulated extraction intervals conforming to sand layer transmissivity.'}
  * ${dhdt < -0.05 && !pump ? 'Coordinate with local watershed authorities regarding neighboring over-extraction.' : 'Monitor percolation pit infiltration following rain events.'}${notice}`;
}

async function queryGemini({ systemPrompt = JALNETRA_SYSTEM_PROMPT, prompt, history = [], telemetry = {} }) {
  if (!GEMINI_API_KEY) {
    return {
      source: 'offline-rule-engine',
      model: 'deterministic-physics',
      text: generateDeterministicAnalysis(prompt, telemetry),
    };
  }

  const contents = [];
  if (Array.isArray(history)) {
    for (const item of history) {
      if (item && item.content) {
        contents.push({
          role: item.role === 'user' ? 'user' : 'model',
          parts: [{ text: String(item.content) }],
        });
      }
    }
  }

  contents.push({
    role: 'user',
    parts: [{ text: prompt }],
  });

  const candidateModels = Array.from(new Set([
    GEMINI_MODEL,
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-flash-latest',
  ]));

  let lastError = null;
  for (const model of candidateModels) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents,
          generationConfig: {
            temperature: 0.35,
            maxOutputTokens: 1024,
          },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.warn(`Gemini model ${model} HTTP ${response.status}:`, errorBody);
        lastError = new Error(`HTTP ${response.status}: ${errorBody}`);
        continue;
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        return {
          source: 'gemini',
          model,
          text,
        };
      }
    } catch (err) {
      console.warn(`Gemini model ${model} failed:`, err.message);
      lastError = err;
    }
  }

  throw lastError || new Error('All Gemini candidate models failed.');
}

// --- Supabase / In-Memory Storage ---
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
    water_level_cm: 68.0,
    pressure_kpa: 6.668,
    motor_current_a: 0.02,
    pump_on: false,
    tamper: false,
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

app.use(express.json({ limit: '20kb' }));

// CORS configuration supporting local dev environments
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:8000,http://127.0.0.1:8000')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    // Allow any localhost/127.0.0.1 port for local dev
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error('CORS blocked'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
}));

// --- Routes ---

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'JalNetra Telemetry & AI API',
    ai_configured: Boolean(GEMINI_API_KEY),
    model: GEMINI_MODEL,
    time: new Date().toISOString(),
  });
});

// Serve static frontend assets (index.html, scada.html, media, etc.)
app.use(express.static(path.join(__dirname, '..')));

app.get('/api', (req, res) => {
  res.json({
    service: 'JalNetra Telemetry & Gemini AI API',
    ok: true,
    endpoints: [
      'GET  /api/health',
      'GET  /api/ai/status',
      'POST /api/ai/diagnose',
      'POST /api/ai/chat',
      'POST /api/telemetry',
      'GET  /api/telemetry/latest?device_id=SCT-013',
      'GET  /api/telemetry/history?device_id=SCT-013',
    ],
  });
});

// Gemini AI Status
app.get('/api/ai/status', (req, res) => {
  res.json({
    ok: true,
    configured: Boolean(GEMINI_API_KEY),
    model: GEMINI_MODEL,
  });
});

// Gemini AI Hydrogeological Diagnosis
app.post('/api/ai/diagnose', async (req, res) => {
  try {
    const telemetry = req.body?.telemetry || (await fetchLatestTelemetry('SCT-013')) || {};
    const {
      water_level_cm = 68,
      pressure_kpa = 6.668,
      motor_current_a = 0.02,
      pump_on = false,
      tamper = false,
      dhdt = 0,
      dry = 'stable',
      inf = 'Static Equilibrium',
      rain = 0,
      rec = 0,
    } = telemetry;

    const prompt = `Conduct a real-time hydrogeological and SCADA diagnostic on this live wellhead snapshot:
- Hydrostatic Water Level: ${Number(water_level_cm).toFixed(1)} cm
- Hydrostatic Pressure: ${Number(pressure_kpa).toFixed(3)} kPa (${(Number(pressure_kpa) * 1000).toFixed(0)} Pa)
- Pump Motor State: ${pump_on ? 'ON (ACTIVE)' : 'OFF (IDLE)'}
- SCT-013 Motor Current: ${Number(motor_current_a).toFixed(2)} A
- HC-SR04 Wellhead Lid Guard: ${tamper ? '⚠️ OPEN / BREACH DETECTED (theft risk)' : '✅ SEALED / SECURE'}
- Aquifer Rate of Change (dh/dt): ${Number(dhdt).toFixed(2)} cm/h
- Time to Dry-Run (T_dry): ${dry}
- Kinetic Inference: ${inf}
- Percolation Status: ${rain > 0 ? `Rainwater Recharge Active (Event #${rec})` : 'No precipitation'}

Please provide:
1. 🩺 Overall Aquifer Health Status (Optimal / Stressed / Critical)
2. 🔬 Subsurface Analysis (Explain the hydraulic gradient and recharge vs extraction dynamic)
3. ⚙️ Pump & Equipment Diagnostics (Current draw, dry-run safety margin, lid security)
4. 📋 Tactical SCADA Recommendations (Pumping schedule, recharge pit maintenance, neighbor coordination)`;

    const result = await queryGemini({ prompt, telemetry });
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error('AI Diagnose Error:', error.message);
    const fallback = generateDeterministicAnalysis('', req.body?.telemetry || {});
    return res.status(200).json({
      ok: true,
      source: 'error-fallback',
      warning: error.message,
      text: fallback,
    });
  }
});

// Gemini AI Interactive Copilot Chat
app.post('/api/ai/chat', async (req, res) => {
  try {
    const { message, history = [], telemetry = {} } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Field "message" (string) is required' });
    }

    const telemetryHeader = `[WELLHEAD TELEMETRY SNAPSHOT: Water Level: ${Number(telemetry.water_level_cm ?? 68).toFixed(1)} cm | Pressure: ${Number(telemetry.pressure_kpa ?? 6.66).toFixed(2)} kPa | Motor: ${telemetry.pump_on ? 'RUNNING' : 'IDLE'} (${Number(telemetry.motor_current_a ?? 0).toFixed(2)} A) | Well Lid: ${telemetry.tamper ? 'BREACHED' : 'SECURE'} | dh/dt: ${Number(telemetry.dhdt ?? 0).toFixed(2)} cm/h | Inference: ${telemetry.inf ?? 'N/A'}]`;

    const prompt = `${telemetryHeader}\n\nOperator Question: ${message}`;
    const result = await queryGemini({ prompt, history, telemetry });
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error('AI Chat Error:', error.message);
    return res.status(200).json({
      ok: true,
      source: 'error-fallback',
      warning: error.message,
      text: `Apologies, I encountered an issue contacting Gemini (${error.message}).\n\n${generateDeterministicAnalysis('', req.body?.telemetry || {})}`,
    });
  }
});

// Telemetry Ingestion (from ESP32 or Simulator)
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
  console.log(`JalNetra Telemetry & Gemini AI API listening on http://localhost:${PORT}`);
});
