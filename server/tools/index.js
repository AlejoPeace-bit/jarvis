// Registro de herramientas: arma la lista según lo que esté configurado
import { timeTools } from "./time.js";
import { memoryTools } from "./memoria.js";
import { calendarTools } from "./calendar.js";
import { gmailTools } from "./gmail.js";
import { n8nTools } from "./n8n.js";
import { homeAssistantTools } from "./homeassistant.js";
import { isConfigured as googleConfigured, isConnected as googleConnected } from "../google.js";

export function buildToolset() {
  const tools = [...timeTools, ...memoryTools];
  const google = googleConfigured() && googleConnected();
  if (google) tools.push(...calendarTools, ...gmailTools);
  tools.push(...n8nTools(), ...homeAssistantTools());

  const byName = new Map(tools.map((t) => [t.definition.name, t]));
  return {
    definitions: tools.map((t) => t.definition),
    names: [...byName.keys()],
    status: {
      google,
      n8n: tools.some((t) => t.definition.name === "ejecutar_flujo"),
      homeAssistant: tools.some((t) => t.definition.name === "casa_estado"),
    },
    async execute(name, input) {
      const tool = byName.get(name);
      if (!tool) return { content: `ERROR: herramienta desconocida '${name}'.`, isError: true };
      try {
        const content = await tool.execute(input || {});
        return { content: typeof content === "string" ? content : JSON.stringify(content), isError: false };
      } catch (err) {
        const msg = err?.response?.data?.error?.message || err?.message || String(err);
        return { content: `ERROR al ejecutar ${name}: ${msg}`, isError: true };
      }
    },
  };
}
