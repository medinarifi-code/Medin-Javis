import Anthropic from "@anthropic-ai/sdk";
import { createGoalStore } from "./tools/goals.js";
import * as mail from "./tools/mail.js";

const goals = createGoalStore();

// ─── Persönlichkeit ─────────────────────────────────────────────────
function systemPrompt() {
  const name = process.env.USER_NAME || "Sir";
  return `Du bist J.A.R.V.I.S., der persönliche KI-Assistent von ${name}. Du bist höflich, ruhig, präzise und hast einen trockenen, britisch angehauchten Humor – wie der Assistent aus Iron Man. Sprich den Nutzer gelegentlich mit "${name}" an.

Deine Antworten werden laut vorgelesen. Deshalb:
- Antworte auf Deutsch (außer der Nutzer spricht eine andere Sprache).
- Halte dich kurz: meist 1–3 Sätze. Keine Markdown-Formatierung, keine Listen mit Sternchen, keine Emojis, keine URLs vorlesen.
- Zahlen und Uhrzeiten so schreiben, wie man sie spricht.

Fähigkeiten:
- Ziele: Der Nutzer kann dir seine Ziele nennen. Speichere sie mit add_goal, verfolge Fortschritt mit update_goal und erinnere ihn an offene Ziele, wenn es passt. Wenn er von Fortschritten erzählt, aktualisiere das passende Ziel.
- E-Mails: Du kannst Mails auflisten, suchen und lesen. Fasse sie knapp zusammen (Absender, worum es geht, ob Handlung nötig ist), statt sie wörtlich vorzulesen.
- Mails senden: Erstelle IMMER zuerst mit draft_email einen Entwurf, lies Empfänger, Betreff und den Kern des Textes vor und frage ausdrücklich, ob du senden sollst. Erst wenn der Nutzer in seiner nächsten Nachricht zustimmt, rufe send_draft auf.

Sei proaktiv, aber erfinde nie Daten – wenn ein Werkzeug einen Fehler meldet, sag das ehrlich.`;
}

// ─── Werkzeuge ──────────────────────────────────────────────────────
const tools = [
  {
    name: "get_datetime",
    description: "Aktuelles Datum, Uhrzeit und Wochentag des Nutzers.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_goals",
    description: "Alle gespeicherten Ziele des Nutzers mit Fortschritt (0–100) und Status.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "add_goal",
    description: "Speichert ein neues Ziel des Nutzers.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Kurzer Titel des Ziels" },
        description: { type: "string", description: "Details, Motivation, Teilschritte" },
        deadline: { type: "string", description: "Frist als ISO-Datum (YYYY-MM-DD), falls genannt" },
      },
      required: ["title"],
    },
  },
  {
    name: "update_goal",
    description: "Aktualisiert ein Ziel: Fortschritt, Status, Notiz, Titel oder Frist.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID des Ziels (aus list_goals)" },
        progress: { type: "number", description: "Fortschritt in Prozent 0–100" },
        status: { type: "string", enum: ["aktiv", "pausiert", "erreicht", "aufgegeben"] },
        note: { type: "string", description: "Fortschrittsnotiz" },
        title: { type: "string" },
        deadline: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "remove_goal",
    description: "Löscht ein Ziel endgültig. Nur auf ausdrücklichen Wunsch.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "list_emails",
    description: "Listet die neuesten E-Mails (Absender, Betreff, Datum, ungelesen) eines Ordners.",
    input_schema: {
      type: "object",
      properties: {
        unread_only: { type: "boolean", description: "Nur ungelesene" },
        limit: { type: "integer", description: "Anzahl, Standard 10, max 50" },
        folder: { type: "string", description: "Ordner, Standard INBOX" },
      },
    },
  },
  {
    name: "search_emails",
    description: "Sucht E-Mails nach Absender, Betreff oder Inhalt.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer" },
        folder: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_email",
    description: "Liest den vollständigen Inhalt einer E-Mail anhand ihrer UID.",
    input_schema: {
      type: "object",
      properties: {
        uid: { type: "integer" },
        folder: { type: "string" },
      },
      required: ["uid"],
    },
  },
  {
    name: "draft_email",
    description:
      "Erstellt einen E-Mail-Entwurf (sendet NICHT). Danach dem Nutzer vorlesen und um Bestätigung bitten.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        in_reply_to: { type: "string", description: "Message-ID bei Antworten" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "send_draft",
    description:
      "Sendet den zuletzt erstellten Entwurf. Nur aufrufen, nachdem der Nutzer in einer NEUEN Nachricht ausdrücklich zugestimmt hat.",
    input_schema: { type: "object", properties: { draft_id: { type: "string" } }, required: ["draft_id"] },
  },
];

