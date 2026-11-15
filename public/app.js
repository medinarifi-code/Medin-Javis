import { Orb } from "./orb.js";

const $ = (id) => document.getElementById(id);
const orb = new Orb($("orb"));
window.__orb = orb; // für Tests / Konsole

const sessionId = (() => {
  try {
    let id = localStorage.getItem("jarvis-session");
    if (!id) localStorage.setItem("jarvis-session", (id = crypto.randomUUID()));
    return id;
  } catch {
    return "default";
  }
})();

let status = { ai: false, mail: false, voice: false, userName: "Sir" };
let busy = false;

// ─── Zustand & Anzeige ────────────────────────────────────────────
const STATE_LABELS = { idle: "BEREIT", listening: "HÖRT ZU", thinking: "ANALYSIERT", speaking: "SPRICHT", error: "FEHLER" };
let currentState = "idle";
function setState(s) {
  currentState = s;
  orb.setState(s);
  $("state-label").textContent = STATE_LABELS[s] || s.toUpperCase();
}

function log(kind, text) {
  const el = document.createElement("div");
  el.className = `msg ${kind}`;
  if (kind === "user" || kind === "jarvis") {
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = kind === "user" ? status.userName.toUpperCase() : "J.A.R.V.I.S.";
    el.append(who, document.createTextNode(text));
  } else {
    el.textContent = text;
  }
  $("log").append(el);
  $("log").scrollTop = $("log").scrollHeight;
}

function setTranscript(text) {
  $("transcript").textContent = text;
}

function tickClock() {
  const now = new Date();
  $("clock-time").textContent = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  $("clock-date").textContent = now.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}
setInterval(tickClock, 1000);
tickClock();

// ─── Audio-Analyse (Mikrofon + Stimme lassen den Orb pulsieren) ────
let audioCtx, analyser, micStream;
const levelBuf = new Uint8Array(256);

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
}

async function ensureMic() {
  ensureAudio();
  if (micStream) return;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx.createMediaStreamSource(micStream).connect(analyser);
  } catch {
    /* Pegelanzeige ohne Mikrofonzugriff nicht möglich – Spracherkennung kann trotzdem laufen */
  }
}

let fakeSpeech = false;
(function levelLoop() {
  requestAnimationFrame(levelLoop);
  if (fakeSpeech) {
    const t = performance.now() / 1000;
    orb.setLevel(0.35 + 0.25 * Math.abs(Math.sin(t * 9)) * Math.abs(Math.sin(t * 2.3)));
    return;
  }
  if (!analyser || (currentState !== "listening" && currentState !== "speaking")) {
    orb.setLevel(0);
    return;
  }
  analyser.getByteTimeDomainData(levelBuf);
  let sum = 0;
  for (const v of levelBuf) sum += ((v - 128) / 128) ** 2;
  orb.setLevel(Math.min(1, Math.sqrt(sum / levelBuf.length) * 5));
})();

// ─── Sprachausgabe ────────────────────────────────────────────────
let currentAudio = null;

function pickVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("de"));
  return (
    voices.find((v) => /male|männ|conrad|stefan|markus|daniel|google deutsch/i.test(v.name)) ||
    voices[0] ||
    null
  );
}

async function speak(text) {
  stopSpeaking();
  setState("speaking");
  try {
    if (status.voice) {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.status === 200) {
        const url = URL.createObjectURL(await res.blob());
        ensureAudio();
        const audio = new Audio(url);
        currentAudio = audio;
        const src = audioCtx.createMediaElementSource(audio);
        src.connect(analyser);
        src.connect(audioCtx.destination);
        await new Promise((resolve) => {
          audio.onended = audio.onerror = audio.onpause = resolve;
          audio.play().catch(resolve);
        });
        URL.revokeObjectURL(url);
        return;
      }
    }
    await browserSpeak(text);
  } finally {
    currentAudio = null;
    fakeSpeech = false;
    if (currentState === "speaking") setState("idle");
  }
}

function browserSpeak(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "de-DE";
    u.voice = pickVoice();
    u.rate = 1.02;
    u.pitch = 0.85;
    u.onstart = () => (fakeSpeech = true);
    u.onend = u.onerror = () => {
      fakeSpeech = false;
      resolve();
    };
    speechSynthesis.speak(u);
  });
}

function stopSpeaking() {
  if (currentAudio) currentAudio.pause();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  fakeSpeech = false;
}

