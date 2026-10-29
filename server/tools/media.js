// Videos de YouTube, podcasts y control del reproductor.
// Las herramientas devuelven { texto, media }: el texto va a Claude y "media" viaja a la app,
// que abre el video o el audio en su reproductor.
import { config } from "../config.js";

const UA = "Mozilla/5.0 (Jarvis personal assistant)";

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} de ${new URL(url).host}`);
  return res.json();
}

// ---------- Podcasts (buscador de Apple Podcasts, sin clave) ----------
function decodeXml(s = "") {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .trim();
}
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeXml(m[1]) : "";
}

/** Extrae los episodios (título, audio, fecha) de un feed RSS de podcast. */
export function parseFeed(xml, max = 30) {
  const items = [];
  const re = /<item[\s>][\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) && items.length < max) {
    const block = m[0];
    const enc = block.match(/<enclosure[^>]*\burl=["']([^"']+)["']/i);
    if (!enc) continue;
    items.push({
      titulo: tag(block, "title"),
      url: decodeXml(enc[1]),
      fecha: tag(block, "pubDate"),
      duracion: tag(block, "itunes:duration"),
    });
  }
  return items;
}

function normalize(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function pickEpisode(episodes, wanted) {
  if (!wanted) return episodes[0];
  const words = normalize(wanted).split(/\s+/).filter((w) => w.length > 2 && !["ultimo", "episodio", "capitulo", "nuevo"].includes(w));
  if (!words.length) return episodes[0];
  let best = null, bestScore = 0;
  for (const ep of episodes) {
    const t = normalize(ep.titulo);
    const score = words.filter((w) => t.includes(w)).length;
    if (score > bestScore) { best = ep; bestScore = score; }
  }
  return best || episodes[0];
}
function fechaCorta(f) {
  const d = new Date(f);
  return isNaN(d) ? "" : d.toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric", timeZone: config.timezone });
}

const podcastTool = {
  definition: {
    name: "poner_podcast",
    description:
      "Busca un podcast por nombre y reproduce un episodio en la app (por defecto el más reciente). Úsala cuando pidan escuchar un podcast. Devuelve también la lista de episodios recientes por si piden otro.",
    input_schema: {
      type: "object",
      properties: {
        programa: { type: "string", description: "Nombre del podcast o tema (ej. 'La Silla Vacía', 'podcast de finanzas personales')" },
        episodio: { type: "string", description: "Opcional: palabras del título del episodio que quieren. Vacío = el último." },
      },
      required: ["programa"],
    },
  },
  async execute({ programa, episodio }) {
    const q = new URLSearchParams({ media: "podcast", entity: "podcast", term: programa, country: "CO", limit: "5" });
    const data = await getJson(`https://itunes.apple.com/search?${q}`);
    const shows = (data.results || []).filter((r) => r.feedUrl);
    if (!shows.length) return `No encontré ningún podcast que coincida con "${programa}".`;
    const show = shows[0];
    const res = await fetch(show.feedUrl, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`No pude leer el feed del podcast (HTTP ${res.status}).`);
    const episodes = parseFeed(await res.text());
    if (!episodes.length) return `Encontré "${show.collectionName}" pero no tiene episodios con audio.`;
    const ep = pickEpisode(episodes, episodio);
    const lista = episodes.slice(0, 6).map((e, i) => `${i + 1}. ${e.titulo} (${fechaCorta(e.fecha)})`).join("\n");
    const otros = shows.slice(1, 4).map((s) => s.collectionName).join("; ");
    return {
      texto:
        `Reproduciendo en la app: "${ep.titulo}" de ${show.collectionName}, publicado ${fechaCorta(ep.fecha) || "sin fecha"}.\n` +
        `Episodios recientes:\n${lista}` +
        (otros ? `\nOtros podcasts parecidos: ${otros}` : ""),
      media: {
        tipo: "audio",
        url: ep.url,
        titulo: ep.titulo,
        subtitulo: show.collectionName,
        imagen: show.artworkUrl600 || show.artworkUrl100 || "",
      },
    };
  },
};

// ---------- YouTube (requiere YOUTUBE_API_KEY, gratis en Google Cloud) ----------
const videoTool = {
  definition: {
    name: "poner_video",
    description:
      "Busca un video en YouTube y lo reproduce en la pantalla de la app (recetas, tutoriales, música, noticias). Pasa 'busqueda', o 'video_id' si quieren uno de la lista que devolviste antes. Devuelve los otros resultados por si piden otro.",
    input_schema: {
      type: "object",
      properties: {
        busqueda: { type: "string", description: "Qué buscar en YouTube (ej. 'receta ajiaco santafereño')" },
        video_id: { type: "string", description: "ID de un video de una lista anterior, para poner ese directamente" },
      },
      required: [],
    },
  },
  async execute({ busqueda, video_id }) {
    const key = config.youtubeKey;
    if (video_id) {
      const q = new URLSearchParams({ part: "snippet", id: video_id, key });
      const data = await getJson(`https://www.googleapis.com/youtube/v3/videos?${q}`);
      const v = data.items?.[0];
      if (!v) return `No encontré el video ${video_id}.`;
      return {
        texto: `Reproduciendo en pantalla: "${decodeXml(v.snippet.title)}" de ${v.snippet.channelTitle}.`,
        media: { tipo: "youtube", id: video_id, titulo: decodeXml(v.snippet.title), subtitulo: v.snippet.channelTitle },
      };
    }
    if (!busqueda) return "ERROR: indica qué buscar.";
    const q = new URLSearchParams({
      part: "snippet", q: busqueda, type: "video", maxResults: "6", videoEmbeddable: "true",
      relevanceLanguage: "es", regionCode: "CO", safeSearch: "moderate", key,
    });
    const data = await getJson(`https://www.googleapis.com/youtube/v3/search?${q}`);
    const vids = (data.items || []).filter((i) => i.id?.videoId);
    if (!vids.length) return `No encontré videos para "${busqueda}".`;
    const first = vids[0];
    const lista = vids.map((v, i) => `${i + 1}. ${decodeXml(v.snippet.title)} — ${v.snippet.channelTitle} [video_id: ${v.id.videoId}]`).join("\n");
    return {
      texto: `Reproduciendo en pantalla el primer resultado. Resultados:\n${lista}`,
      media: { tipo: "youtube", id: first.id.videoId, titulo: decodeXml(first.snippet.title), subtitulo: first.snippet.channelTitle },
    };
  },
};

// ---------- Control del reproductor ----------
const controlTool = {
  definition: {
    name: "controlar_reproductor",
    description: "Controla el video o podcast que está sonando en la app: pausar, reanudar, detener (cerrar), adelantar o retroceder unos segundos.",
    input_schema: {
      type: "object",
      properties: {
        accion: { type: "string", enum: ["pausar", "reanudar", "detener", "adelantar", "retroceder"] },
        segundos: { type: "number", description: "Para adelantar o retroceder (por defecto 30)" },
      },
      required: ["accion"],
    },
  },
  async execute({ accion, segundos }) {
    return {
      texto: `Listo: ${accion} enviado al reproductor.`,
      media: { tipo: "control", accion, segundos: Number(segundos) || 30 },
    };
  },
};

export function mediaTools() {
  const tools = [podcastTool, controlTool];
  if (config.youtubeKey) tools.unshift(videoTool);
  return tools;
}