// ─── Sitzungen ──────────────────────────────────────────────────────
const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) sessions.set(id, { messages: [], drafts: new Map(), turn: 0 });
  return sessions.get(id);
}

export function resetSession(id) {
  sessions.delete(id);
}

async function runTool(name, input, session) {
  switch (name) {
    case "get_datetime": {
      const now = new Date();
      return {
        iso: now.toISOString(),
        text: now.toLocaleString("de-DE", { dateStyle: "full", timeStyle: "short" }),
      };
    }
    case "list_goals":
      return goals.list();
    case "add_goal":
      return goals.add(input);
    case "update_goal":
      return goals.update(input);
    case "remove_goal":
      return goals.remove(input);
    case "list_emails":
      return mail.listEmails(input);
    case "search_emails":
      return mail.searchEmails(input);
    case "read_email":
      return mail.readEmail(input);
    case "draft_email": {
      const id = Math.random().toString(36).slice(2, 8);
      session.drafts.set(id, { ...input, turn: session.turn });
      return { draft_id: id, ...input, hinweis: "Noch nicht gesendet. Bitte Nutzer um Bestätigung." };
    }
    case "send_draft": {
      const draft = session.drafts.get(input.draft_id);
      if (!draft) throw new Error("Entwurf nicht gefunden.");
      // Sicherheitsgurt: Senden erst, nachdem der Nutzer nach dem Entwurf erneut gesprochen hat.
      if (draft.turn === session.turn) {
        throw new Error("Der Nutzer hat noch nicht bestätigt. Lies den Entwurf vor und warte auf seine Zustimmung.");
      }
      const { to, subject, body, in_reply_to } = draft;
      const result = await mail.sendEmail({ to, subject, body, in_reply_to });
      session.drafts.delete(input.draft_id);
      return result;
    }
    default:
      throw new Error(`Unbekanntes Werkzeug: ${name}`);
  }
}

const TOOL_LABELS = {
  get_datetime: "Prüfe Uhrzeit",
  list_goals: "Lade Ziele",
  add_goal: "Speichere Ziel",
  update_goal: "Aktualisiere Ziel",
  remove_goal: "Entferne Ziel",
  list_emails: "Prüfe Posteingang",
  search_emails: "Durchsuche Mails",
  read_email: "Lese E-Mail",
  draft_email: "Verfasse Entwurf",
  send_draft: "Sende E-Mail",
};

// ─── Agenten-Schleife ───────────────────────────────────────────────
let client;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY fehlt in der .env-Datei.");
  }
  client ??= new Anthropic();
  return client;
}

/**
 * Verarbeitet eine Nutzernachricht.
 * @param {string} sessionId
 * @param {string} text
 * @param {(event: object) => void} emit  – Statusereignisse für das HUD
 * @param {{ createMessage?: Function }} [deps] – für Tests injizierbar
 * @returns {Promise<string>} gesprochene Antwort
 */
export async function chat(sessionId, text, emit = () => {}, deps = {}) {
  const session = getSession(sessionId);
  session.turn += 1;
  session.messages.push({ role: "user", content: text });

  const createMessage =
    deps.createMessage ??
    ((params) =>
      getClient().beta.messages.create({
        ...params,
        // Falls das Modell eine Anfrage ablehnt, springt automatisch ein Ersatzmodell ein.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      }));

  for (let i = 0; i < 10; i++) {
    const response = await createMessage({
      model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: process.env.CLAUDE_EFFORT || "low" },
      system: systemPrompt(),
      tools,
      messages: session.messages,
    });

    session.messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "pause_turn") continue;

    if (response.stop_reason === "refusal") {
      return "Das kann ich leider nicht übernehmen.";
    }

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const reply = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join(" ")
        .trim();
      return reply || "Erledigt.";
    }

    const results = await Promise.all(
      toolUses.map(async (tu) => {
        emit({ type: "tool", name: tu.name, label: TOOL_LABELS[tu.name] || tu.name });
        try {
          const out = await runTool(tu.name, tu.input ?? {}, session);
          if (/goal/.test(tu.name)) emit({ type: "goals_changed" });
          return { type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) };
        } catch (err) {
          return { type: "tool_result", tool_use_id: tu.id, content: String(err.message || err), is_error: true };
        }
      }),
    );
    session.messages.push({ role: "user", content: results });
  }
  return "Ich habe mich etwas verrannt, Sir. Versuchen wir es noch einmal.";
}

export { goals };
