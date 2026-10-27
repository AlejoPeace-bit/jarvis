import { calendarApi } from "../google.js";
import { config } from "../config.js";

function fmt(dt) {
  if (!dt) return "";
  if (dt.date) return `${dt.date} (todo el día)`;
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: config.timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(dt.dateTime));
}

function plusOneHour(iso) {
  const d = new Date(iso);
  d.setHours(d.getHours() + 1);
  return d.toISOString();
}

export const calendarTools = [
  {
    definition: {
      name: "consultar_agenda",
      description:
        "Lista los eventos del calendario del usuario entre dos fechas. Úsala para '¿qué tengo hoy/mañana/esta semana?', '¿estoy libre el martes a las 3?'. Usa rangos completos: desde las 00:00 del primer día hasta las 23:59 del último.",
      input_schema: {
        type: "object",
        properties: {
          desde: { type: "string", description: "Inicio del rango en ISO 8601 con zona horaria, ej. 2026-10-20T00:00:00-05:00" },
          hasta: { type: "string", description: "Fin del rango en ISO 8601 con zona horaria, ej. 2026-10-20T23:59:59-05:00" },
        },
        required: ["desde", "hasta"],
      },
    },
    async execute({ desde, hasta }) {
      const res = await calendarApi().events.list({
        calendarId: "primary",
        timeMin: new Date(desde).toISOString(),
        timeMax: new Date(hasta).toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 30,
      });
      const items = res.data.items || [];
      if (!items.length) return "No hay eventos en ese rango.";
      return JSON.stringify(
        items.map((e) => ({
          id: e.id,
          titulo: e.summary || "(sin título)",
          inicio: fmt(e.start),
          fin: fmt(e.end),
          lugar: e.location || undefined,
          descripcion: e.description ? e.description.slice(0, 200) : undefined,
        })),
      );
    },
  },
  {
    definition: {
      name: "crear_evento",
      description:
        "Crea un evento en el calendario principal del usuario. Si no se indica duración, dura 1 hora. Si falta título, fecha u hora, pregunta antes de llamar esta herramienta.",
      input_schema: {
        type: "object",
        properties: {
          titulo: { type: "string", description: "Título corto del evento" },
          inicio: { type: "string", description: "Inicio en ISO 8601 con zona horaria, ej. 2026-10-21T10:00:00-05:00" },
          fin: { type: "string", description: "Fin en ISO 8601 con zona horaria. Omitir para 1 hora de duración." },
          lugar: { type: "string", description: "Lugar (opcional)" },
          descripcion: { type: "string", description: "Notas (opcional)" },
        },
        required: ["titulo", "inicio"],
      },
    },
    async execute({ titulo, inicio, fin, lugar, descripcion }) {
      const start = new Date(inicio).toISOString();
      const end = fin ? new Date(fin).toISOString() : plusOneHour(start);
      const res = await calendarApi().events.insert({
        calendarId: "primary",
        requestBody: {
          summary: titulo,
          location: lugar || undefined,
          description: descripcion || undefined,
          start: { dateTime: start, timeZone: config.timezone },
          end: { dateTime: end, timeZone: config.timezone },
        },
      });
      const e = res.data;
      return `Evento creado: "${e.summary}" — ${fmt(e.start)} a ${fmt(e.end)}${e.location ? " en " + e.location : ""}. Enlace: ${e.htmlLink}`;
    },
  },
  {
    definition: {
      name: "eliminar_evento",
      description: "Elimina un evento del calendario usando su id (obtenido con consultar_agenda). Confirma con el usuario antes de usarla.",
      input_schema: {
        type: "object",
        properties: { id: { type: "string", description: "Id del evento" } },
        required: ["id"],
      },
    },
    async execute({ id }) {
      await calendarApi().events.delete({ calendarId: "primary", eventId: id });
      return "Evento eliminado.";
    },
  },
];
