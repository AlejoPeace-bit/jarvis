// Gasto del mes leído de la hoja de finanzas (Google Sheets, solo lectura). Requiere FINANCE_SHEET_ID.
import { config } from "../config.js";
import { sheetsApi, isConnected } from "../google.js";
import { todayISO } from "./time.js";

let cache = { at: 0, data: null };

function parseValor(v) {
  if (typeof v === "number") return v;
  const s = String(v || "").replace(/[^\d,.-]/g, "");
  if (!s) return 0;
  // Formato colombiano: 1.250.000 o 1.250.000,50
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/\.(?=\d{3}(\D|$))/g, "");
  const n = Number(normalized);
  return isNaN(n) ? 0 : n;
}
function parseFecha(v) {
  const s = String(v || "").trim();
  let m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (m) return { y: Number(m[3]), m: Number(m[2]) };
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { y: Number(m[1]), m: Number(m[2]) };
  return null;
}

/** Suma los gastos del mes actual. Devuelve { mes, total, cantidad, porCategoria } o null si no está configurado. */
export async function getMonthSpend() {
  const { sheetId, gastosSheet } = config.finance;
  if (!sheetId || !isConnected()) return null;
  if (cache.data && Date.now() - cache.at < 5 * 60_000) return cache.data;
  const res = await sheetsApi().spreadsheets.values.get({ spreadsheetId: sheetId, range: `${gastosSheet}!A1:Z2000` });
  const rows = res.data.values || [];
  const hIdx = rows.findIndex((r) => r.some((c) => /fecha/i.test(c)) && r.some((c) => /valor/i.test(c)));
  if (hIdx === -1) throw new Error("No encontré las columnas Fecha y Valor en la hoja de gastos.");
  const header = rows[hIdx].map((c) => String(c).toLowerCase());
  const iFecha = header.findIndex((c) => c.includes("fecha"));
  const iValor = header.findIndex((c) => c.includes("valor"));
  const iCat = header.findIndex((c) => c.includes("categor"));
  const [y, m] = todayISO().split("-").map(Number);
  let total = 0, cantidad = 0;
  const porCategoria = {};
  for (const r of rows.slice(hIdx + 1)) {
    const f = parseFecha(r[iFecha]);
    if (!f || f.y !== y || f.m !== m) continue;
    const v = parseValor(r[iValor]);
    if (!v) continue;
    total += v;
    cantidad++;
    const cat = (iCat >= 0 && r[iCat]) || "Otros";
    porCategoria[cat] = (porCategoria[cat] || 0) + v;
  }
  const mes = new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric", timeZone: config.timezone }).format(new Date());
  const data = { mes, total, cantidad, porCategoria };
  cache = { at: Date.now(), data };
  return data;
}

const pesos = (n) => "$" + Math.round(n).toLocaleString("es-CO");

export function finanzasTools() {
  if (!config.finance.sheetId) return [];
  return [
    {
      definition: {
        name: "gasto_del_mes",
        description: "Cuánto se ha gastado en el mes actual según la hoja de finanzas familiar, total y por categoría. Úsala para '¿cuánto llevo gastado?', '¿cuánto va en mercado este mes?'.",
        input_schema: { type: "object", properties: {}, required: [] },
      },
      async execute() {
        const d = await getMonthSpend();
        if (!d) return "La hoja de finanzas no está conectada.";
        const cats = Object.entries(d.porCategoria).sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c}: ${pesos(v)}`).join(", ");
        return `Gasto de ${d.mes}: ${pesos(d.total)} en ${d.cantidad} movimientos. Por categoría: ${cats || "sin categorías"}.`;
      },
    },
  ];
}
