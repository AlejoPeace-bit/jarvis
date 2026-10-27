// Tus flujos de n8n como herramientas de Jarvis.
// Defínelos en la variable N8N_FLOWS (JSON) o en el archivo DATA_DIR/flujos.json:
// [
//   { "nombre": "registrar_gasto", "descripcion": "Registra un gasto en la hoja familiar. Datos: monto, categoria, descripcion", "url": "https://.../webhook/gastos" },
//   { "nombre": "publicar_instagram", "descripcion": "...", "url": "https://.../webhook/ig", "metodo": "POST", "cabeceras": { "x-token": "..." } }
// ]
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export function loadFlows() {
  let flows = [];
  try {
    if (config.n8nFlowsJson) flows = JSON.parse(config.n8nFlowsJson);
  } catch (err) {
    console.warn("N8N_FLOWS no es JSON válido:", err.message);
  }
  const file = path.join(config.dataDir, "flujos.json");
  try {
    if (fs.existsSync(file)) flows = flows.concat(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (err) {
    console.warn("flujos.json no es JSON válido:", err.message);
  }
  return flows.filter((f) => f && f.nombre && f.url);
}

export function n8nTools() {
  const flows = loadFlows();
  if (!flows.length) return [];
  const listado = flows.map((f) => `- ${f.nombre}: ${f.descripcion || "(sin descripción)"}`).join("\n");
  return [
    {
      definition: {
        name: "ejecutar_flujo",
        description: `Ejecuta una automatización de n8n del usuario enviándole datos. Flujos disponibles:\n${listado}\nPasa en 'datos' los campos que el flujo necesita según su descripción.`,
        input_schema: {
          type: "object",
          properties: {
            nombre: { type: "string", description: "Nombre exacto del flujo", enum: flows.map((f) => f.nombre) },
            datos: { type: "object", description: "Datos a enviar al flujo (JSON)" },
          },
          required: ["nombre"],
        },
      },
      async execute({ nombre, datos }) {
        const flow = loadFlows().find((f) => f.nombre === nombre);
        if (!flow) return `ERROR: no existe el flujo '${nombre}'.`;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 60_000);
        try {
          const res = await fetch(flow.url, {
            method: flow.metodo || "POST",
            headers: { "Content-Type": "application/json", ...(flow.cabeceras || {}) },
            body: (flow.metodo || "POST") === "GET" ? undefined : JSON.stringify({ origen: "jarvis", ...(datos || {}) }),
            signal: ctrl.signal,
          });
          const text = (await res.text()).slice(0, 4000);
          return res.ok ? `Flujo '${nombre}' ejecutado (HTTP ${res.status}). Respuesta: ${text || "(vacía)"}` : `ERROR HTTP ${res.status} del flujo '${nombre}': ${text}`;
        } catch (err) {
          return `ERROR al llamar el flujo '${nombre}': ${err.message}`;
        } finally {
          clearTimeout(t);
        }
      },
    },
  ];
}
