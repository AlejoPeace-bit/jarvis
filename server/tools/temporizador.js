// Temporizadores de cocina. Se guardan en el servidor (DATA_DIR/timers.json) y el panel los muestra y hace sonar.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.js";

const FILE = path.join(config.dataDir, "timers.json");

export function readTimers() {
  let items = [];
  try {
    items = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : [];
  } catch {
    items = [];
  }
  // Los vencidos hace más de 10 minutos se descartan (ya sonaron o nadie los vio)
  const keep = items.filter((t) => t.fin > Date.now() - 10 * 60_000);
  if (keep.length !== items.length) writeTimers(keep);
  return keep;
}
function writeTimers(items) {
  fs.writeFileSync(FILE, JSON.stringify(items, null, 2));
}
export function removeTimer(id) {
  const items = readTimers().filter((t) => t.id !== id);
  writeTimers(items);
  return items;
}

function faltan(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60), r = s % 60;
  if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60} min`;
  if (m) return r ? `${m} min ${r} s` : `${m} min`;
  return `${r} s`;
}
function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

export const temporizadorTools = [
  {
    definition: {
      name: "temporizador",
      description:
        "Temporizadores de cocina (pueden ser varios a la vez). Acciones: crear (con minutos y/o segundos y un nombre corto como 'arroz' o 'pasta'), cancelar (por nombre; sin nombre cancela todos), ver (cuánto falta). Al terminar, el panel suena y lo anuncia.",
      input_schema: {
        type: "object",
        properties: {
          accion: { type: "string", enum: ["crear", "cancelar", "ver"] },
          nombre: { type: "string", description: "Nombre corto del temporizador (ej. 'arroz')" },
          minutos: { type: "number" },
          segundos: { type: "number" },
        },
        required: ["accion"],
      },
    },
    async execute({ accion, nombre, minutos, segundos }) {
      let items = readTimers();
      const refrescar = { tipo: "refrescar", que: "temporizadores" };
      if (accion === "crear") {
        const ms = (Number(minutos) || 0) * 60_000 + (Number(segundos) || 0) * 1000;
        if (ms <= 0) return "ERROR: indica cuántos minutos o segundos.";
        if (ms > 24 * 3600_000) return "ERROR: máximo 24 horas.";
        const t = { id: crypto.randomUUID().slice(0, 8), nombre: (nombre || "temporizador").trim(), inicio: Date.now(), fin: Date.now() + ms };
        items.push(t);
        writeTimers(items);
        return { texto: `Temporizador "${t.nombre}" creado: ${faltan(ms)}.`, media: refrescar };
      }
      if (accion === "cancelar") {
        const antes = items.length;
        if (nombre) {
          const n = norm(nombre);
          items = items.filter((t) => !norm(t.nombre).includes(n));
        } else items = [];
        writeTimers(items);
        const q = antes - items.length;
        return { texto: q ? `Cancelé ${q} temporizador${q > 1 ? "es" : ""}.` : "No había ningún temporizador con ese nombre.", media: refrescar };
      }
      const activos = items.filter((t) => t.fin > Date.now());
      if (!activos.length) return "No hay temporizadores activos.";
      return activos.map((t) => `${t.nombre}: faltan ${faltan(t.fin - Date.now())}`).join(". ");
    },
  },
];
