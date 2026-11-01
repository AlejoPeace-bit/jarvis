import express from "express";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { runAgent } from "./agent.js";
import { sessionStore } from "./memory.js";
import { buildToolset } from "./tools/index.js";
import * as googleAuth from "./google.js";
import { sttAvailable, transcribe } from "./stt.js";
import { getWeather } from "./tools/clima.js";
import { readLista, applyLista } from "./tools/lista.js";
import { readTimers, removeTimer } from "./tools/temporizador.js";
import { getMonthSpend } from "./tools/finanzas.js";
import { panelDevices, ha } from "./tools/homeassistant.js";
import { calendarTools } from "./tools/calendar.js";
import { todayISO } from "./tools/time.js";

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
/** Devuelve el rol de la clave: "admin" (clave principal), "panel" (tablet de la cocina) o null. */
function roleOf(key) {
  key = key || "";
  if (config.password && safeEqual(key, config.password)) return "admin";
  if (config.panelPassword && config.panelPassword.length >= 8 && safeEqual(key, config.panelPassword)) return "panel";
  return null;
}
function checkKey(key) {
  return roleOf(key) === "admin";
}
function requireAuth(req, res, next) {
  if (!config.password) return res.status(500).json({ error: "El servidor no tiene JARVIS_PASSWORD configurada." });
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const role = roleOf(token);
  if (!role) return res.status(401).json({ error: "Clave incorrecta." });
  req.role = role;
  next();
}
// Las sesiones del panel viven aparte: la tablet nunca puede leer la conversación del celular
function sessionFor(req, sessionId) {
  const sid = typeof sessionId === "string" && /^[\w-]{1,64}$/.test(sessionId) ? sessionId : crypto.randomUUID();
  return req.role === "panel" ? `panel-${sid}` : sid;
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
  const toolset = buildToolset(req.role);
  res.json({
    ok: true,
    rol: req.role,
    nombre: config.assistantName,
    modelo: config.model,
    google: { configurado: googleAuth.isConfigured(), conectado: googleAuth.isConnected() },
    n8n: toolset.status.n8n,
    homeAssistant: toolset.status.homeAssistant,
    youtube: toolset.status.youtube,
    voz: sttAvailable(),
    herramientas: toolset.names,
  });
});

// Voz a texto: el navegador manda el audio grabado (webm/ogg/mp4) como cuerpo crudo
app.post(
  "/api/transcribe",
  requireAuth,
  rateLimit,
  express.raw({ type: ["audio/*", "application/octet-stream"], limit: "15mb" }),
  async (req, res) => {
    if (!sttAvailable()) return res.status(503).json({ error: "La voz del servidor no está configurada." });
    if (!req.body || !req.body.length) return res.status(400).json({ error: "No llegó audio." });
    try {
      const text = await transcribe(req.body, req.get("content-type") || "audio/webm");
      res.json({ text });
    } catch (err) {
      console.error("Error en /api/transcribe:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

app.post("/api/chat", requireAuth, rateLimit, async (req, res) => {
  const { message, sessionId } = req.body || {};
  if (!message || typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "Falta el mensaje." });
  const sid = sessionFor(req, sessionId);
  try {
    const result = await runAgent({ sessionId: sid, message: message.trim().slice(0, 4000), role: req.role });
    res.json({ ...result, sessionId: sid.replace(/^panel-/, "") });
  } catch (err) {
    console.error("Error en /api/chat:", err);
    const msg = err?.error?.error?.message || err?.message || "Error desconocido";
    res.status(500).json({ error: msg });
  }
});

app.post("/api/reset", requireAuth, (req, res) => {
  const { sessionId } = req.body || {};
  if (sessionId) sessionStore.reset(sessionFor(req, sessionId));
  res.json({ ok: true });
});

// ---------- Panel de la cocina ----------
async function agendaHoy() {
  const day = todayISO();
  const off = new Intl.DateTimeFormat("en-US", { timeZone: config.timezone, timeZoneName: "longOffset" })
    .formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value.replace("GMT", "") || "-05:00";
  const tool = calendarTools.find((t) => t.definition.name === "consultar_agenda");
  const raw = await tool.execute({ desde: `${day}T00:00:00${off}`, hasta: `${day}T23:59:59${off}` });
  if (!raw.startsWith("[")) return [];
  return JSON.parse(raw).map((e) => ({ titulo: e.titulo, inicio: e.inicio, fin: e.fin, lugar: e.lugar }));
}
const settle = (p) => p.then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, e: e.message }));

