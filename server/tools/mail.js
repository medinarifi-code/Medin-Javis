import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";

function config() {
  const { IMAP_HOST, IMAP_PORT, SMTP_HOST, SMTP_PORT, MAIL_USER, MAIL_PASS, MAIL_FROM_NAME } = process.env;
  return {
    imapHost: IMAP_HOST,
    imapPort: Number(IMAP_PORT || 993),
    smtpHost: SMTP_HOST,
    smtpPort: Number(SMTP_PORT || 465),
    user: MAIL_USER,
    pass: MAIL_PASS,
    fromName: MAIL_FROM_NAME || "",
  };
}

export function mailConfigured() {
  const c = config();
  return Boolean(c.imapHost && c.user && c.pass);
}

function requireConfig() {
  if (!mailConfigured()) {
    throw new Error("E-Mail ist nicht eingerichtet. Bitte IMAP_HOST, MAIL_USER und MAIL_PASS in der .env-Datei setzen.");
  }
  return config();
}

async function withImap(fn) {
  const c = requireConfig();
  const client = new ImapFlow({
    host: c.imapHost,
    port: c.imapPort,
    secure: c.imapPort === 993,
    auth: { user: c.user, pass: c.pass },
    logger: false,
    socketTimeout: 30000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => {});
  }
}

function summarize(msg) {
  const from = msg.envelope?.from?.[0];
  return {
    uid: msg.uid,
    from: from ? (from.name ? `${from.name} <${from.address}>` : from.address) : "Unbekannt",
    subject: msg.envelope?.subject || "(kein Betreff)",
    date: msg.envelope?.date?.toISOString?.() ?? null,
    unread: !msg.flags?.has("\\Seen"),
  };
}

async function fetchSummaries(client, range, limit) {
  const out = [];
  for await (const msg of client.fetch(range, { envelope: true, flags: true, uid: true }, { uid: true })) {
    out.push(summarize(msg));
  }
  return out.sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, limit);
}

export async function listEmails({ unread_only = false, limit = 10, folder = "INBOX" } = {}) {
  limit = Math.min(Math.max(1, limit), 50);
  return withImap(async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const uids = await client.search(unread_only ? { seen: false } : { all: true }, { uid: true });
      if (!uids || uids.length === 0) return { folder, total: 0, emails: [] };
      const recent = uids.slice(-limit);
      return { folder, total: uids.length, emails: await fetchSummaries(client, recent, limit) };
    } finally {
      lock.release();
    }
  });
}

export async function searchEmails({ query, limit = 10, folder = "INBOX" }) {
  if (!query) throw new Error("Suchbegriff fehlt.");
  limit = Math.min(Math.max(1, limit), 50);
  return withImap(async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const uids = await client.search({ or: [{ subject: query }, { from: query }, { body: query }] }, { uid: true });
      if (!uids || uids.length === 0) return { query, emails: [] };
      return { query, emails: await fetchSummaries(client, uids.slice(-limit), limit) };
    } finally {
      lock.release();
    }
  });
}

export async function readEmail({ uid, folder = "INBOX", mark_read = true }) {
  return withImap(async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const msg = await client.fetchOne(String(uid), { source: true, envelope: true, flags: true }, { uid: true });
      if (!msg) throw new Error(`E-Mail ${uid} nicht gefunden.`);
      const parsed = await simpleParser(msg.source);
      if (mark_read) await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      const text = (parsed.text || "").replace(/\n{3,}/g, "\n\n").trim();
      return {
        uid,
        from: parsed.from?.text,
        to: parsed.to?.text,
        subject: parsed.subject,
        date: parsed.date?.toISOString(),
        messageId: parsed.messageId,
        attachments: (parsed.attachments || []).map((a) => a.filename),
        text: text.length > 8000 ? text.slice(0, 8000) + "\n[… gekürzt]" : text,
      };
    } finally {
      lock.release();
    }
  });
}

export async function sendEmail({ to, subject, body, in_reply_to }) {
  const c = requireConfig();
  if (!c.smtpHost) throw new Error("SMTP_HOST fehlt in der .env-Datei – Senden nicht möglich.");
  const transport = nodemailer.createTransport({
    host: c.smtpHost,
    port: c.smtpPort,
    secure: c.smtpPort === 465,
    auth: { user: c.user, pass: c.pass },
  });
  const info = await transport.sendMail({
    from: c.fromName ? `"${c.fromName}" <${c.user}>` : c.user,
    to,
    subject,
    text: body,
    ...(in_reply_to ? { inReplyTo: in_reply_to, references: in_reply_to } : {}),
  });
  return { sent: true, messageId: info.messageId, to, subject };
}
