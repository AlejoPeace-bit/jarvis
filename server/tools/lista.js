// Lista de mercado compartida (se ve en el panel de la cocina y en el celular). Archivo: DATA_DIR/lista.json
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.js";

const FILE = path.join(config.dataDir, "lista.json");

export function readLista() {
  try {
    return fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : [];
  } catch {
    return [];
  }
}
function writeLista(items) {
  fs.writeFileSync(FILE, JSON.stringify(items, null, 2));
}
function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}
function find(items, texto) {
  const n = norm(texto);
  return items.find((i) => norm(i.texto) === n) || items.find((i) => norm(i.texto).includes(n) || n.includes(norm(i.texto)));
}

/** Aplica una acción a la lista. Devuelve { items, mensaje }. También la usa la API del panel. */
export function applyLista({ accion, items: textos = [], id }) {
  let items = readLista();
  const textosArr = (Array.isArray(textos) ? textos : [textos]).map((t) => String(t).trim()).filter(Boolean);
  const msgs = [];
  switch (accion) {
    case "agregar":
      for (const t of textosArr) {
        const ex = find(items, t);
        if (ex && norm(ex.texto) === norm(t)) { ex.hecho = false; msgs.push(`${t} ya estaba`); continue; }
        items.push({ id: crypto.randomUUID().slice(0, 8), texto: t, hecho: false, creado: Date.now() });
        msgs.push(`agregado ${t}`);
      }
      break;
    case "quitar":
      for (const t of textosArr) {
        const ex = find(items, t);
        if (!ex) { msgs.push(`no encontré ${t}`); continue; }
        items = items.filter((i) => i !== ex);
        msgs.push(`quitado ${ex.texto}`);
      }
      if (id) items = items.filter((i) => i.id !== id);
      break;
    case "marcar":
    case "desmarcar": {
      const hecho = accion === "marcar";
      for (const t of textosArr) {
        const ex = find(items, t);
        if (!ex) { msgs.push(`no encontré ${t}`); continue; }
        ex.hecho = hecho;
        msgs.push(`${ex.texto} ${hecho ? "listo" : "pendiente"}`);
      }
      if (id) { const ex = items.find((i) => i.id === id); if (ex) ex.hecho = hecho; }
      break;
    }
    case "alternar":
      if (id) { const ex = items.find((i) => i.id === id); if (ex) ex.hecho = !ex.hecho; }
      break;
    case "limpiar_hechos":
      items = items.filter((i) => !i.hecho);
      msgs.push("quité los comprados");
      break;
    case "vaciar":
      items = [];
      msgs.push("lista vacía");
      break;
    case "ver":
    default:
      break;
  }
  writeLista(items);
  return { items, mensaje: msgs.join("; ") };
}

function resumen(items) {
  const pend = items.filter((i) => !i.hecho).map((i) => i.texto);
  const hechos = items.filter((i) => i.hecho).map((i) => i.texto);
  if (!items.length) return "La lista de mercado está vacía.";
  return `Pendientes (${pend.length}): ${pend.join(", ") || "ninguno"}.` + (hechos.length ? ` Ya comprados: ${hechos.join(", ")}.` : "");
}

export const listaTools = [
  {
    definition: {
      name: "lista_mercado",
      description:
        "Lista de mercado compartida de la casa. Acciones: agregar (varios productos a la vez), quitar, marcar (ya comprado), desmarcar, ver, limpiar_hechos (borra los comprados), vaciar. Úsala cuando digan 'agrega X a la lista', 'qué falta comprar', 'ya compré X'.",
      input_schema: {
        type: "object",
        properties: {
          accion: { type: "string", enum: ["agregar", "quitar", "marcar", "desmarcar", "ver", "limpiar_hechos", "vaciar"] },
          items: { type: "array", items: { type: "string" }, description: "Productos, uno por elemento (ej. ['leche', 'huevos', 'papel higiénico'])" },
        },
        required: ["accion"],
      },
    },
    async execute({ accion, items }) {
      const { items: lista, mensaje } = applyLista({ accion, items });
      return { texto: (mensaje ? mensaje + ". " : "") + resumen(lista), media: { tipo: "refrescar", que: "lista" } };
    },
  },
];