app.get("/api/panel", requireAuth, async (req, res) => {
  const toolset = buildToolset(req.role);
  const [clima, agenda, gasto, casa] = await Promise.all([
    settle(getWeather()),
    toolset.status.google ? settle(agendaHoy()) : Promise.resolve({ ok: false, e: "Google no conectado" }),
    toolset.status.finanzas ? settle(getMonthSpend()) : Promise.resolve({ ok: true, v: null }),
    toolset.status.homeAssistant ? settle(panelDevices()) : Promise.resolve({ ok: true, v: null }),
  ]);
  res.json({
    ahora: Date.now(),
    nombre: config.assistantName,
    clima: clima.ok ? clima.v : { error: clima.e },
    agenda: agenda.ok ? agenda.v : { error: agenda.e },
    lista: readLista(),
    temporizadores: readTimers(),
    gasto: gasto.ok ? gasto.v : { error: gasto.e },
    casa: casa.ok ? casa.v : { error: casa.e },
    voz: sttAvailable(),
    wake: config.picovoiceKey ? { picovoiceKey: config.picovoiceKey } : null,
  });
});

app.post("/api/lista", requireAuth, (req, res) => {
  const { accion, id, items } = req.body || {};
  if (!["agregar", "quitar", "alternar", "marcar", "desmarcar", "limpiar_hechos", "vaciar"].includes(accion)) return res.status(400).json({ error: "Acción inválida." });
  const { items: lista } = applyLista({ accion, id, items: items ? [].concat(items).slice(0, 20).map((t) => String(t).slice(0, 80)) : [] });
  res.json({ lista });
});

app.post("/api/temporizador", requireAuth, (req, res) => {
  const { id } = req.body || {};
  res.json({ temporizadores: id ? removeTimer(String(id)) : readTimers() });
});

app.post("/api/casa", requireAuth, rateLimit, async (req, res) => {
  const { entity_id, servicio } = req.body || {};
  const dominio = String(entity_id || "").split(".")[0];
  if (!["light", "switch", "fan", "input_boolean", "climate"].includes(dominio)) return res.status(400).json({ error: "Dispositivo no permitido." });
  const svc = ["turn_on", "turn_off", "toggle"].includes(servicio) ? servicio : "toggle";
  try {
    await ha("POST", `/services/${dominio}/${svc}`, { entity_id });
    res.json({ ok: true, casa: await panelDevices() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
      if (/sw\.js$|index\.html$|panel\.html$/.test(filePath)) res.setHeader("Cache-Control", "no-cache");
      if (filePath.endsWith(".webmanifest")) res.setHeader("Content-Type", "application/manifest+json");
    },
  }),
);

app.listen(config.port, () => {
  console.log(`${config.assistantName} escuchando en http://localhost:${config.port}`);
  console.log(`Google: ${googleAuth.isConfigured() ? (googleAuth.isConnected() ? "conectado" : "configurado, falta autorizar en /auth/google?key=...") : "no configurado"}`);
  if (!config.password) console.warn("ADVERTENCIA: define JARVIS_PASSWORD; sin ella la API rechaza todo.");
  if (config.panelPassword && config.panelPassword.length < 8) console.warn("ADVERTENCIA: PANEL_PASSWORD debe tener al menos 8 caracteres; el panel queda desactivado.");
  if (config.panelPassword && config.panelPassword === config.password) console.warn("ADVERTENCIA: PANEL_PASSWORD no debe ser igual a JARVIS_PASSWORD.");
  if (!config.anthropicApiKey) console.warn("ADVERTENCIA: falta ANTHROPIC_API_KEY.");
});
