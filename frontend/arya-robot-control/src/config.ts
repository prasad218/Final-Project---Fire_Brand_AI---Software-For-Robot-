// Central place for backend connection settings. Everything here reads
// from Vite env vars (VITE_* — see .env.example) with sane localhost
// defaults, so `npm run dev` works out of the box against a backend
// started with `python web_server.py` on the same machine, and a real
// deployment only needs a `.env` with the real backend URL, no code
// changes.

function readEnv(key: string, fallback: string): string {
  const value = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key];
  return value && value.trim() ? value.trim() : fallback;
}

// HTTP base URL for REST calls (GET /api/health, POST /api/chat, ...).
export const API_BASE_URL: string = readEnv("VITE_API_BASE_URL", "http://localhost:8000").replace(/\/+$/, "");

// WebSocket base URL for /ws/vision. Derived from API_BASE_URL by
// default (http -> ws, https -> wss) unless explicitly overridden.
export const WS_BASE_URL: string = readEnv(
  "VITE_WS_BASE_URL",
  API_BASE_URL.replace(/^http/, "ws"),
).replace(/\/+$/, "");

export const ENDPOINTS = {
  health: `${API_BASE_URL}/api/health`,
  faces: `${API_BASE_URL}/api/faces`,
  visionMjpeg: `${API_BASE_URL}/api/vision/mjpeg`,
  visionState: `${API_BASE_URL}/api/vision/state`,
  visionSocket: `${WS_BASE_URL}/ws/vision`,
  visionClientSocket: `${WS_BASE_URL}/ws/vision-client`,
  chat: `${API_BASE_URL}/api/chat`,
  robotCommand: `${API_BASE_URL}/api/robot/command`,
};
