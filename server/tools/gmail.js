import { gmailApi } from "../google.js";
import { config } from "../config.js";

const b64url = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

function header(payload, name) {
  const h = (payload?.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : "";
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Extrae el cuerpo (texto plano preferido) y la lista de adjuntos de un payload de Gmail. */
export function extractBody(payload) {
  let text = "";
  let html = "";
  const attachments = [];
  const walk = (part) => {
    if (!part) return;
    const mime = part.mimeType || "";
    if (part.filename && part.body?.attachmentId) attachments.push(part.filename);
    if (part.body?.data) {
      if (mime === "text/plain" && !text) text = fromB64url(part.body.data);
      else if (mime === "text/html" && !html) html = fromB64url(part.body.data);
    }
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  const body = text || (html ? stripHtml(html) : "");
  return { body, attachments };
}

function fmtDate(ms) {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: config.timezone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(Number(ms)));
}

export const gmailTools = [
  {
    definition: {
      name: "buscar_correos",
      description:
        "Busca correos en el Gmail del usuario con la sintaxis de búsqueda de Gmail. Devuelve id, remitente, asunto, fecha, si está sin leer y un fragmento. Ejemplos de consulta: 'is:unread newer_than:1d', 'from:curaduria', 'subject:cotización newer_than:7d', 'in:inbox category:primary is:unread'. Para 'correos importantes' usa 'in:inbox is:unread -category:promotions -category:social'.",
      input_schema: {
        type: "object",
        properties: {
          consulta: { type: "string", description: "Consulta con sintaxis de Gmail" },
          maximo: { type: "integer", description: "Máximo de resultados (1-20). Por defecto 10." },
        },
        required: ["consulta"],
      },
    },
    async execute({ consulta, maximo }) {
      const gmail = gmailApi();
      const max = Math.min(Math.max(Number(maximo) || 10, 1), 20);
      const list = await gmail.users.messages.list({ userId: "me", q: consulta, maxResults: max });
      const ids = (list.data.messages || []).map((m) => m.id);
      if (!ids.length) return "No se encontraron correos con esa búsqueda.";
      const msgs = await Promise.all(
        ids.map((id) =>
          gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["From", "Subject", "Date"] }),
        ),
      );
      return JSON.stringify(
        msgs.map(({ data: m }) => ({
          id: m.id,
          de: header(m.payload, "From"),
          asunto: header(m.payload, "Subject"),
          fecha: fmtDate(m.internalDate),
          sinLeer: (m.labelIds || []).includes("UNREAD"),
          fragmento: m.snippet,
        })),
      );
    },
  },
  {
    definition: {
      name: "leer_correo",
      description: "Lee el contenido completo de un correo a partir de su id (obtenido con buscar_correos). Úsala cuando el usuario quiera saber qué dice un correo o un resumen de él.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Id del correo" },
          marcar_leido: { type: "boolean", description: "Si true, lo marca como leído después de leerlo. Por defecto false." },
        },
        required: ["id"],
      },
    },
    async execute({ id, marcar_leido }) {
      const gmail = gmailApi();
      const { data: m } = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const { body, attachments } = extractBody(m.payload);
      if (marcar_leido) {
        await gmail.users.messages.modify({ userId: "me", id, requestBody: { removeLabelIds: ["UNREAD"] } });
      }
      return JSON.stringify({
        de: header(m.payload, "From"),
        para: header(m.payload, "To"),
        cc: header(m.payload, "Cc") || undefined,
        asunto: header(m.payload, "Subject"),
        fecha: fmtDate(m.internalDate),
        adjuntos: attachments,
        cuerpo: body.slice(0, 6000) + (body.length > 6000 ? "\n[...recortado]" : ""),
      });
    },
  },
  {
    definition: {
      name: "enviar_correo",
      description:
        "Envía un correo desde la cuenta del usuario. REGLA: antes de llamarla, muestra al usuario destinatario, asunto y cuerpo completos y espera que diga explícitamente 'sí' o 'envíalo'. Solo entonces llama con confirmado=true.",
      input_schema: {
        type: "object",
        properties: {
          para: { type: "string", description: "Correo(s) destinatario(s), separados por coma" },
          asunto: { type: "string" },
          cuerpo: { type: "string", description: "Cuerpo en texto plano, firmado por el usuario" },
          confirmado: { type: "boolean", description: "true solo si el usuario confirmó explícitamente el envío en su último mensaje" },
        },
        required: ["para", "asunto", "cuerpo", "confirmado"],
      },
    },
    async execute({ para, asunto, cuerpo, confirmado }) {
      if (!confirmado) return "ERROR: no se envió. Falta la confirmación explícita del usuario. Muéstrale el borrador y pregunta si lo envías.";
      const mime = [
        `To: ${para}`,
        `Subject: =?UTF-8?B?${Buffer.from(asunto, "utf8").toString("base64")}?=`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from(cuerpo, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
      ].join("\r\n");
      const res = await gmailApi().users.messages.send({ userId: "me", requestBody: { raw: b64url(mime) } });
      return `Correo enviado a ${para} (id ${res.data.id}).`;
    },
  },
];
