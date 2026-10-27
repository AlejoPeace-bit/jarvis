import express from "express";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { runAgent } from "./agent.js";
import { sessionStore } from "./memory.js";
import { buildToolset } from "./tools/index.js";
import * as googleAuth from "./google.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "200kb" }));

// ---------- Seguridad ----------
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
function checkKey(key) {
  return Boolean(config.password) && safeEqual(key || "", config.password);
}
function requireAuth(req, res, next) {
  if (!config.password) return res.status(500).json({ error: "El servidor no tiene JARVIS_PASSWORD configurada." });
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!checkKey(token)) return res.status(401).json({ error: "Clave incorrecta." });
  next();
}

// Límite simple: 40 peticiones por minuto por IP
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const rec = hits.get(req.ip) || { count: 0, reset: now + 60_000 };
  if (now > rec.reset) Object.assign(rec, { count: 0, reset: now + 60_000 });
  rec.count += 1;
  hits.set(req.ip, rec);
  if (rec.count > 40) return res.status(429).json({ error: "Demasiadas peticiones. Espera un momento." });
  next();
}

// ---------- API ----------
app.get("/api/health", requireAuth, (req, res) => {
  const toolset = buildToolset();
  res.json({
    ok: true,
    nombre: config.assistantName,
    modelo: config.model,
    google: { configurado: googleAuth.isConfigured(), conectado: googleAuth.isConnected() },
    n8n: toolset.status.n8n,
    homeAssistant: toolset.status.homeAssistant,
    herramientas: toolset.names,
  });
});

app.post("/api/chat", requireAuth, rateLimit, async (req, res) => {
  const { message, sessionId } = req.body || {};
  if (!message || typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "Falta el mensaje." });
  const sid = typeof sessionId === "string" && sessionId.length <= 64 ? sessionId : crypto.randomUUID();
  try {
    const result = await runAgent({ sessionId: sid, message: message.trim().slice(0, 4000) });
    res.json({ ...result, sessionId: sid });
  } catch (err) {
    console.error("Error en /api/chat:", err);
    const msg = err?.error?.error?.message || err?.message || "Error desconocido";
    res.status(500).json({ error: msg });
  }
});

app.post("/api/reset", requireAuth, (req, res) => {
  const { sessionId } = req.body || {};
  if (sessionId) sessionStore.reset(sessionId);
  res.json({ ok: true });
});

// ---------- OAuth de Google (se hace una sola vez desde el navegador) ----------
app.get("/auth/google", (req, res) => {
  if (!checkKey(req.query.key)) return res.status(401).send("Agrega ?key=TU_CLAVE a la URL.");
  if (!googleAuth.isConfigured()) return res.status(500).send("Faltan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET o PUBLIC_URL.");
  res.redirect(googleAuth.getAuthUrl());
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    await googleAuth.handleCallback(String(req.query.code || ""), String(req.query.state || ""));
    res.send(page("Google conectado", `Listo. ${config.assistantName} ya puede ver tu agenda y tu correo. Puedes cerrar esta pestaña y volver a la app.`));
  } catch (err) {
    res.status(400).send(page("No se pudo conectar", err.message));
  }
});

function page(title, body) {
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui;background:#0b0f14;color:#e6edf3;display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:24px"><div><h1 style="color:#4fd1ff">${title}</h1><p>${body}</p><p><a href="/" style="color:#4fd1ff">Volver a la app</a></p></div></body></html>`;
}

// ---------- PWA ----------
app.use(
  express.static(PUBLIC_DIR, {
    setHeaders(res, filePath) {
      if (filePath.endsWith("sw.js") || filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
      if (filePath.endsWith(".webmanifest")) res.setHeader("Content-Type", "application/manifest+json");
    },
  }),
);

app.listen(config.port, () => {
  console.log(`${config.assistantName} escuchando en http://localhost:${config.port}`);
  console.log(`Google: ${googleAuth.isConfigured() ? (googleAuth.isConnected() ? "conectado" : "configurado, falta autorizar en /auth/google?key=...") : "no configurado"}`);
  if (!config.password) console.warn("ADVERTENCIA: define JARVIS_PASSWORD; sin ella la API rechaza todo.");
  if (!config.anthropicApiKey) console.warn("ADVERTENCIA: falta ANTHROPIC_API_KEY.");
});
