import "dotenv/config";
import express from "express";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chat, resetSession, goals } from "./agent.js";
import { listEmails, mailConfigured } from "./tools/mail.js";
import { synthesize, ttsConfigured } from "./tts.js";

const app = express();
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const host = process.env.HOST || "127.0.0.1";
const password = process.env.APP_PASSWORD || "";

// Online (nicht nur lokal) läuft Jarvis nur mit Passwortschutz.
if (host !== "127.0.0.1" && host !== "localhost" && !password) {
  console.error("  ✖  APP_PASSWORD fehlt. Ohne Passwort startet Jarvis nicht öffentlich.");
  process.exit(1);
}

if (password) {
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization || "").split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = Buffer.from(encoded, "base64").toString();
      if (decoded.slice(decoded.indexOf(":") + 1) === password) return next();
    }
    res.set("WWW-Authenticate", 'Basic realm="Jarvis", charset="UTF-8"');
    res.status(401).send("Passwort erforderlich");
  });
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(root, "public")));
app.use("/vendor", express.static(join(root, "node_modules", "three", "build")));

app.get("/api/status", (_req, res) => {
  res.json({
    ai: Boolean(process.env.ANTHROPIC_API_KEY),
    mail: mailConfigured(),
    voice: ttsConfigured(),
    userName: process.env.USER_NAME || "Sir",
  });
});

// Chat als Server-Sent Events: Werkzeug-Status live, dann die Antwort.
app.post("/api/chat", async (req, res) => {
  const { message, sessionId = "default" } = req.body ?? {};
  if (!message || typeof message !== "string") return res.status(400).json({ error: "message fehlt" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  try {
    const reply = await chat(sessionId, message, send);
    send({ type: "reply", text: reply });
  } catch (err) {
    console.error("[chat]", err);
    send({ type: "error", text: err.message || "Unbekannter Fehler" });
  }
  send({ type: "done" });
  res.end();
});

app.post("/api/reset", (req, res) => {
  resetSession(req.body?.sessionId || "default");
  res.json({ ok: true });
});

app.post("/api/tts", async (req, res) => {
  const text = req.body?.text;
  if (!ttsConfigured() || !text) return res.status(204).end();
  try {
    const stream = await synthesize(text.slice(0, 2500));
    res.setHeader("Content-Type", "audio/mpeg");
    Readable.fromWeb(stream).pipe(res);
  } catch (err) {
    console.error("[tts]", err.message);
    res.status(204).end(); // Browser fällt auf eigene Stimme zurück
  }
});

app.get("/api/goals", async (_req, res) => {
  try {
    res.json(await goals.list());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/emails/summary", async (_req, res) => {
  if (!mailConfigured()) return res.json({ configured: false, emails: [] });
  try {
    const data = await listEmails({ limit: 6 });
    const unread = await listEmails({ unread_only: true, limit: 1 });
    res.json({ configured: true, unreadCount: unread.total, emails: data.emails });
  } catch (err) {
    res.json({ configured: true, error: err.message, emails: [] });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, host, () => {
  console.log(`\n  J.A.R.V.I.S. online → http://localhost:${port}\n`);
  if (!process.env.ANTHROPIC_API_KEY) console.log("  ⚠  ANTHROPIC_API_KEY fehlt – bitte .env ausfüllen.");
  if (!mailConfigured()) console.log("  ⚠  E-Mail nicht eingerichtet (IMAP_HOST / MAIL_USER / MAIL_PASS).");
  if (!ttsConfigured()) console.log("  ℹ  Keine ElevenLabs-Stimme – Browser-Stimme wird benutzt.");
});
