import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGoalStore } from "../server/tools/goals.js";
import { chat, resetSession, goals } from "../server/agent.js";
import { listEmails, mailConfigured } from "../server/tools/mail.js";

test("Ziele: hinzufügen, aktualisieren, löschen", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-"));
  const store = createGoalStore(join(dir, "goals.json"));
  const g = await store.add({ title: "Marathon laufen", deadline: "2027-05-01" });
  assert.equal((await store.list()).length, 1);
  const u = await store.update({ id: g.id, progress: 100, note: "Geschafft" });
  assert.equal(u.status, "erreicht");
  assert.equal(u.notes.length, 1);
  await store.remove({ id: g.id });
  assert.equal((await store.list()).length, 0);
  await rm(dir, { recursive: true });
});

test("Agent ruft Werkzeuge auf und gibt Antwort zurück", async () => {
  const calls = [];
  const fake = async (params) => {
    calls.push(params);
    if (calls.length === 1) {
      return {
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "t1", name: "get_datetime", input: {} }],
      };
    }
    const last = params.messages.at(-1);
    assert.equal(last.content[0].type, "tool_result");
    assert.ok(!last.content[0].is_error);
    return { stop_reason: "end_turn", content: [{ type: "text", text: "Es ist spät, Sir." }] };
  };
  const events = [];
  const reply = await chat("test", "Wie spät ist es?", (e) => events.push(e), { createMessage: fake });
  assert.equal(reply, "Es ist spät, Sir.");
  assert.equal(events[0].name, "get_datetime");
  resetSession("test");
});

test("Mail senden verlangt Bestätigung in einer neuen Nachricht", async () => {
  let step = 0;
  let sendResult;
  const fake = async (params) => {
    step++;
    if (step === 1)
      return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "d1", name: "draft_email", input: { to: "a@b.de", subject: "Hi", body: "Test" } }] };
    if (step === 2) {
      const draftId = JSON.parse(params.messages.at(-1).content[0].content).draft_id;
      return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "s1", name: "send_draft", input: { draft_id: draftId } }] };
    }
    sendResult = params.messages.at(-1).content[0];
    return { stop_reason: "end_turn", content: [{ type: "text", text: "Soll ich senden?" }] };
  };
  await chat("mailtest", "Schreib eine Mail", () => {}, { createMessage: fake });
  assert.equal(sendResult.is_error, true);
  assert.match(sendResult.content, /nicht bestätigt/);
  resetSession("mailtest");
});

test("Mail-Werkzeug ohne Konfiguration liefert klare Fehlermeldung", async () => {
  delete process.env.IMAP_HOST;
  assert.equal(mailConfigured(), false);
  await assert.rejects(listEmails({}), /nicht eingerichtet/);
});

test("Goal-Store des Agenten ist verfügbar", async () => {
  assert.ok(Array.isArray(await goals.list()));
});
