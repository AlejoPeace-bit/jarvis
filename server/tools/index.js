// Registro de herramientas: arma la lista según lo que esté configurado
import { timeTools } from "./time.js";
import { memoryTools } from "./memoria.js";
import { calendarTools } from "./calendar.js";
import { gmailTools } from "./gmail.js";
import { n8nTools } from "./n8n.js";
import { homeAssistantTools } from "./homeassistant.js";
import { mediaTools } from "./media.js";
import { isConfigured as googleConfigured, isConnected as googleConnected } from "../google.js";

export function buildToolset() {
  const tools = [...timeTools, ...memoryTools];
  const google = googleConfigured() && googleConnected();
  if (google) tools.push(...calendarTools, ...gmailTools);
  tools.push(...n8nTools(), ...homeAssistantTools(), ...mediaTools());

  const byName = new Map(tools.map((t) => [t.definition.name, t]));
  return {
    definitions: tools.map((t) => t.definition),
    names: [...byName.keys()],
    status: {
      google,
      n8n: tools.some((t) => t.definition.name === "ejecutar_flujo"),
      homeAssistant: tools.some((t) => t.definition.name === "casa_estado"),
      youtube: tools.some((t) => t.definition.name === "poner_video"),
    },
    async execute(name, input) {
      const tool = byName.get(name);
      if (!tool) return { content: `ERROR: herramienta desconocida '${name}'.`, isError: true };
      try {
        const out = await tool.execute(input || {});
        // Las herramientas de medios devuelven { texto, media }: el texto va a Claude y media a la app
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
