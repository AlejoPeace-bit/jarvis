// El cerebro: bucle de tool use con Claude
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { sessionStore } from "./memory.js";
import { buildToolset } from "./tools/index.js";
import { buildSystemPrompt } from "./prompt.js";

const MAX_ITERATIONS = 8;

let defaultClient = null;
function getClient() {
  if (!config.anthropicApiKey) throw new Error("Falta ANTHROPIC_API_KEY en el servidor.");
  if (!defaultClient) defaultClient = new Anthropic({ apiKey: config.anthropicApiKey });
  return defaultClient;
}

const ACTION_LABELS = {
  consultar_agenda: "Agenda consultada",
  crear_evento: "Evento creado",
  eliminar_evento: "Evento eliminado",
  buscar_correos: "Correo revisado",
  leer_correo: "Correo leído",
  enviar_correo: "Correo enviado",
  ejecutar_flujo: "Automatización ejecutada",
  casa_estado: "Casa consultada",
  casa_controlar: "Casa controlada",
  recordar: "Guardado en memoria",
  olvidar: "Memoria actualizada",
  hora_actual: "Hora consultada",
};

function textOf(content) {
  return (content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/**
 * Procesa un mensaje del usuario y devuelve la respuesta final.
 * `deps` permite inyectar cliente/herramientas en pruebas.
 */
export async function runAgent({ sessionId, message }, deps = {}) {
  const client = deps.client || getClient();
  const toolset = deps.toolset || buildToolset();
  const system = deps.system || buildSystemPrompt(toolset);

  const history = sessionStore.get(sessionId);
  const messages = [...history, { role: "user", content: message }];
  const actions = [];
  let finalText = "";

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      system,
      tools: toolset.definitions,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      finalText = textOf(response.content);
      break;
    }

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    const results = await Promise.all(
      toolUses.map(async (tu) => {
        const started = Date.now();
        const { content, isError } = await toolset.execute(tu.name, tu.input);
        actions.push({
          tool: tu.name,
          label: ACTION_LABELS[tu.name] || tu.name,
          ok: !isError,
          ms: Date.now() - started,
        });
        return { type: "tool_result", tool_use_id: tu.id, content, is_error: isError || undefined };
      }),
    );
    messages.push({ role: "user", content: results });

    // Si el modelo escribió texto junto con la llamada, lo conservamos por si no hay más iteraciones
    finalText = textOf(response.content) || finalText;
  }

  if (!finalText) finalText = "Hice lo que pediste, pero me quedé sin palabras para resumirlo. ¿Quieres que lo repase?";

  // Guardar historial: si la última entrada quedó siendo tool_result (se agotaron iteraciones), cerramos con texto
  const last = messages[messages.length - 1];
  if (last.role === "user" && Array.isArray(last.content)) {
    messages.push({ role: "assistant", content: [{ type: "text", text: finalText }] });
  }
  sessionStore.set(sessionId, messages);

  return { reply: finalText, actions };
}
