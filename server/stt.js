// Voz a texto en el servidor (Whisper vía Groq u OpenAI, misma API)
import { config } from "./config.js";

const PROVIDERS = {
  groq: { url: "https://api.groq.com/openai/v1/audio/transcriptions", model: "whisper-large-v3-turbo" },
  openai: { url: "https://api.openai.com/v1/audio/transcriptions", model: "whisper-1" },
};

// Palabras que Whisper suele escribir mal; el prompt le da contexto
const VOCABULARIO =
  "Jarvis, Alejandro Paz, Villavicencio, Farmatodo, Metatron, CDF Studio, curaduría, licencia de construcción, " +
  "Guabinal, Terreros, Soacha, Bello Horizonte, Nicolás de Federmán, Parque Alegra, El Prado, Chicó, Paz Puerto, " +
  "La Compuerta, 3P Cubiertas, impermeabilización, n8n, Notion.";

function provider() {
  const s = config.stt;
  if (s.provider === "openai" && s.openaiKey) return { ...PROVIDERS.openai, key: s.openaiKey };
  if (s.groqKey) return { ...PROVIDERS.groq, key: s.groqKey };
  if (s.openaiKey) return { ...PROVIDERS.openai, key: s.openaiKey };
  return null;
}

export function sttAvailable() {
  return Boolean(provider());
}

const EXT = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/aac": "m4a" };

export async function transcribe(buffer, mimeType = "audio/webm") {
  const p = provider();
  if (!p) throw new Error("No hay servicio de voz configurado (falta GROQ_API_KEY u OPENAI_API_KEY).");
  const base = String(mimeType).split(";")[0].trim().toLowerCase();
  const ext = EXT[base] || "webm";

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: base || "audio/webm" }), `voz.${ext}`);
  form.append("model", config.stt.model || p.model);
  form.append("language", "es");
  form.append("response_format", "json");
  form.append("temperature", "0");
  form.append("prompt", VOCABULARIO);

  const res = await fetch(p.url, { method: "POST", headers: { Authorization: `Bearer ${p.key}` }, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Error ${res.status} del servicio de voz`);
  return (data.text || "").trim();
}
