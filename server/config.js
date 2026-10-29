// Carga de configuración: variables de entorno (+ archivo .env opcional para desarrollo local)
import fs from "node:fs";
import path from "node:path";

function loadDotEnv() {
  const file = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv();

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  dataDir: env.DATA_DIR || path.resolve(process.cwd(), "data"),
  publicUrl: (env.PUBLIC_URL || "").replace(/\/$/, ""),

  // Seguridad de la app
  password: env.JARVIS_PASSWORD || "",

  // Cerebro
  anthropicApiKey: env.ANTHROPIC_API_KEY || "",
  model: env.CLAUDE_MODEL || "claude-sonnet-5-5",
  maxTokens: Number(env.MAX_TOKENS || 1500),

  // Personalidad
  assistantName: env.ASSISTANT_NAME || "Jarvis",
  userName: env.USER_NAME || "Alejandro",
  userContext: env.USER_CONTEXT || "",
  timezone: env.TIMEZONE || "America/Bogota",

  // Google (Calendar + Gmail)
  google: {
    clientId: env.GOOGLE_CLIENT_ID || "",
    clientSecret: env.GOOGLE_CLIENT_SECRET || "",
    redirectUri:
      env.GOOGLE_REDIRECT_URI ||
      (env.PUBLIC_URL ? `${env.PUBLIC_URL.replace(/\/$/, "")}/auth/google/callback` : ""),
  },

  // n8n: flujos disponibles como herramientas (JSON en variable o archivo DATA_DIR/flujos.json)
  n8nFlowsJson: env.N8N_FLOWS || "",

  // Voz a texto en el servidor (Whisper): Groq (gratis) u OpenAI
  stt: {
    provider: (env.STT_PROVIDER || "groq").toLowerCase(),
    groqKey: env.GROQ_API_KEY || "",
    openaiKey: env.OPENAI_API_KEY || "",
    model: env.STT_MODEL || "",
  },

  // YouTube (búsqueda de videos): clave gratis de la YouTube Data API v3
  youtubeKey: env.YOUTUBE_API_KEY || "",

  // Home Assistant
  homeAssistant: {
    url: (env.HA_URL || "").replace(/\/$/, ""),
    token: env.HA_TOKEN || "",
  },
};

fs.mkdirSync(config.dataDir, { recursive: true });
