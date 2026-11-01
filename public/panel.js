/* Panel de la casa — tablet en la pared de la cocina, con Jarvis adentro.
   Usa la clave del panel (PANEL_PASSWORD), que solo tiene permisos de casa: nada de correo ni memoria. */
(() => {
  const $ = (id) => document.getElementById(id);
  const orb = $("orb"), statusEl = $("status"), transcript = $("transcript"), dlg = $("settings");

  // ---------- Ajustes (en la tablet) ----------
  const store = {
    get key() { return localStorage.getItem("panel_key") || ""; },
    set key(v) { localStorage.setItem("panel_key", v); },
    get sessionId() {
      let s = localStorage.getItem("panel_session");
      if (!s) { s = crypto.randomUUID(); localStorage.setItem("panel_session", s); }
      return s;
    },
    resetSession() { localStorage.removeItem("panel_session"); },
    get voiceOn() { return localStorage.getItem("panel_voice") !== "0"; },
    set voiceOn(v) { localStorage.setItem("panel_voice", v ? "1" : "0"); },
    get wakeOn() { return localStorage.getItem("panel_wake") !== "0"; },
    set wakeOn(v) { localStorage.setItem("panel_wake", v ? "1" : "0"); },
    get rate() { return Number(localStorage.getItem("panel_rate") || 1); },
    set rate(v) { localStorage.setItem("panel_rate", String(v)); },
  };

  let assistantName = "Jarvis";
  let busy = false, serverVoice = false, wakeKey = "";
  let panelData = null;

  const setState = (state, text) => {
    orb.className = "orb" + (state ? " " + state : "");
    if (text !== undefined) statusEl.textContent = text;
  };
  const showTranscript = (user, bot) => {
    transcript.innerHTML = "";
    if (user) { const u = document.createElement("span"); u.className = "u"; u.textContent = "“" + user + "”  "; transcript.appendChild(u); }
    if (bot) transcript.appendChild(document.createTextNode(bot));
  };

  // ---------- API ----------
  async function api(path, body) {
    const res = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + store.key },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  // ---------- Reloj ----------
  function tickClock() {
    const now = new Date();
    $("time").textContent = now.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", hour12: false });
    const d = now.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
    $("date").textContent = d.charAt(0).toUpperCase() + d.slice(1);
  }
  setInterval(tickClock, 1000); tickClock();

  // ---------- Datos del panel ----------
  const WICON = { 0: "☀️", 1: "🌤", 2: "⛅", 3: "☁️", 45: "🌫", 48: "🌫", 51: "🌦", 53: "🌦", 55: "🌧", 61: "🌧", 63: "🌧", 65: "🌧", 80: "🌦", 81: "🌧", 82: "⛈", 95: "⛈", 96: "⛈", 99: "⛈" };
  const pesos = (n) => "$" + Math.round(n).toLocaleString("es-CO");

  function renderWeather(w) {
    if (!w || w.error) { $("wDesc").textContent = "Clima no disponible"; return; }
    $("wIcon").textContent = WICON[w.codigo] || "🌡";
    $("wTemp").textContent = w.temperatura;
    $("wDesc").textContent = `${w.descripcion} · ${w.lugar}`;
    $("wMax").textContent = w.hoy.max; $("wMin").textContent = w.hoy.min;
    $("wRain").textContent = w.hoy.lluvia ?? "--"; $("wHum").textContent = w.humedad ?? "--";
    $("wTomorrow").textContent = `${w.manana.max}° / ${w.manana.min}°, ${w.manana.descripcion}, lluvia ${w.manana.lluvia}%`;
  }
  function renderAgenda(items) {
    const ul = $("agenda"); ul.innerHTML = "";
    if (!items || items.error) { ul.innerHTML = `<li class="muted">${items?.error || "Sin datos"}</li>`; return; }
    if (!items.length) { ul.innerHTML = '<li class="muted">Nada agendado. Día libre.</li>'; return; }
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    for (const e of items) {
      const li = document.createElement("li");
      const m = String(e.inicio).match(/(\d{2}):(\d{2})/);
      const when = e.inicio.includes("todo el día") ? "Todo el día" : (m ? `${m[1]}:${m[2]}` : "");
      const endM = String(e.fin).match(/(\d{2}):(\d{2})/);
      if (endM && Number(endM[1]) * 60 + Number(endM[2]) < nowMin) li.classList.add("past");
      li.innerHTML = `<span class="when">${when}</span><span class="what"><b></b>${e.lugar ? "<small></small>" : ""}</span>`;
      li.querySelector("b").textContent = e.titulo;
      if (e.lugar) li.querySelector("small").textContent = e.lugar;
      ul.appendChild(li);
    }
  }
  function renderShopping(items) {
    const ul = $("shopping"); ul.innerHTML = "";
    if (!items.length) { ul.innerHTML = '<li class="muted">Lista vacía. “Jarvis, agrega leche a la lista”.</li>'; return; }
    for (const it of [...items].sort((a, b) => a.hecho - b.hecho)) {
      const li = document.createElement("li");
      li.className = it.hecho ? "done" : "";
      li.innerHTML = `<span class="box">${it.hecho ? "✓" : ""}</span><span></span>`;
      li.lastChild.textContent = it.texto;
      li.addEventListener("click", async () => {
        try { renderShopping((await api("/api/lista", { accion: "alternar", id: it.id })).lista); } catch {}
      });
      ul.appendChild(li);
    }
  }
  function renderSpend(g) {
    const card = $("spend");
    if (!g || g.error) { card.hidden = true; return; }
    card.hidden = false;
    $("spendMonth").textContent = g.mes;
    $("spendTotal").textContent = pesos(g.total);
    $("spendCats").innerHTML = Object.entries(g.porCategoria).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([c, v]) => `<span>${c.replace(/</g, "")} ${pesos(v)}</span>`).join("");
  }
  const DICON = { light: "💡", switch: "🔌", fan: "🌀", climate: "❄️", input_boolean: "🔘" };
  function renderHome(devs) {
    const card = $("homeCard");
    if (!devs || devs.error || !devs.length) { card.hidden = true; return; }
    card.hidden = false;
    const box = $("devices"); box.innerHTML = "";
    for (const d of devs) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "dev" + (["on", "heat", "cool"].includes(d.estado) ? " on" : "");
      b.innerHTML = `<span class="d-icon">${DICON[d.dominio] || "⚙️"}</span><span></span><small>${d.estado === "on" ? "Encendido" : d.estado === "off" ? "Apagado" : d.estado}</small>`;
      b.children[1].textContent = d.nombre;
      b.addEventListener("click", async () => {
        b.disabled = true;
        try { renderHome((await api("/api/casa", { entity_id: d.entity_id, servicio: "toggle" })).casa); } catch (e) { setState("error", e.message); }
        b.disabled = false;
      });
      box.appendChild(b);
    }
  }

  async function refresh() {
    try {
      panelData = await api("/api/panel");
      assistantName = panelData.nombre || "Jarvis";
      serverVoice = Boolean(panelData.voz);
      wakeKey = panelData.wake?.picovoiceKey || "";
      renderWeather(panelData.clima);
      renderAgenda(panelData.agenda);
      renderShopping(panelData.lista);
      renderSpend(panelData.gasto);
      renderHome(panelData.casa);
      timers = panelData.temporizadores || [];
      renderTimers();
      if (!busy && !listening) setState("", "Listo");
      ensureWakeWord();
    } catch (err) {
      setState("error", err.message);
      if (/clave/i.test(err.message) || !store.key) dlg.showModal();
    }
  }
  async function refreshPart(que) {
    try {
      if (que === "lista") renderShopping((await api("/api/lista", { accion: "ver" })).lista);
      else if (que === "temporizadores") { timers = (await api("/api/temporizador", {})).temporizadores; renderTimers(); }
    } catch {}
  }
  setInterval(refresh, 60_000);

  // Lista: agregar a mano y limpiar comprados
  $("shopForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const t = $("shopInput").value.trim();
    if (!t) return;
    $("shopInput").value = "";
    try { renderShopping((await api("/api/lista", { accion: "agregar", items: [t] })).lista); } catch {}
  });
  $("btnClearDone").addEventListener("click", async () => {
    try { renderShopping((await api("/api/lista", { accion: "limpiar_hechos" })).lista); } catch {}
  });

  // Videos y podcasts: buscador y accesos rápidos (van a Jarvis como si lo dijeras por voz)
  $("mediaForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("mediaInput").value.trim();
    if (!q) return;
    $("mediaInput").value = "";
    unlockAudio();
    send(/podcast|episodio/i.test(q) ? `Pon el podcast ${q}` : `Ponme un video de ${q}`);
  });
  $("mediaQuick").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-q]");
    if (b) { unlockAudio(); send(b.dataset.q); }
  });

  // ---------- Temporizadores ----------
  let timers = [], rung = new Set();
  const mmss = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (h ? h + ":" : "") + String(m).padStart(h ? 2 : 1, "0") + ":" + String(r).padStart(2, "0");
  };
  function renderTimers() {
    const box = $("timers");
    const now = Date.now();
    const live = timers.filter((t) => t.fin > now - 60_000);
    if (!live.length) { box.innerHTML = '<p class="muted empty">Ninguno activo</p>'; return; }
    box.innerHTML = "";
    for (const t of live) {
      const left = t.fin - now;
      const d = document.createElement("div");
      d.className = "timer" + (left <= 0 ? " done" : left < 60_000 ? " soon" : "");
      d.innerHTML = `<button type="button" class="t-x" title="Cancelar">✕</button><div class="t-name"></div><div class="t-left">${left <= 0 ? "¡Listo!" : mmss(left)}</div>`;
      d.querySelector(".t-name").textContent = t.nombre;
      d.querySelector(".t-x").addEventListener("click", async () => {
        try { timers = (await api("/api/temporizador", { id: t.id })).temporizadores; } catch {}
        rung.delete(t.id); renderTimers();
      });
      box.appendChild(d);
    }
  }
  function checkTimers() {
    const now = Date.now();
    for (const t of timers) {
      if (t.fin <= now && !rung.has(t.id)) { rung.add(t.id); ring(t); }
    }
    if (timers.length) renderTimers();
  }
  setInterval(checkTimers, 1000);

  let audioCtx = null, alarmTimer = null;
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t0 = audioCtx.currentTime;
      [0, 0.18, 0.36].forEach((off) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = "sine"; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, t0 + off); g.gain.exponentialRampToValueAtTime(0.5, t0 + off + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + off + 0.15);
        o.connect(g).connect(audioCtx.destination); o.start(t0 + off); o.stop(t0 + off + 0.16);
      });
    } catch {}
  }
  function ring(t) {
    $("alarmTitle").textContent = `${t.nombre}: ¡listo!`;
    $("alarm").hidden = false;
    player.pause();
    beep();
    clearInterval(alarmTimer);
    alarmTimer = setInterval(beep, 1500);
    speak(`Terminó el temporizador de ${t.nombre}.`);
    setTimeout(stopAlarm, 90_000); // se calla solo a los 90 s si nadie lo apaga
    api("/api/temporizador", { id: t.id }).then((r) => { timers = r.temporizadores; }).catch(() => {});
  }
  function stopAlarm() {
    clearInterval(alarmTimer); alarmTimer = null;
    $("alarm").hidden = true;
    timers = timers.filter((t) => t.fin > Date.now());
    renderTimers();
  }
  $("btnAlarmOk").addEventListener("click", stopAlarm);

  // ---------- Conversación ----------
  async function send(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    busy = true;
    if (!$("alarm").hidden) stopAlarm();
    showTranscript(text, "");
    setState("thinking", "Pensando…");
    try {
      const data = await api("/api/chat", { message: text, sessionId: store.sessionId });
      showTranscript(text, data.reply);
      const media = data.media || null;
      const after = () => {
        if (media) applyMedia(media);
        else if (pausedForListening) { pausedForListening = false; player.resume(); }
        afterTurn();
      };
      if (media) pausedForListening = false;
      if (store.voiceOn) speak(data.reply, after); else after();
    } catch (err) {
      showTranscript(text, "⚠ " + err.message);
      setState("error", "Error");
      setTimeout(() => { setState("", "Listo"); afterTurn(); }, 2500);
    } finally {
      busy = false;
    }
  }
  function afterTurn() { if (!listening) setState("", wakeActive ? `Di “${assistantName}” o toca el orbe` : "Toca el orbe para hablar"); wakeResume(); }

  // ---------- Voz de respuesta ----------
  const synth = window.speechSynthesis;
  let voices = [];
  const loadVoices = () => { voices = synth ? synth.getVoices() : []; };
  if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }
  function pickVoice() {
    if (!voices.length) loadVoices();
    const prefs = [/es-US/i, /es-MX/i, /es-CO/i, /es-419/i, /es-ES/i, /^es/i];
    for (const p of prefs) {
      const v = voices.find((x) => p.test(x.lang) && /google|natural|neural|premium|enhanced/i.test(x.name)) || voices.find((x) => p.test(x.lang));
      if (v) return v;
    }
    return null;
  }
  const cleanForSpeech = (t) => t.replace(/https?:\/\/\S+/g, "un enlace").replace(/[*_#`>~]/g, "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").replace(/\s+/g, " ").trim();
  function speak(text, after) {
    const done = () => { setState("", "Listo"); if (after) after(); };
    if (!synth || !text) { done(); return; }
    synth.cancel();
    const parts = cleanForSpeech(text).match(/[^.!?…]+[.!?…]*/g) || [text];
    const voice = pickVoice();
    let idx = 0;
    setState("speaking", "Hablando…");
    const next = () => {
      if (idx >= parts.length) { done(); return; }
      const u = new SpeechSynthesisUtterance(parts[idx++].trim());
      if (voice) u.voice = voice;
      u.lang = voice?.lang || "es-CO"; u.rate = store.rate; u.pitch = 0.95;
      u.onend = next; u.onerror = next;
      synth.speak(u);
    };
    next();
  }

  // ---------- Micrófono: grabar + Whisper en el servidor ----------
  let listening = false, mediaStream = null, recorder = null, chunks = [], vadTimer = null, discardRecording = false, pausedForListening = false;
  const canRecord = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  const pickMime = () => ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => window.MediaRecorder.isTypeSupported?.(m)) || "";

  async function startListening() {
    if (listening || busy) return;
    if (!serverVoice || !canRecord) { setState("error", "Falta la voz del servidor (GROQ_API_KEY)"); return; }
    if (synth?.speaking) synth.cancel();
    if (player.isPlaying()) { player.pause(); pausedForListening = true; }
    wakePause();
    try {
      if (!mediaStream) mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setState("error", "Sin permiso de micrófono"); wakeResume(); return;
    }
    const mime = pickMime();
    recorder = new MediaRecorder(mediaStream, mime ? { mimeType: mime } : undefined);
    chunks = []; discardRecording = false;
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    recorder.onstop = onRecordingStop;
    recorder.start(250);
    listening = true;
    $("btnMic").setAttribute("aria-pressed", "true");
    setState("listening", "Te escucho…");
    startVad();
  }
  function startVad() {
    const started = Date.now();
    let heardVoice = false, lastVoice = Date.now(), analyser = null, data = null;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      audioCtx.resume?.();
      const src = audioCtx.createMediaStreamSource(mediaStream);
      analyser = audioCtx.createAnalyser(); analyser.fftSize = 1024; src.connect(analyser);
      data = new Uint8Array(analyser.fftSize);
    } catch { analyser = null; }
    clearInterval(vadTimer);
    vadTimer = setInterval(() => {
      const now = Date.now();
      if (analyser) {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / data.length);
        if (rms > 0.025) { heardVoice = true; lastVoice = now; }
        if (heardVoice && now - lastVoice > 1300) return stopRecording();
        if (!heardVoice && now - started > 7000) { discardRecording = true; return stopRecording(); }
      } else if (now - started > 10000) return stopRecording();
      if (now - started > 45000) stopRecording();
    }, 100);
  }
  function stopRecording() {
    clearInterval(vadTimer); vadTimer = null;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }
  async function onRecordingStop() {
    listening = false;
    $("btnMic").setAttribute("aria-pressed", "false");
    const type = recorder?.mimeType || chunks[0]?.type || "audio/webm";
    const blob = new Blob(chunks, { type }); chunks = [];
    if (discardRecording || blob.size < 1500) { setState("", "No te escuché"); if (pausedForListening) { pausedForListening = false; player.resume(); } afterTurn(); return; }
    setState("thinking", "Transcribiendo…");
    try {
      const res = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": type.split(";")[0], Authorization: "Bearer " + store.key }, body: blob });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      const text = (data.text || "").trim().replace(/^(oye |hey |ok )?jarvis[,.!]?\s*/i, "");
      if (!text) { setState("", "No te escuché"); if (pausedForListening) { pausedForListening = false; player.resume(); } afterTurn(); return; }
      send(text);
    } catch (err) {
      setState("error", "No pude transcribir: " + err.message);
      setTimeout(afterTurn, 2500);
    }
  }
  $("btnMic").addEventListener("click", () => { unlockAudio(); listening ? stopRecording() : startListening(); });

  // ---------- Palabra de activación “Jarvis” (Picovoice Porcupine, corre en la tablet) ----------
  const PV = {
    porcupine: "https://unpkg.com/@picovoice/porcupine-web@3.0.3/dist/iife/index.js",
    wvp: "https://unpkg.com/@picovoice/web-voice-processor@4.0.9/dist/iife/index.js",
    model: "https://cdn.jsdelivr.net/gh/Picovoice/porcupine@v3.0/lib/common/porcupine_params.pv",
  };
  let wakeWorker = null, wakeActive = false, wakeLoading = false, wakePaused = false;
  const loadScript = (src) => new Promise((ok, fail) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => fail(new Error("No cargó " + src)); document.head.appendChild(s); });

  async function ensureWakeWord() {
    if (wakeActive || wakeLoading || !store.wakeOn || !wakeKey || !serverVoice) return;
    wakeLoading = true;
    try {
      if (!window.PorcupineWeb) await loadScript(PV.porcupine);
      if (!window.WebVoiceProcessor) await loadScript(PV.wvp);
      wakeWorker = await window.PorcupineWeb.PorcupineWorker.create(
        wakeKey,
        [{ builtin: window.PorcupineWeb.BuiltInKeyword.Jarvis, sensitivity: 0.6 }],
        () => { if (!listening && !busy) { beepShort(); startListening(); } },
        { publicPath: PV.model },
      );
      await window.WebVoiceProcessor.WebVoiceProcessor.subscribe(wakeWorker);
      wakeActive = true;
      setState("", `Di “${assistantName}” o toca el orbe`);
    } catch (err) {
      console.warn("Palabra de activación no disponible:", err);
      setState("", "Toca el orbe para hablar");
    } finally {
      wakeLoading = false;
    }
  }
  async function wakePause() {
    if (!wakeActive || wakePaused) return;
    wakePaused = true;
    try { await window.WebVoiceProcessor.WebVoiceProcessor.unsubscribe(wakeWorker); } catch {}
  }
  async function wakeResume() {
    if (!wakeActive || !wakePaused) return;
    wakePaused = false;
    try { await window.WebVoiceProcessor.WebVoiceProcessor.subscribe(wakeWorker); } catch {}
  }
  function beepShort() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t0 = audioCtx.currentTime;
      o.frequency.value = 1200; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      o.connect(g).connect(audioCtx.destination); o.start(t0); o.stop(t0 + 0.13);
    } catch {}
  }

  // ---------- Reproductor ----------
  const player = (() => {
    const box = $("player"), vidBox = $("playerVideo"), audio = $("playerAudio");
    let yt = null, ytReady = null, kind = null;
    const loadYT = () => ytReady || (ytReady = new Promise((resolve) => {
      window.onYouTubeIframeAPIReady = () => resolve(window.YT);
      const tag = document.createElement("script"); tag.src = "https://www.youtube.com/iframe_api"; tag.onerror = () => resolve(null); document.head.appendChild(tag);
    }));
    function show(media) {
      $("playerTitle").textContent = media.titulo || ""; $("playerSub").textContent = media.subtitulo || "";
      const img = $("playerImg"); img.hidden = !media.imagen; if (media.imagen) img.src = media.imagen;
      box.hidden = false;
    }
    const stopVideo = () => { try { yt?.stopVideo(); } catch {} vidBox.hidden = true; document.body.classList.remove("video-open"); };
    const stopAudio = () => { audio.pause(); audio.hidden = true; };
    const ended = () => { if (!kind) return; kind = null; afterTurn(); };
    audio.addEventListener("ended", ended);
    return {
      isPlaying() {
        if (kind === "audio") return !audio.paused && !audio.ended;
        if (kind === "youtube") { try { return [1, 3].includes(yt?.getPlayerState()); } catch { return false; } }
        return false;
      },
      pause() { if (kind === "audio") audio.pause(); else if (kind === "youtube") try { yt.pauseVideo(); } catch {} },
      resume() { if (kind === "audio") audio.play().catch(() => {}); else if (kind === "youtube") try { yt.playVideo(); } catch {} },
      seek(d) { if (kind === "audio") audio.currentTime = Math.max(0, audio.currentTime + d); else if (kind === "youtube") try { yt.seekTo(Math.max(0, yt.getCurrentTime() + d), true); } catch {} },
      close() { stopVideo(); stopAudio(); kind = null; box.hidden = true; },
      async playYouTube(media) {
        stopAudio(); show(media); vidBox.hidden = false; document.body.classList.add("video-open"); kind = "youtube";
        const YT = await loadYT();
        if (!YT) { $("ytFrame").outerHTML = `<iframe id="ytFrame" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(media.id)}?autoplay=1&playsinline=1&rel=0" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>`; return; }
        if (yt) { yt.loadVideoById(media.id); return; }
        yt = new YT.Player("ytFrame", { videoId: media.id, playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1 }, events: { onReady: (e) => e.target.playVideo(), onStateChange: (e) => { if (e.data === 0) ended(); } } });
      },
      playAudio(media) { stopVideo(); show(media); audio.hidden = false; kind = "audio"; audio.src = media.url; audio.play().catch(() => setState("", "Toca ▶ para reproducir")); },
    };
  })();
  function applyMedia(media) {
    if (!media) return;
    if (media.tipo === "youtube") player.playYouTube(media);
    else if (media.tipo === "audio") player.playAudio(media);
    else if (media.tipo === "refrescar") refreshPart(media.que);
    else if (media.tipo === "control") {
      const s = media.segundos || 30;
      if (media.accion === "pausar") player.pause();
      else if (media.accion === "reanudar") player.resume();
      else if (media.accion === "detener") player.close();
      else if (media.accion === "adelantar") { player.seek(s); player.resume(); }
      else if (media.accion === "retroceder") { player.seek(-s); player.resume(); }
    }
  }
  $("btnPlayerClose").addEventListener("click", () => { player.close(); pausedForListening = false; });

  // Android/Chrome exige un toque antes de poder sonar: lo tomamos del primer toque en la pantalla
  let unlocked = false;
  function unlockAudio() {
    if (unlocked) return; unlocked = true;
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume?.(); } catch {}
    try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; synth?.speak(u); } catch {}
  }
  document.addEventListener("pointerdown", unlockAudio, { once: true });

  // ---------- Ajustes ----------
  $("btnSettings").addEventListener("click", () => {
    $("setKey").value = store.key; $("setWake").checked = store.wakeOn; $("setVoice").checked = store.voiceOn;
    $("setRate").value = store.rate; $("rateLabel").textContent = store.rate.toFixed(2);
    api("/api/health").then((h) => {
      $("healthInfo").textContent = (h.rol === "admin" ? "⚠ Estás usando la clave principal. Para la tablet usa PANEL_PASSWORD. " : "Clave del panel (permisos limitados). ") + `Herramientas: ${h.herramientas.join(", ")}.`;
    }).catch(() => { $("healthInfo").textContent = ""; });
    dlg.showModal();
  });
  $("setRate").addEventListener("input", (e) => ($("rateLabel").textContent = Number(e.target.value).toFixed(2)));
  $("btnSaveSettings").addEventListener("click", () => {
    store.key = $("setKey").value.trim(); store.wakeOn = $("setWake").checked; store.voiceOn = $("setVoice").checked; store.rate = Number($("setRate").value);
    if (!store.wakeOn && wakeActive) location.reload();
    refresh();
  });
  $("btnReset").addEventListener("click", async () => {
    try { await api("/api/reset", { sessionId: store.sessionId }); } catch {}
    store.resetSession(); showTranscript("", ""); dlg.close();
  });

  // Mantener la pantalla encendida (si el navegador lo permite; Fully Kiosk lo maneja aparte)
  async function keepAwake() { try { await navigator.wakeLock?.request("screen"); } catch {} }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { keepAwake(); refresh(); } });
  keepAwake();

  if (!store.key) dlg.showModal();
  refresh();
})();