// ─── Kommunikation mit dem Server ─────────────────────────────────
async function ask(text) {
  text = text.trim();
  if (!text || busy) return;
  busy = true;
  stopListening();
  stopSpeaking();
  log("user", text);
  setTranscript(`„${text}“`);
  setState("thinking");
  $("activity").textContent = "VERARBEITE …";

  let reply = null;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, sessionId }),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop();
      for (const part of parts) {
        if (!part.startsWith("data: ")) continue;
        const ev = JSON.parse(part.slice(6));
        if (ev.type === "tool") {
          $("activity").textContent = ev.label.toUpperCase();
          log("sys", `› ${ev.label} …`);
        } else if (ev.type === "goals_changed") {
          loadGoals();
        } else if (ev.type === "reply") {
          reply = ev.text;
        } else if (ev.type === "error") {
          throw new Error(ev.text);
        }
      }
    }
    if (reply) {
      log("jarvis", reply);
      setTranscript(reply);
      $("activity").textContent = "—";
      await speak(reply);
    }
    if (/mail/i.test(text)) loadMails();
  } catch (err) {
    setState("error");
    log("err", `Fehler: ${err.message}`);
    setTranscript(err.message);
    $("activity").textContent = "FEHLER";
    setTimeout(() => currentState === "error" && setState("idle"), 2500);
  } finally {
    busy = false;
    if (currentState !== "error") setState("idle");
    if (wakeMode) startListening();
  }
}

// ─── Spracherkennung ──────────────────────────────────────────────
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listening = false;
let wakeMode = false;
let awaitingCommand = false;

if (SR) {
  recognition = new SR();
  recognition.lang = "de-DE";
  recognition.interimResults = true;

  recognition.onresult = (e) => {
    let interim = "", final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (!wakeMode || awaitingCommand) setTranscript(interim || final);
    if (!final) return;

    if (!wakeMode) return ask(final);

    const m = final.match(/\b(jarvis|dschawis|tschawis|jervis)\b[,.!?]?\s*(.*)/i);
    if (awaitingCommand) {
      awaitingCommand = false;
      return ask(final);
    }
    if (m) {
      if (m[2].trim().length > 1) return ask(m[2]);
      awaitingCommand = true;
      setState("listening");
      setTranscript("Ja, " + status.userName + "?");
    }
  };

  recognition.onend = () => {
    listening = false;
    if (currentState === "listening" && !busy) setState("idle");
    if (wakeMode && !busy && currentState !== "speaking") {
      setTimeout(() => wakeMode && !busy && startListening(), 250);
    }
  };

  recognition.onerror = (e) => {
    if (e.error === "not-allowed") {
      log("err", "Mikrofonzugriff verweigert. Bitte im Browser erlauben.");
      setWake(false);
    }
  };
}

async function startListening() {
  if (!recognition) {
    log("err", "Spracherkennung wird von diesem Browser nicht unterstützt – bitte Chrome oder Edge nutzen. Du kannst unten tippen.");
    return;
  }
  if (listening || busy) return;
  await ensureMic();
  recognition.continuous = wakeMode;
  try {
    recognition.start();
    listening = true;
    if (!wakeMode) {
      setState("listening");
      setTranscript("Ich höre …");
    }
  } catch {
    /* läuft bereits */
  }
}

function stopListening() {
  if (recognition && listening) recognition.abort();
  listening = false;
}

function toggleListening() {
  ensureAudio();
  if (currentState === "speaking") {
    stopSpeaking();
    setState("idle");
    return;
  }
  if (wakeMode) {
    awaitingCommand = true;
    setState("listening");
    setTranscript("Ich höre …");
    startListening();
    return;
  }
  if (listening) {
    stopListening();
    setState("idle");
    setTranscript("");
  } else {
    startListening();
  }
}

function setWake(on) {
  wakeMode = on;
  awaitingCommand = false;
  $("wake-btn").classList.toggle("active", on);
  $("wake-btn").textContent = `WAKE-WORD: ${on ? "AN" : "AUS"}`;
  $("mode-label").textContent = on ? "„JARVIS“" : "MANUELL";
  $("hint").innerHTML = on
    ? "SAG <kbd>JARVIS</kbd> UND DANN DEINEN BEFEHL"
    : "KLICKE DEN ORB ODER DRÜCKE <kbd>LEERTASTE</kbd>";
  stopListening();
  if (on) startListening();
  else setState("idle");
}

