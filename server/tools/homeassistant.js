// Control de la casa vía Home Assistant (REST API). Se activa cuando existen HA_URL y HA_TOKEN.
import { config } from "../config.js";

async function ha(method, endpoint, body) {
  const { url, token } = config.homeAssistant;
  const res = await fetch(`${url}/api${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Home Assistant respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const DOMINIOS_UTILES = new Set(["light", "switch", "fan", "climate", "cover", "lock", "media_player", "sensor", "binary_sensor", "camera", "scene", "script", "vacuum", "input_boolean"]);

export function homeAssistantTools() {
  const { url, token } = config.homeAssistant;
  if (!url || !token) return [];
  return [
    {
      definition: {
        name: "casa_estado",
        description:
          "Consulta el estado de los dispositivos de la casa en Home Assistant (luces, enchufes, ventiladores, aire, sensores, cámaras, cerraduras). Filtra por dominio o por texto en el nombre. Devuelve entity_id, nombre y estado.",
        input_schema: {
          type: "object",
          properties: {
            dominio: { type: "string", description: "Dominio a filtrar: light, switch, fan, climate, cover, lock, sensor, binary_sensor, media_player, camera, scene, script. Vacío = todos los útiles." },
            buscar: { type: "string", description: "Texto a buscar en el nombre o entity_id (ej. 'sala', 'cuarto')" },
          },
          required: [],
        },
      },
      async execute({ dominio, buscar }) {
        const states = await ha("GET", "/states");
        const q = (buscar || "").toLowerCase();
        const out = states
          .filter((s) => {
            const dom = s.entity_id.split(".")[0];
            if (dominio) return dom === dominio;
            return DOMINIOS_UTILES.has(dom);
          })
          .filter((s) => !q || s.entity_id.toLowerCase().includes(q) || (s.attributes?.friendly_name || "").toLowerCase().includes(q))
          .slice(0, 80)
          .map((s) => ({
            entity_id: s.entity_id,
            nombre: s.attributes?.friendly_name || s.entity_id,
            estado: s.state,
            unidad: s.attributes?.unit_of_measurement || undefined,
            temperatura: s.attributes?.temperature ?? undefined,
            brillo: s.attributes?.brightness ?? undefined,
          }));
        return out.length ? JSON.stringify(out) : "No se encontraron dispositivos con ese filtro.";
      },
    },
    {
      definition: {
        name: "casa_controlar",
        description:
          "Ejecuta una acción sobre un dispositivo de la casa llamando un servicio de Home Assistant. Ejemplos: dominio 'light' servicio 'turn_on' con datos {brightness_pct: 50}; 'switch' 'turn_off'; 'climate' 'set_temperature' con datos {temperature: 22}; 'fan' 'set_percentage' con {percentage: 60}; 'lock' 'lock'; 'scene' 'turn_on'; 'script' 'turn_on'. Usa casa_estado antes si no conoces el entity_id exacto.",
        input_schema: {
          type: "object",
          properties: {
            dominio: { type: "string", description: "Dominio del servicio (light, switch, fan, climate, cover, lock, scene, script, media_player)" },
            servicio: { type: "string", description: "Servicio a llamar (turn_on, turn_off, toggle, set_temperature, set_percentage, lock, unlock, open_cover, close_cover...)" },
            entity_id: { type: "string", description: "Entity id objetivo, ej. light.sala. Varios separados por coma." },
            datos: { type: "object", description: "Parámetros adicionales del servicio (opcional)" },
          },
          required: ["dominio", "servicio", "entity_id"],
        },
      },
      async execute({ dominio, servicio, entity_id, datos }) {
        const ids = entity_id.split(",").map((s) => s.trim()).filter(Boolean);
        await ha("POST", `/services/${dominio}/${servicio}`, { entity_id: ids.length === 1 ? ids[0] : ids, ...(datos || {}) });
        return `Listo: ${dominio}.${servicio} ejecutado sobre ${ids.join(", ")}.`;
      },
    },
  ];
}
