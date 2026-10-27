// Memoria de conversación (por sesión) y memoria larga (notas) persistidas en DATA_DIR
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const SESSIONS_FILE = path.join(config.dataDir, "sessions.json");
const NOTES_FILE = path.join(config.dataDir, "memoria.md");
const MAX_MESSAGES = 40; // mensajes recordados por sesión

let sessions = new Map();
try {
  if (fs.existsSync(SESSIONS_FILE)) {
    const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
    sessions = new Map(Object.entries(raw));
  }
} catch (err) {
  console.warn("No se pudo leer sessions.json, se empieza vacío:", err.message);
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions)));
    } catch (err) {
      console.warn("No se pudo guardar sessions.json:", err.message);
    }
  }, 800);
}

function hasToolResult(msg) {
  return Array.isArray(msg.content) && msg.content.some((b) => b.type === "tool_result");
}

/** Recorta el historial sin partir un par tool_use/tool_result. */
export function trimHistory(messages, max = MAX_MESSAGES) {
  const out = messages.slice();
  while (out.length > max) out.shift();
  // El historial debe empezar con un mensaje de usuario "normal" (no un tool_result huérfano)
  while (out.length && (out[0].role !== "user" || hasToolResult(out[0]))) out.shift();
  return out;
}

export const sessionStore = {
  get(sessionId) {
    return sessions.get(sessionId) || [];
  },
  set(sessionId, messages) {
    sessions.set(sessionId, trimHistory(messages));
    scheduleSave();
  },
  reset(sessionId) {
    sessions.delete(sessionId);
    scheduleSave();
  },
};

export const notes = {
  read() {
    try {
      return fs.existsSync(NOTES_FILE) ? fs.readFileSync(NOTES_FILE, "utf8") : "";
    } catch {
      return "";
    }
  },
  add(text) {
    const date = new Date().toLocaleDateString("es-CO", { timeZone: config.timezone });
    fs.appendFileSync(NOTES_FILE, `- [${date}] ${text.trim().replace(/\s+/g, " ")}\n`);
  },
  remove(fragment) {
    const current = notes.read();
    const lines = current.split("\n");
    const kept = lines.filter((l) => !l.toLowerCase().includes(fragment.toLowerCase()));
    fs.writeFileSync(NOTES_FILE, kept.join("\n"));
    return lines.length - kept.length;
  },
};
