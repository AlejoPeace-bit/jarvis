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
      $("brandName").textContent = assistantName.toUpperCase();
      document.title = assistantName;
      const chip = (label, on, offLabel) => `<span class="${on ? "on" : "off"}">${on ? label : offLabel || label}</span>`;
      chips.innerHTML =
        chip("Google conectado", h.google?.conectado, h.google?.configurado ? "Google: falta autorizar" : "Google no configurado") +
        chip("n8n", h.n8n, "n8n sin flujos") +
        chip("Casa conectada", h.homeAssistant, "Casa pendiente");
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
      if (store.voiceOn) speak(data.reply); else maybeAutoListen();
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
  function speak(text) {
    if (!synth) { maybeAutoListen(); return; }
    synth.cancel();
    const clean = cleanForSpeech(text);
    // Trocear por frases: evita que Chrome corte las locuciones largas
    const parts = clean.match(/[^.!?…]+[.!?…]*/g) || [clean];
    const voice = pickVoice();
    let idx = 0;
    setState("speaking", "Hablando…");
    const next = () => {
      if (idx >= parts.length) { setState("", "Listo"); maybeAutoListen(); return; }
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
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false, interimEl = null;
  if (!SR) {
    btnMic.hidden = true;
    btnHandsFree.hidden = true;
  } else {
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
  function startListening() {
    if (!rec || listening || busy) return;
    synth?.cancel();
    try { rec.start(); } catch { /* ya estaba iniciado */ }
  }
  function stopListening() { if (rec && listening) { try { rec.stop(); } catch {} } }
  function maybeAutoListen() {
    if (store.handsFree && rec && document.visibilityState === "visible") setTimeout(startListening, 350);
  }

  // ---------- Eventos ----------
  form.addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });
  btnMic.addEventListener("click", () => (listening ? stopListening() : startListening()));
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
  document.addEventListener("visibilitychange", () => { if (document.hidden) { stopListening(); synth?.cancel(); } });

  // Atajo: barra espaciadora mantenida (en escritorio) para hablar
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && document.activeElement !== input && !dlg.open) { e.preventDefault(); startListening(); }
  });

  // ---------- PWA ----------
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

  btnHandsFree.setAttribute("aria-pressed", String(store.handsFree));
  checkHealth();
})();