// ─── Panels ───────────────────────────────────────────────────────
async function loadGoals() {
  try {
    const goals = await (await fetch("/api/goals")).json();
    const list = $("goal-list");
    list.replaceChildren();
    const active = goals.filter((g) => g.status !== "aufgegeben");
    $("goal-count").textContent = active.filter((g) => g.status === "aktiv").length;
    if (active.length === 0) {
      list.innerHTML = '<li class="empty">Noch keine Ziele. Sag mir, was du erreichen willst.</li>';
      return;
    }
    for (const g of active) {
      const li = document.createElement("li");
      if (g.status === "erreicht") li.classList.add("done");
      const title = document.createElement("div");
      title.className = "title";
      title.append(Object.assign(document.createElement("span"), { textContent: g.title }));
      title.append(Object.assign(document.createElement("span"), { textContent: `${g.progress}%` }));
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = [g.status.toUpperCase(), g.deadline ? `bis ${new Date(g.deadline).toLocaleDateString("de-DE")}` : null]
        .filter(Boolean)
        .join(" · ");
      const bar = document.createElement("div");
      bar.className = "progress";
      bar.innerHTML = `<span style="width:${Number(g.progress) || 0}%"></span>`;
      li.append(title, meta, bar);
      list.append(li);
    }
  } catch {
    /* Server nicht erreichbar */
  }
}

async function loadMails() {
  const list = $("mail-list");
  try {
    const data = await (await fetch("/api/emails/summary")).json();
    list.replaceChildren();
    if (!data.configured) {
      $("mail-count").textContent = "–";
      list.innerHTML = '<li class="empty">Postfach nicht verbunden (.env → IMAP).</li>';
      return;
    }
    if (data.error) {
      list.innerHTML = "";
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = `Verbindungsfehler: ${data.error}`;
      list.append(li);
      return;
    }
    $("mail-count").textContent = data.unreadCount ?? 0;
    if (data.emails.length === 0) list.innerHTML = '<li class="empty">Posteingang leer.</li>';
    for (const m of data.emails) {
      const li = document.createElement("li");
      if (m.unread) li.classList.add("unread");
      const title = document.createElement("div");
      title.className = "title";
      title.append(Object.assign(document.createElement("span"), { textContent: m.subject }));
      const meta = document.createElement("div");
      meta.className = "meta";
      const when = m.date ? new Date(m.date).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
      meta.textContent = `${m.from.replace(/<.*>/, "").trim()} · ${when}`;
      li.append(title, meta);
      list.append(li);
    }
  } catch {
    list.innerHTML = '<li class="empty">Server nicht erreichbar.</li>';
  }
}

async function loadStatus() {
  try {
    status = await (await fetch("/api/status")).json();
  } catch {
    log("err", "Server nicht erreichbar. Läuft „npm start“?");
    return;
  }
  const mark = (id, ok, warn) => {
    $(id).classList.toggle("on", ok);
    $(id).classList.toggle("warn", !ok && warn);
  };
  mark("sys-ai", status.ai, true);
  mark("sys-voice", true, false);
  $("sys-voice").lastChild.textContent = status.voice ? "STIMME · PREMIUM" : "STIMME · BROWSER";
  mark("sys-mail", status.mail, true);

  if (!status.ai) log("err", "KI-Kern offline: ANTHROPIC_API_KEY in .env eintragen und Server neu starten.");
  const hour = new Date().getHours();
  const greet = hour < 11 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";
  log("jarvis", `${greet}, ${status.userName}. Alle Systeme sind online. Wie kann ich helfen?`);
}

// ─── Bedienung ────────────────────────────────────────────────────
$("orb").addEventListener("click", toggleListening);
$("wake-btn").addEventListener("click", () => {
  ensureAudio();
  setWake(!wakeMode);
});
$("text-form").addEventListener("submit", (e) => {
  e.preventDefault();
  ensureAudio();
  const input = $("text-input");
  ask(input.value);
  input.value = "";
});
$("reset-btn").addEventListener("click", async () => {
  await fetch("/api/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
  $("log").replaceChildren();
  setTranscript("");
  log("sys", "Gesprächsspeicher gelöscht.");
});
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && document.activeElement !== $("text-input")) {
    e.preventDefault();
    toggleListening();
  }
  if (e.code === "Escape") {
    stopSpeaking();
    stopListening();
    setState("idle");
  }
});
if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => {};

loadStatus();
loadGoals();
loadMails();
setInterval(loadMails, 120000);
