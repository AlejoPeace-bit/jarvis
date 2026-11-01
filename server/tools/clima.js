// Clima con Open-Meteo (gratis, sin clave). Coordenadas en WEATHER_LAT / WEATHER_LON.
import { config } from "../config.js";

const CODES = {
  0: "despejado", 1: "mayormente despejado", 2: "parcialmente nublado", 3: "nublado",
  45: "niebla", 48: "niebla con escarcha", 51: "llovizna ligera", 53: "llovizna", 55: "llovizna fuerte",
  61: "lluvia ligera", 63: "lluvia", 65: "lluvia fuerte", 66: "lluvia helada", 67: "lluvia helada fuerte",
  71: "nieve ligera", 73: "nieve", 75: "nieve fuerte", 77: "granizo fino", 80: "chubascos ligeros", 81: "chubascos",
  82: "chubascos fuertes", 85: "nevadas", 86: "nevadas fuertes", 95: "tormenta", 96: "tormenta con granizo", 99: "tormenta fuerte con granizo",
};
export function describe(code) {
  return CODES[code] || "variable";
}

let cache = { at: 0, data: null };

export async function getWeather() {
  if (cache.data && Date.now() - cache.at < 10 * 60_000) return cache.data;
  const { lat, lon, lugar } = config.weather;
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lon), timezone: config.timezone,
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
    forecast_days: "2",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
  if (!res.ok) throw new Error(`Open-Meteo respondió ${res.status}`);
  const j = await res.json();
  const c = j.current || {}, d = j.daily || {};
  const data = {
    lugar,
    temperatura: Math.round(c.temperature_2m),
    sensacion: Math.round(c.apparent_temperature),
    humedad: c.relative_humidity_2m,
    viento: Math.round(c.wind_speed_10m),
    codigo: c.weather_code,
    descripcion: describe(c.weather_code),
    hoy: { max: Math.round(d.temperature_2m_max?.[0]), min: Math.round(d.temperature_2m_min?.[0]), lluvia: d.precipitation_probability_max?.[0], descripcion: describe(d.weather_code?.[0]) },
    manana: { max: Math.round(d.temperature_2m_max?.[1]), min: Math.round(d.temperature_2m_min?.[1]), lluvia: d.precipitation_probability_max?.[1], descripcion: describe(d.weather_code?.[1]) },
  };
  cache = { at: Date.now(), data };
  return data;
}

export const climaTools = [
  {
    definition: {
      name: "clima",
      description: "Clima actual y pronóstico de hoy y mañana en la ciudad del usuario (temperatura, lluvia, viento). Úsala para '¿va a llover?', '¿cómo está el clima?', '¿llevo sombrilla?'.",
      input_schema: { type: "object", properties: {}, required: [] },
    },
    async execute() {
      const w = await getWeather();
      return (
        `${w.lugar}: ${w.temperatura}°C (sensación ${w.sensacion}°C), ${w.descripcion}, humedad ${w.humedad}%, viento ${w.viento} km/h. ` +
        `Hoy: máx ${w.hoy.max}°C, mín ${w.hoy.min}°C, ${w.hoy.descripcion}, probabilidad de lluvia ${w.hoy.lluvia}%. ` +
        `Mañana: máx ${w.manana.max}°C, mín ${w.manana.min}°C, ${w.manana.descripcion}, lluvia ${w.manana.lluvia}%.`
      );
    },
  },
];
