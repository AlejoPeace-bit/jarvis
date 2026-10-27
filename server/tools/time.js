import { config } from "../config.js";

export function nowText() {
  const now = new Date();
  const fecha = new Intl.DateTimeFormat("es-CO", {
    timeZone: config.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  const hora = new Intl.DateTimeFormat("es-CO", {
    timeZone: config.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return `${fecha}, ${hora} (${config.timezone})`;
}

/** Fecha ISO local (YYYY-MM-DD) en la zona horaria configurada. */
export function todayISO() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export const timeTools = [
  {
    definition: {
      name: "hora_actual",
      description: "Devuelve la fecha y hora actual en la zona horaria del usuario. Úsala si necesitas confirmar qué día es hoy antes de calcular fechas.",
      input_schema: { type: "object", properties: {}, required: [] },
    },
    async execute() {
      return `Ahora es ${nowText()}. Fecha ISO de hoy: ${todayISO()}.`;
    },
  },
];
