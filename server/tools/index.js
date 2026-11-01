// Registro de herramientas: arma la lista según lo que esté configurado y el rol de quien pregunta
import { timeTools } from "./time.js";
import { memoryTools } from "./memoria.js";
import { calendarTools } from "./calendar.js";
import { gmailTools } from "./gmail.js";
import { n8nTools } from "./n8n.js";
import { homeAssistantTools } from "./homeassistant.js";
import { mediaTools } from "./media.js";
import { listaTools } from "./lista.js";
import { temporizadorTools } from "./temporizador.js";
import { climaTools } from "./clima.js";
import { finanzasTools } from "./finanzas.js";
import { isConfigured as googleConfigured, isConnected as googleConnected } from "../google.js";

/**
 * Roles:
 *  - admin: la clave principal (celular / computador de Alejandro). Todo.
 *  - panel: la clave de la tablet de la cocina. Es una pantalla compartida y expuesta, así que
 *    NO tiene correo, NO borra eventos y NO toca la memoria permanente.
 */
const PANEL_ALLOWED = new Set([
  "hora_actual", "clima", "consultar_agenda", "crear_evento",
  "lista_mercado", "temporizador", "gasto_del_mes",
  "casa_estado", "casa_controlar",
  "poner_video", "poner_podcast", "controlar_reproductor",
  "ejecutar_flujo",
]);

export function buildToolset(role = "admin") {
  let tools = [...timeTools, ...climaTools, ...memoryTools, ...listaTools, ...temporizadorTools];
  const google = googleConfigured() && googleConnected();
  if (google) tools.push(...calendarTools, ...gmailTools, ...finanzasTools());
  tools.push(...n8nTools(), ...homeAssistantTools(), ...mediaTools());
  if (role === "panel") tools = tools.filter((t) => PANEL_ALLOWED.has(t.definition.name));

  const byName = new Map(tools.map((t) => [t.definition.name, t]));
  return {
    role,
    definitions: tools.map((t) => t.definition),
    names: [...byName.keys()],
    status: {
      google,
      n8n: tools.some((t) => t.definition.name === "ejecutar_flujo"),
      homeAssistant: tools.some((t) => t.definition.name === "casa_estado"),
      youtube: tools.some((t) => t.definition.name === "poner_video"),
      finanzas: tools.some((t) => t.definition.name === "gasto_del_mes"),
    },
    async execute(name, input) {
      const tool = byName.get(name);
      if (!tool) return { content: `ERROR: herramienta desconocida '${name}'.`, isError: true };
      try {
        const out = await tool.execute(input || {});
        // Las herramientas con efecto en la app devuelven { texto, media }: el texto va a Claude y media a la app
        if (out && typeof out === "object" && out.media) {
          return { content: String(out.texto ?? ""), isError: false, media: out.media };
        }
        return { content: typeof out === "string" ? out : JSON.stringify(out), isError: false };
      } catch (err) {
        const msg = err?.response?.data?.error?.message || err?.message || String(err);
        return { content: `ERROR al ejecutar ${name}: ${msg}`, isError: true };
      }
    },
  };
}
