# 🌊 JalNetra · Aquifer Digital Twin & SCADA with Google Gemini AI

**JalNetra** is an IoT-enabled Groundwater Digital Twin and SCADA platform designed for rural and semi-urban aquifer monitoring, wellhead anti-theft security, and hydrogeological diagnostics powered by **Google Gemini API**.

---

## 🚀 Key Features

1. **SCADA Digital Twin & 3D Wellhead Simulation (`scada.html`)**:
   - Subsurface geological strata cutaway: Topsoil, Clay/Silt aquitard, Saturated Coarse Sand aquifer, Bedrock aquiclude.
   - Submersible pump motor simulation with AC current monitoring (SCT-013 clamp).
   - Hydrostatic water level ($h$) and pressure ($P = \rho g h$) via MPS20N0040D dip-tube sensor.
   - Anti-theft wellhead lid guard with HC-SR04 ultrasonic sonar.
   - Real-time rate of water table change ($dh/dt$), dry-run protection ($T_{\text{dry}}$), and neighbor over-extraction detection.
   - Chart.js 24-hour hydrostatic head & motor current telemetry trends.

2. **✨ Google Gemini AI Copilot Integration**:
   - **Real-Time Hydrogeological Diagnosis (`POST /api/ai/diagnose`)**: Evaluates live sensor telemetry, aquifer stress, hydraulic gradients, pump health, and yields immediate operational recommendations.
   - **Interactive AI Copilot Chat (`POST /api/ai/chat`)**: Ask Gemini technical questions about wellhead kinetics, Stevin's law, neighboring over-extraction, and sustainable pumping schedules.
   - **Resilient Fallback**: Operates with a deterministic physics engine if `GEMINI_API_KEY` is not yet configured, and seamlessly switches to live Gemini 1.5/2.5 when the key is added.

3. **Node.js Telemetry API (`backend/server.js`)**:
   - `GET /api/health`: Health status & Gemini configuration status.
   - `GET /api/ai/status`: Model and key status.
   - `POST /api/ai/diagnose`: Generates hydrogeological AI diagnostics.
   - `POST /api/ai/chat`: Conversational AI assistant with full telemetry awareness.
   - `POST /api/telemetry`: Ingests IoT readings from ESP32 microcontrollers or hardware simulators.
   - `GET /api/telemetry/latest`: Fetches the latest sensor reading.
   - `GET /api/telemetry/history`: Fetches past 100 historical readings.

---

## 🛠️ Getting Started

### 1. Prerequisites
- **Node.js**: v20+
- A **Google Gemini API Key** (from [Google AI Studio](https://aistudio.google.com/))

### 2. Configure Environment Variables
Inside the `backend/` directory, open `.env` (or copy from `.env.example`):
```env
PORT=3001
CORS_ORIGIN=http://localhost:3000,http://localhost:5500,http://localhost:8000,http://127.0.0.1:5500,http://127.0.0.1:8000

# Google Gemini API
GEMINI_API_KEY=AIzaSy...your-gemini-api-key-here
GEMINI_MODEL=gemini-1.5-flash
```

### 3. Start the Backend Server
```bash
cd backend
npm install
npm start
```
The server will start listening at:
`http://localhost:3001`

### 4. Deploy on PieHost
Deploy the project root as a **Node Application** with these settings:

| Setting | Value |
|---|---|
| Runtime | Node.js 20 |
| Entry file | `server.js` |
| Port | `3001` (the server uses the platform-provided `PORT` when available) |
| Build command | `npm install` |
| Start command | `npm start` |

The root `server.js` starts the backend, which also serves the frontend files. Set `DEVICE_API_KEY` to a long random secret in PieHost's environment settings and use the same value in the ESP32 sketch. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` there if telemetry should persist in Supabase; never put the service-role key in frontend or ESP32 code. `GEMINI_API_KEY` is optional.

Before deploying a Supabase-backed version, run [`backend/migrations/001_add_lid_telemetry.sql`](backend/migrations/001_add_lid_telemetry.sql) in the Supabase SQL Editor. If the frontend is hosted on a separate domain, set `CORS_ORIGIN` to that exact HTTPS origin. When PieHost serves both the dashboard and API from this Node app, no production CORS origin is needed.

### 5. Deploy on Render
The repository includes [`render.yaml`](render.yaml) for a Render Blueprint. In Render, create a new Blueprint and select this GitHub repository. It configures a Node 20 web service with `npm install`, `npm start`, and `/api/health` as its health check. Render generates `DEVICE_API_KEY`; set optional `GEMINI_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` in the service environment if those integrations are needed. Apply the Supabase migration above before enabling Supabase storage.

### 6. Launch the Dashboard
Open `index.html` or `scada.html` in your browser (via VS Code Live Server, Python `python -m http.server 8000`, or direct browser opening).

- Click the **✨ Gemini AI** button in the top navigation bar to open the AI Copilot.
- Click **⚡ Diagnose Telemetry** to generate a hydrogeological evaluation of the current aquifer state.
- Ask questions or click the quick prompt chips!

---

## 📡 API Endpoints Overview

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health and AI connection status |
| `GET` | `/api/ai/status` | Gemini configuration details |
| `POST` | `/api/ai/diagnose` | Run hydrogeological diagnosis on telemetry |
| `POST` | `/api/ai/chat` | Interactive multi-turn chat with telemetry context |
| `POST` | `/api/telemetry` | Push sensor telemetry (`x-device-key` header required) |
| `GET` | `/api/telemetry/latest` | Fetch the latest telemetry record |
| `GET` | `/api/telemetry/history` | Fetch historical telemetry series |

---

## 🧪 Testing the Gemini API via cURL

```bash
# Hydrogeological Diagnostics
curl -X POST http://localhost:3001/api/ai/diagnose \
  -H "Content-Type: application/json" \
  -d '{"telemetry": {"water_level_cm": 64.5, "pressure_kpa": 6.32, "pump_on": false, "tamper": false, "dhdt": -0.15}}'

# Interactive Copilot Chat
curl -X POST http://localhost:3001/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Why is the water table declining when my pump is turned off?", "telemetry": {"water_level_cm": 58, "pump_on": false, "dhdt": -0.2}}'
```

