import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-test-"));
process.env.JARVIS_PASSWORD = "test";

const { runAgent } = await import("../server/agent.js");
const { trimHistory, notes } = await import("../server/memory.js");
const { extractBody } = await import("../server/tools/gmail.js");

test("bucle de herramientas: ejecuta la herramienta y devuelve la respuesta final", async () => {
  const calls = [];
  const client = {
    messages: {
      async create(req) {
        calls.push(req);
        if (calls.length === 1) {
          return {
            stop_reason: "tool_use",
            content: [
              { type: "text", text: "Reviso la agenda." },
              { type: "tool_use", id: "tu_1", name: "consultar_agenda", input: { desde: "a", hasta: "b" } },
            ],
          };
        }
        const last = req.messages[req.messages.length - 1];
        assert.equal(last.role, "user");
        assert.equal(last.content[0].type, "tool_result");
        assert.equal(last.content[0].tool_use_id, "tu_1");
        assert.match(last.content[0].content, /Reunión de obra/);
        return { stop_reason: "end_turn", content: [{ type: "text", text: "Tienes reunión de obra a las diez." }] };
      },
    },
  };
  const toolset = {
    definitions: [{ name: "consultar_agenda", description: "x", input_schema: { type: "object", properties: {} } }],
    status: { google: true, n8n: false, homeAssistant: false },
    async execute(name, input) {
      assert.equal(name, "consultar_agenda");
      return { content: JSON.stringify([{ titulo: "Reunión de obra", inicio: "10:00" }]), isError: false };
    },
  };
  const out = await runAgent({ sessionId: "s1", message: "¿qué tengo hoy?" }, { client, toolset, system: "sys" });
  assert.equal(out.reply, "Tienes reunión de obra a las diez.");
  assert.equal(out.actions.length, 1);
  assert.equal(out.actions[0].label, "Agenda consultada");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].tools.length, 1);
});

test("el historial se conserva entre mensajes de la misma sesión", async () => {
  let seen = 0;
  const client = {
    messages: {
      async create(req) {
        seen = req.messages.length;
        return { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] };
      },
    },
  };
  const toolset = { definitions: [], status: {}, async execute() { return { content: "", isError: false }; } };
  await runAgent({ sessionId: "s2", message: "hola" }, { client, toolset, system: "sys" });
  await runAgent({ sessionId: "s2", message: "otra" }, { client, toolset, system: "sys" });
  assert.equal(seen, 3); // user, assistant, user
});

test("trimHistory nunca deja un tool_result huérfano al inicio", () => {
  const msgs = [
    { role: "user", content: "a" },
    { role: "assistant", content: [{ type: "tool_use", id: "1", name: "x", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "r" }] },
    { role: "assistant", content: [{ type: "text", text: "b" }] },
    { role: "user", content: "c" },
    { role: "assistant", content: [{ type: "text", text: "d" }] },
  ];
  const out = trimHistory(msgs, 4);
  assert.equal(out[0].role, "user");
  assert.equal(out[0].content, "c");
});

test("memoria permanente: agregar y olvidar", () => {
  notes.add("el contador se llama Jorge");
  notes.add("la reunión de obra es los lunes");
  assert.match(notes.read(), /Jorge/);
  assert.equal(notes.remove("jorge"), 1);
  assert.doesNotMatch(notes.read(), /Jorge/);
  assert.match(notes.read(), /lunes/);
});

test("extractBody: prefiere texto plano, limpia HTML y lista adjuntos", () => {
  const b64 = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
  const htmlOnly = { mimeType: "text/html", body: { data: b64("<p>Hola <b>Alejandro</b></p><p>Adjunto la cotizaci&oacute;n</p>") } };
  const r1 = extractBody(htmlOnly);
  assert.match(r1.body, /Hola Alejandro/);
  const multi = {
    mimeType: "multipart/mixed",
    parts: [
      { mimeType: "multipart/alternative", parts: [
        { mimeType: "text/plain", body: { data: b64("Texto plano ✔") } },
        { mimeType: "text/html", body: { data: b64("<p>html</p>") } },
      ] },
      { mimeType: "application/pdf", filename: "planos.pdf", body: { attachmentId: "att1" } },
    ],
  };
  const r2 = extractBody(multi);
  assert.equal(r2.body, "Texto plano ✔");
  assert.deepEqual(r2.attachments, ["planos.pdf"]);
});

test("podcasts: lee episodios de un feed RSS", async () => {
  const { parseFeed } = await import("../server/tools/media.js");
  const xml = `<rss><channel><title>Show</title>
    <item><title><![CDATA[Episodio 2: Finanzas &amp; obra]]></title><pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate>
      <enclosure url="https://cdn.example.com/ep2.mp3?a=1&amp;b=2" type="audio/mpeg"/></item>
    <item><title>Sin audio</title></item>
    <item><title>Episodio 1</title><enclosure url='https://cdn.example.com/ep1.mp3'/></item>
  </channel></rss>`;
  const eps = parseFeed(xml);
  assert.equal(eps.length, 2);
  assert.equal(eps[0].titulo, "Episodio 2: Finanzas & obra");
  assert.equal(eps[0].url, "https://cdn.example.com/ep2.mp3?a=1&b=2");
  assert.equal(eps[1].url, "https://cdn.example.com/ep1.mp3");
});

test("medios: la herramienta pasa el video a la app y el texto a Claude", async () => {
  const { buildToolset } = await import("../server/tools/index.js");
  const toolset = buildToolset();
  assert.ok(toolset.names.includes("poner_podcast"));
  assert.ok(toolset.names.includes("controlar_reproductor"));
  const r = await toolset.execute("controlar_reproductor", { accion: "pausar" });
  assert.equal(r.isError, false);
  assert.match(r.content, /pausar/);
  assert.deepEqual(r.media, { tipo: "control", accion: "pausar", segundos: 30 });

  let n = 0;
  const client = { messages: { async create() {
    n++;
    if (n === 1) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "controlar_reproductor", input: { accion: "detener" } }] };
    return { stop_reason: "end_turn", content: [{ type: "text", text: "Listo, lo cerré." }] };
  } } };
  const out = await runAgent({ sessionId: "media-test", message: "para el video" }, { client, toolset, system: "x" });
  assert.equal(out.reply, "Listo, lo cerré.");
  assert.equal(out.media.tipo, "control");
  assert.equal(out.media.accion, "detener");
});
