/* Jarvis — cliente PWA: chat + voz (reconocimiento y síntesis del navegador) */
(() => {
  const $ = (id) => document.getElementById(id);
  const chat = $("chat"), input = $("input"), form = $("form");
  const btnMic = $("btnMic"), btnHandsFree = $("btnHandsFree"), btnSettings = $("btnSettings");
  const orb = $("orb"), statusEl = $("status"), chips = $("chips");
  const dlg = $("settings");

  // ---------- Estado / ajustes ----------
  const store = {
    get key() { return localStorage.getItem("jarvis_key") || ""; },
    set key(v) { localStorage.setItem("jarvis_key", v); },
    get sessionId() {
      let s = localStorage.getItem("jarvis_session");
      if (!s) { s = crypto.randomUUID(); localStorage.setItem("jarvis_session", s); }
      return s;
    },
    resetSession() { localStorage.removeItem("jarvis_session"); },
    get voiceOn() { return localStorage.getItem("jarvis_voice") !== "0"; },
    set voiceOn(v) { localStorage.setItem("jarvis_voice", v ? "1" : "0"); },
    get voiceName() { return localStorage.getItem("jarvis_voice_name") || ""; },
    set voiceName(v) { localStorage.setItem("jarvis_voice_name", v); },
    get rate() { return Number(localStorage.getItem("jarvis_rate") || 1); },
    set rate(v) { localStorage.setItem("jarvis_rate", String(v)); },
    get handsFree() { return localStorage.getItem("jarvis_handsfree") === "1"; },
    set handsFree(v) { localStorage.setItem("jarvis_handsfree", v ? "1" : "0"); },
  };

  let assistantName = "Jarvis";
  let busy = false;

  const setState = (state, text) => {
    orb.className = "orb" + (state ? " " + state : "");
    if (text !== undefined) statusEl.textContent = text;
  };

  // ---------- UI de mensajes ----------
  function addMsg(text, who, opts = {}) {
    const div = document.createElement("div");
    div.className = `msg ${who}` + (opts.error ? " error" : "") + (opts.interim ? " interim" : "");
    div.textContent = text;
    if (opts.actions && opts.actions.length) {
      const wrap = document.createElement("div");
      wrap.className = "actions";
      for (const a of opts.actions) {
        const s = document.createElement("span");
        s.textContent = a.label;
        if (!a.ok) s.classList.add("fail");
        wrap.appendChild(s);
      }
      div.appendChild(wrap);
    }
    chat.querySelector(".welcome")?.remove();
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return div;
  }
  function addTyping() {
    const div = document.createElement("div");
    div.className = "msg bot";
    div.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return div;
  }
  function showWelcome() {
    chat.innerHTML = "";
    const w = document.createElement("div");
    w.className = "welcome";
    w.innerHTML = `<p>Hola, soy <b>${assistantName}</b>. Toca el micrófono y háblame, o escribe.</p>
      <div class="sug">
        <button type="button">¿Qué tengo hoy?</button>
        <button type="button">¿Correos importantes?</button>
        <button type="button">Agéndame una reunión mañana a las 10</button>
        <button type="button">Recuerda que…</button>
      </div>`;
    w.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      if (b.textContent.endsWith("…")) { input.value = "Recuerda que "; input.focus(); }
      else send(b.textContent);
    }));
    chat.appendChild(w);
  }

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

  async function checkHealth() {
    if (!store.key) { setState("", "Configura la clave en ajustes"); dlg.showModal(); return; }
    try {
      const h = await api("/api/health");
      assistantName = h.nombre || "Jarvis";
      serverVoice = Boolean(h.voz);
      updateMicAvailability();
      $("brandName").textContent = assistantName.toUpperCase();
      document.title = assistantName;
      const chip = (label, on, offLabel) => `<span class="${on ? "on" : "off"}">${on ? label : offLabel || label}</span>`;
      chips.innerHTML =
        chip("Google conectado", h.google?.conectado, h.google?.configurado ? "Google: falta autorizar" : "Google no configurado") +
        chip("n8n", h.n8n, "n8n sin flujos") +
        chip("Casa conectada", h.homeAssistant, "Casa pendiente") +
        chip("Voz del servidor", h.voz, "Voz del navegador");
      $("healthInfo").textContent = `Modelo: ${h.modelo}. Herramientas: ${h.herramientas.join(", ")}.`;
      setState("", "Listo");
      if (!chat.children.length) showWelcome();
    } catch (err) {
      setState("error", err.message);
      if (/clave/i.test(err.message)) dlg.showModal();
    }
  }

  async function send(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    busy = true;
    stopListening();
    addMsg(text, "user");
    input.value = "";
    const typing = addTyping();
    setState("thinking", "Pensando…");
    try {
      const data = await api("/api/chat", { message: text, sessionId: store.sessionId });
      typing.remove();
      addMsg(data.reply, "bot", { actions: data.actions });
      setState("", "Listo");
      const media = data.media || null;
      // Si pausamos algo para escucharte y no pediste nada nuevo del reproductor, sigue sonando
      const afterSpeech = media ? () => applyMedia(media) : (pausedForListening ? () => { pausedForListening = false; player.resume(); } : null);
      if (media) pausedForListening = false;
      if (store.voiceOn) speak(data.reply, afterSpeech);
      else if (afterSpeech) afterSpeech();
      else maybeAutoListen();
    } catch (err) {
      typing.remove();
      addMsg(err.message, "bot", { error: true });
      setState("error", "Error");
      setTimeout(() => setState("", "Listo"), 2500);
    } finally {
      busy = false;
    }
  }

  // ---------- Voz: síntesis ----------
  const synth = window.speechSynthesis;
  let voices = [];
  function loadVoices() {
    voices = synth ? synth.getVoices() : [];
    const sel = $("setVoiceName");
    const es = voices.filter((v) => /^es/i.test(v.lang));
    sel.innerHTML = '<option value="">Automática (español)</option>' +
      es.map((v) => `<option value="${v.name}">${v.name} (${v.lang})</option>`).join("");
    sel.value = store.voiceName;
  }
  if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }

  // iPhone/iPad: Safari solo permite hablar si la voz se "desbloquea" durante un toque del usuario.
  // Se llama en cada toque (micrófono, enviar, sugerencias); la respuesta llega después y ya puede sonar.
  let speechUnlocked = false;
  function unlockSpeech() {
    player.unlock();
    if (!synth || speechUnlocked) return;
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      u.lang = "es-CO";
      synth.speak(u);
      speechUnlocked = true;
    } catch { /* sin voz disponible */ }
  }

  function pickVoice() {
    if (!voices.length) voices = synth.getVoices();
    if (store.voiceName) { const v = voices.find((x) => x.name === store.voiceName); if (v) return v; }
    const prefs = [/es-US/i, /es-MX/i, /es-CO/i, /es-419/i, /es-ES/i, /^es/i];
    for (const p of prefs) {
      const v = voices.find((x) => p.test(x.lang) && /google|natural|neural|premium|enhanced/i.test(x.name)) || voices.find((x) => p.test(x.lang));
      if (v) return v;
    }
    return null;
  }
  function cleanForSpeech(t) {
    return t
      .replace(/https?:\/\/\S+/g, "un enlace")
      .replace(/[*_#`>~]/g, "")
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  function speak(text, after) {
    const done = () => { setState("", "Listo"); if (after) after(); else maybeAutoListen(); };
    if (!synth) { done(); return; }
    synth.cancel();
    const clean = cleanForSpeech(text);
    // Trocear por frases: evita que Chrome corte las locuciones largas
    const parts = clean.match(/[^.!?…]+[.!?…]*/g) || [clean];
    const voice = pickVoice();
    let idx = 0;
    setState("speaking", "Hablando…");
    const next = () => {
      if (idx >= parts.length) { done(); return; }
      const u = new SpeechSynthesisUtterance(parts[idx++].trim());
      if (voice) u.voice = voice;
      u.lang = voice?.lang || "es-CO";
      u.rate = store.rate;
      u.pitch = 0.95;
      u.onend = next;
      u.onerror = next;
      synth.speak(u);
    };
    next();
  }

  // ---------- Voz: reconocimiento ----------
  // Dos motores: (1) grabar y transcribir en el servidor con Whisper (preferido: funciona en iPhone,
  // app instalada y Fully Kiosk), (2) reconocimiento del navegador como respaldo.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const canRecord = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  let serverVoice = false; // lo activa checkHealth si el servidor tiene Whisper configurado
  let rec = null, listening = false, interimEl = null;

  function updateMicAvailability() {
    const available = (serverVoice && canRecord) || Boolean(rec);
    btnMic.hidden = !available;
    btnHandsFree.hidden = !available;
  }

  // --- Motor 1: grabación + Whisper en el servidor ---
  let mediaStream = null, recorder = null, chunks = [], audioCtx = null, vadTimer = null, discardRecording = false;

  function pickMime() {
    const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    return options.find((m) => window.MediaRecorder.isTypeSupported?.(m)) || "";
  }

  function releaseMic() {
    clearInterval(vadTimer); vadTimer = null;
    mediaStream?.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }

  async function startRecording() {
    try {
      if (!mediaStream) mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      addMsg("Necesito permiso del micrófono. Actívalo en los ajustes del navegador para hablar conmigo.", "bot", { error: true });
      return;
    }
    const mime = pickMime();
    recorder = new MediaRecorder(mediaStream, mime ? { mimeType: mime } : undefined);
    chunks = [];
    discardRecording = false;
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    recorder.onstop = onRecordingStop;
    recorder.start(250);
    listening = true;
    btnMic.setAttribute("aria-pressed", "true");
    setState("listening", "Escuchando… toca de nuevo para enviar");
    startVad();
  }

  // Detecta cuando terminas de hablar: tras haber voz, 1,3 s de silencio cierra la grabación.
  function startVad() {
    const started = Date.now();
    let heardVoice = false, lastVoice = Date.now();
    let analyser = null, data = null;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      audioCtx.resume?.();
      const src = audioCtx.createMediaStreamSource(mediaStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
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
        if (!heardVoice && now - started > 8000) { discardRecording = true; return stopRecording(); }
      } else if (now - started > 10000) {
        return stopRecording(); // sin medidor de volumen: corta a los 10 s
      }
      if (now - started > 45000) stopRecording();
    }, 100);
  }

  function stopRecording() {
    clearInterval(vadTimer); vadTimer = null;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  async function onRecordingStop() {
    listening = false;
    btnMic.setAttribute("aria-pressed", "false");
    if (!store.handsFree) releaseMic();
    const type = recorder?.mimeType || chunks[0]?.type || "audio/webm";
    const blob = new Blob(chunks, { type });
    chunks = [];
    if (discardRecording || blob.size < 1500) { setState("", "Listo"); return; }
    setState("thinking", "Transcribiendo…");
    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": type.split(";")[0], Authorization: "Bearer " + store.key },
        body: blob,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      const text = (data.text || "").trim();
      if (!text) { setState("", "No te escuché, intenta de nuevo"); maybeAutoListen(); return; }
      send(text);
    } catch (err) {
      addMsg("No pude transcribir el audio: " + err.message, "bot", { error: true });
      setState("error", "Error");
      setTimeout(() => setState("", "Listo"), 2500);
    }
  }

  // --- Motor 2: reconocimiento del navegador (respaldo) ---
  if (SR) {
    rec = new SR();
    rec.lang = "es-CO";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onstart = () => { listening = true; btnMic.setAttribute("aria-pressed", "true"); setState("listening", "Escuchando…"); };
    rec.onresult = (e) => {
      let finalText = "", interim = "";
      for (const r of e.results) (r.isFinal ? (finalText += r[0].transcript) : (interim += r[0].transcript));
      if (interim) {
        if (!interimEl) interimEl = addMsg("", "user", { interim: true });
        interimEl.textContent = interim;
      }
      if (finalText) {
        interimEl?.remove(); interimEl = null;
        send(finalText);
      }
    };
    rec.onerror = (e) => {
      interimEl?.remove(); interimEl = null;
      if (e.error === "not-allowed") addMsg("Necesito permiso del micrófono. Actívalo en el navegador para hablar conmigo.", "bot", { error: true });
      else if (e.error !== "no-speech" && e.error !== "aborted") addMsg("No te escuché bien: " + e.error, "bot", { error: true });
    };
    rec.onend = () => {
      listening = false;
      btnMic.setAttribute("aria-pressed", "false");
      if (!busy && !orb.classList.contains("speaking")) setState("", "Listo");
      interimEl?.remove(); interimEl = null;
    };
  }
  updateMicAvailability();

  function useServerVoice() { return serverVoice && canRecord; }
  function startListening() {
    if (listening || busy) return;
    if (synth?.speaking) synth.cancel();
    if (player.isPlaying()) { player.pause(); pausedForListening = true; }
    if (useServerVoice()) { startRecording(); return; }
    if (!rec) return;
    try { rec.start(); } catch { /* ya estaba iniciado */ }
  }
  function stopListening() {
    if (!listening) return;
    if (recorder && recorder.state !== "inactive") { stopRecording(); return; }
    if (rec) { try { rec.stop(); } catch {} }
  }
  function maybeAutoListen() {
    if (player.isPlaying()) return; // al terminar el video/podcast vuelve a escuchar
    if (store.handsFree && (useServerVoice() || rec) && document.visibilityState === "visible") setTimeout(startListening, 350);
  }

  // ---------- Reproductor: videos de YouTube y podcasts ----------
  const SILENT_WAV = "data:audio/wav;base64,UklGRpwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YXgAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIA=";
  let pausedForListening = false;
  const player = (() => {
    const box = $("player"), vidBox = $("playerVideo"), audio = $("playerAudio");
    let yt = null, ytReady = null, kind = null, audioUnlocked = false;

    function loadYT() {
      if (ytReady) return ytReady;
      ytReady = new Promise((resolve) => {
        window.onYouTubeIframeAPIReady = () => resolve(window.YT);
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        tag.onerror = () => resolve(null);
        document.head.appendChild(tag);
      });
      return ytReady;
    }
    function show(media) {
      $("playerTitle").textContent = media.titulo || "";
      $("playerSub").textContent = media.subtitulo || "";
      const img = $("playerImg");
      img.hidden = !media.imagen;
      if (media.imagen) img.src = media.imagen;
      box.hidden = false;
    }
    function stopVideo() { try { yt?.stopVideo(); } catch {} vidBox.hidden = true; }
    function stopAudio() { audio.pause(); audio.hidden = true; }
    function ended() { if (!kind) return; kind = null; setState("", "Listo"); maybeAutoListen(); }

    audio.addEventListener("ended", ended);

    return {
      // iPhone: el audio solo puede sonar solo si antes se "desbloqueó" con un toque
      unlock() {
        if (audioUnlocked) return;
        audioUnlocked = true;
        try {
          audio.src = SILENT_WAV;
          const p = audio.play();
          if (p) p.then(() => audio.pause()).catch(() => { audioUnlocked = false; });
        } catch { audioUnlocked = false; }
      },
      isPlaying() {
        if (kind === "audio") return !audio.paused && !audio.ended;
        if (kind === "youtube") { try { return yt?.getPlayerState() === 1 || yt?.getPlayerState() === 3; } catch { return false; } }
        return false;
      },
      pause() { if (kind === "audio") audio.pause(); else if (kind === "youtube") try { yt.pauseVideo(); } catch {} },
      resume() {
        if (kind === "audio") audio.play().catch(() => setState("", "Toca ▶ para continuar"));
        else if (kind === "youtube") try { yt.playVideo(); } catch {}
      },
      seek(delta) {
        if (kind === "audio") audio.currentTime = Math.max(0, audio.currentTime + delta);
        else if (kind === "youtube") try { yt.seekTo(Math.max(0, yt.getCurrentTime() + delta), true); } catch {}
      },
      close() { stopVideo(); stopAudio(); kind = null; box.hidden = true; },
      async playYouTube(media) {
        stopAudio();
        show(media);
        vidBox.hidden = false;
        kind = "youtube";
        const YT = await loadYT();
        if (!YT) { $("ytFrame").outerHTML = `<iframe id="ytFrame" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(media.id)}?autoplay=1&playsinline=1&rel=0" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>`; return; }
        if (yt) { yt.loadVideoById(media.id); return; }
        yt = new YT.Player("ytFrame", {
          videoId: media.id,
          playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1 },
          events: {
            onReady: (e) => e.target.playVideo(),
            onStateChange: (e) => { if (e.data === 0) ended(); },
          },
        });
      },
      playAudio(media) {
        stopVideo();
        show(media);
        audio.hidden = false;
        kind = "audio";
        audio.src = media.url;
        audio.play().catch(() => setState("", "Toca ▶ para reproducir"));
      },
    };
  })();

  function applyMedia(media) {
    if (!media) return;
    if (media.tipo === "youtube") player.playYouTube(media);
    else if (media.tipo === "audio") player.playAudio(media);
    else if (media.tipo === "control") {
      const s = media.segundos || 30;
      if (media.accion === "pausar") player.pause();
      else if (media.accion === "reanudar") player.resume();
      else if (media.accion === "detener") { player.close(); maybeAutoListen(); }
      else if (media.accion === "adelantar") { player.seek(s); player.resume(); }
      else if (media.accion === "retroceder") { player.seek(-s); player.resume(); }
    }
    if (media.tipo === "control" && media.accion === "pausar") maybeAutoListen();
  }
  $("btnPlayerClose").addEventListener("click", () => { player.close(); pausedForListening = false; });

  // ---------- Eventos ----------
  form.addEventListener("submit", (e) => { e.preventDefault(); unlockSpeech(); send(input.value); });
  btnMic.addEventListener("click", () => { unlockSpeech(); listening ? stopListening() : startListening(); });
  chat.addEventListener("click", unlockSpeech); // sugerencias de bienvenida
  document.addEventListener("touchend", unlockSpeech, { once: true });
  btnHandsFree.addEventListener("click", () => {
    store.handsFree = !store.handsFree;
    btnHandsFree.setAttribute("aria-pressed", String(store.handsFree));
    $("setAutoListen").checked = store.handsFree;
    if (store.handsFree) startListening();
  });
  btnSettings.addEventListener("click", () => {
    $("setKey").value = store.key;
    $("setVoice").checked = store.voiceOn;
    $("setRate").value = store.rate; $("rateLabel").textContent = store.rate.toFixed(2);
    $("setAutoListen").checked = store.handsFree;
    loadVoices();
    dlg.showModal();
  });
  $("setRate").addEventListener("input", (e) => ($("rateLabel").textContent = Number(e.target.value).toFixed(2)));
  $("btnSaveSettings").addEventListener("click", () => {
    store.key = $("setKey").value.trim();
    store.voiceOn = $("setVoice").checked;
    store.voiceName = $("setVoiceName").value;
    store.rate = Number($("setRate").value);
    store.handsFree = $("setAutoListen").checked;
    btnHandsFree.setAttribute("aria-pressed", String(store.handsFree));
    checkHealth();
  });
  $("btnReset").addEventListener("click", async () => {
    try { await api("/api/reset", { sessionId: store.sessionId }); } catch {}
    store.resetSession();
    showWelcome();
    dlg.close();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { discardRecording = true; stopListening(); releaseMic(); synth?.cancel(); }
  });

  // Atajo: barra espaciadora mantenida (en escritorio) para hablar
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && document.activeElement !== input && !dlg.open) { e.preventDefault(); startListening(); }
  });

  // ---------- PWA ----------
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

  btnHandsFree.setAttribute("aria-pressed", String(store.handsFree));
  checkHealth();
})();
