// Conexión con Google (Calendar + Gmail) vía OAuth2. El token se guarda en DATA_DIR/google-tokens.json
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { google } from "googleapis";
import { config } from "./config.js";

const TOKEN_FILE = path.join(config.dataDir, "google-tokens.json");
export const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.modify",
];

const pendingStates = new Map(); // state -> expiración (anti-CSRF del flujo OAuth)

function readTokens() {
  try {
    return fs.existsSync(TOKEN_FILE) ? JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8")) : null;
  } catch {
    return null;
  }
}
function writeTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function isConfigured() {
  const g = config.google;
  return Boolean(g.clientId && g.clientSecret && g.redirectUri);
}

export function isConnected() {
  const t = readTokens();
  return Boolean(t && t.refresh_token);
}

let cachedClient = null;
export function getAuthClient() {
  if (!isConfigured()) throw new Error("Google no está configurado (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / PUBLIC_URL).");
  if (cachedClient) return cachedClient;
  const g = config.google;
  const client = new google.auth.OAuth2(g.clientId, g.clientSecret, g.redirectUri);
  const saved = readTokens();
  if (saved) client.setCredentials(saved);
  client.on("tokens", (fresh) => {
    const merged = { ...(readTokens() || {}), ...fresh };
    writeTokens(merged);
  });
  cachedClient = client;
  return client;
}

export function getAuthUrl() {
  const client = getAuthClient();
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, Date.now() + 10 * 60 * 1000);
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
}

export async function handleCallback(code, state) {
  const exp = pendingStates.get(state);
  pendingStates.delete(state);
  if (!exp || exp < Date.now()) throw new Error("Estado OAuth inválido o vencido. Vuelve a iniciar desde /auth/google");
  const client = getAuthClient();
  const { tokens } = await client.getToken(code);
  const merged = { ...(readTokens() || {}), ...tokens };
  writeTokens(merged);
  client.setCredentials(merged);
  return true;
}

export function calendarApi() {
  return google.calendar({ version: "v3", auth: getAuthClient() });
}
export function gmailApi() {
  return google.gmail({ version: "v1", auth: getAuthClient() });
}
