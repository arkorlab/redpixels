import { DurableObject } from "cloudflare:workers";
import { classify, config, eligible, hmac, relTime } from "./lib.js";

const MAX_ATTEMPTS = 8;
const fail = (status, message) => {
  throw new Error(`HTTP:${status}:${message}`);
};
const iso = (ms) => (ms === null ? null : new Date(ms).toISOString());

export class Tracker extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.settings = env;
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        recipient TEXT, subject TEXT, external_id TEXT,
        created_at INTEGER NOT NULL, armed_at INTEGER,
        idempotency_key TEXT UNIQUE, fingerprint TEXT NOT NULL,
        open_count INTEGER NOT NULL DEFAULT 0,
        eligible_open_count INTEGER NOT NULL DEFAULT 0,
        webhook_count INTEGER NOT NULL DEFAULT 0,
        last_open_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS opens (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        message_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        open_number INTEGER NOT NULL,
        ua TEXT NOT NULL, country TEXT, flags TEXT NOT NULL,
        notification_eligible INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS opens_message_seq ON opens(message_id, seq);
      CREATE TABLE IF NOT EXISTS outbox (
        event_id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        url TEXT NOT NULL, body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt INTEGER NOT NULL,
        delivered_at INTEGER, last_status INTEGER, last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS outbox_due ON outbox(status, next_attempt);
      CREATE INDEX IF NOT EXISTS outbox_message ON outbox(message_id);
    `);
  }

  row(id) {
    return this.sql
      .exec("SELECT * FROM messages WHERE id = ?", id)
      .toArray()[0];
  }
  required(id) {
    const row = this.row(id);
    if (!row) fail(404, "Message not found");
    return row;
  }

  summary(row) {
    return {
      seq: row.seq,
      id: row.id,
      recipient: row.recipient,
      subject: row.subject,
      external_id: row.external_id,
      created_at: iso(row.created_at),
      armed_at: iso(row.armed_at),
      open_count: row.open_count,
      eligible_open_count: row.eligible_open_count,
      webhook_count: row.webhook_count,
      last_open_at: iso(row.last_open_at),
    };
  }

  register(data, key) {
    return this.ctx.storage.transactionSync(() => {
      const fingerprint = JSON.stringify(data);
      if (key) {
        const prior = this.sql
          .exec("SELECT * FROM messages WHERE idempotency_key = ?", key)
          .toArray()[0];
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            fail(409, "Idempotency-Key already used with different metadata");
          return { created: false, message: this.summary(prior) };
        }
      }
      const now = Date.now();
      const id = crypto.randomUUID();
      this.sql.exec(
        "INSERT INTO messages (id, recipient, subject, external_id, created_at, armed_at, idempotency_key, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        id,
        data.recipient,
        data.subject,
        data.external_id,
        now,
        data.armed ? now : null,
        key,
        fingerprint,
      );
      return { created: true, message: this.summary(this.required(id)) };
    });
  }

  message(id) {
    return this.summary(this.required(id));
  }

  messages({ limit, after }) {
    const rows = this.sql
      .exec(
        "SELECT * FROM messages WHERE seq > ? ORDER BY seq LIMIT ?",
        after,
        limit + 1,
      )
      .toArray();
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      messages: page.map((r) => this.summary(r)),
      next_after: more ? page.at(-1).seq : null,
    };
  }

  arm(id) {
    this.required(id);
    this.sql.exec(
      "UPDATE messages SET armed_at = COALESCE(armed_at, ?) WHERE id = ?",
      Date.now(),
      id,
    );
    return this.message(id);
  }

  async remove(id) {
    await this.ctx.storage.transaction(async () => {
      this.required(id);
      this.sql.exec("DELETE FROM outbox WHERE message_id = ?", id);
      this.sql.exec("DELETE FROM opens WHERE message_id = ?", id);
      this.sql.exec("DELETE FROM messages WHERE id = ?", id);
      await this.schedule();
    });
  }

  opens(id, { limit, after }) {
    const message = this.message(id);
    const rows = this.sql
      .exec(
        `SELECT o.*, b.status AS webhook_status, b.attempts, b.last_status, b.last_error, b.delivered_at
      FROM opens o LEFT JOIN outbox b ON o.event_id = b.event_id
      WHERE o.message_id = ? AND o.seq > ? ORDER BY o.seq LIMIT ?`,
        id,
        after,
        limit + 1,
      )
      .toArray();
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const now = Date.now();
    return {
      message,
      opens: page.map((r) => ({
        seq: r.seq,
        event_id: r.event_id,
        timestamp: iso(r.timestamp),
        ago: relTime(r.timestamp, now),
        open_number: r.open_number,
        ua: r.ua,
        country: r.country,
        flags: JSON.parse(r.flags),
        notification_eligible: Boolean(r.notification_eligible),
        webhook: r.webhook_status
          ? {
              status: r.webhook_status,
              attempts: r.attempts,
              last_status: r.last_status,
              last_error: r.last_error,
              delivered_at: iso(r.delivered_at),
            }
          : null,
      })),
      next_after: more ? page.at(-1).seq : null,
    };
  }

  async record(id, evidence) {
    const cfg = config(this.settings);
    return this.ctx.storage.transaction(async () => {
      const message = this.row(id);
      if (!message) return false;
      const now = Date.now();
      const flags = classify(
        { ...evidence, armedAt: message.armed_at, now },
        cfg,
      );
      const qualifies = eligible(flags, cfg.filter);
      const eventId = crypto.randomUUID();
      const count = message.open_count + 1;
      const eligibleCount = message.eligible_open_count + Number(qualifies);
      const notify =
        Boolean(this.settings.WEBHOOK_URL) &&
        qualifies &&
        (cfg.mode === "every" || message.webhook_count === 0);
      this.sql.exec(
        "INSERT INTO opens (event_id, message_id, timestamp, open_number, ua, country, flags, notification_eligible) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        eventId,
        id,
        now,
        count,
        evidence.ua,
        evidence.country,
        JSON.stringify(flags),
        Number(qualifies),
      );
      this.sql.exec(
        "UPDATE messages SET open_count = ?, eligible_open_count = ?, webhook_count = webhook_count + ?, last_open_at = ? WHERE id = ?",
        count,
        eligibleCount,
        Number(notify),
        now,
        id,
      );
      if (notify) {
        const body = JSON.stringify({
          type: "email.open",
          version: 1,
          event_id: eventId,
          message_id: id,
          recipient: message.recipient,
          subject: message.subject,
          external_id: message.external_id,
          timestamp: iso(now),
          open_count: count,
          eligible_open_count: eligibleCount,
          ua: evidence.ua,
          country: evidence.country,
          flags,
        });
        this.sql.exec(
          "INSERT INTO outbox (event_id, message_id, url, body, next_attempt) VALUES (?, ?, ?, ?, ?)",
          eventId,
          id,
          this.settings.WEBHOOK_URL,
          body,
          now,
        );
        // The event, count, outbox row and alarm commit in the same transaction.
        await this.schedule();
      }
      return true;
    });
  }

  async schedule() {
    const next = this.sql
      .exec(
        "SELECT MIN(next_attempt) AS time FROM outbox WHERE status = 'pending'",
      )
      .one().time;
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, next));
  }

  async alarm() {
    if (this.delivering) return;
    this.delivering = true;
    try {
      for (let i = 0; i < 10; i++) {
        // Persist the attempt and a recovery alarm before making external I/O.
        const job = await this.ctx.storage.transaction(async () => {
          const row = this.sql
            .exec(
              "SELECT * FROM outbox WHERE status = 'pending' AND next_attempt <= ? ORDER BY next_attempt, event_id LIMIT 1",
              Date.now(),
            )
            .toArray()[0];
          if (!row) return null;
          if (row.attempts >= MAX_ATTEMPTS) {
            this.sql.exec(
              "UPDATE outbox SET status = 'failed', last_error = 'attempt_limit' WHERE event_id = ?",
              row.event_id,
            );
            await this.schedule();
            return { exhausted: true };
          }
          this.sql.exec(
            "UPDATE outbox SET attempts = attempts + 1, next_attempt = ? WHERE event_id = ?",
            Date.now() + 30000,
            row.event_id,
          );
          await this.schedule();
          return { ...row, attempts: row.attempts + 1 };
        });
        if (!job) break;
        if (job.exhausted) continue;
        let status = null;
        let error = null;
        try {
          if (
            !this.settings.WEBHOOK_SECRET ||
            this.settings.WEBHOOK_SECRET.length < 32
          )
            throw new Error("missing_secret");
          const timestamp = String(Math.floor(Date.now() / 1000));
          const signature = await hmac(
            this.settings.WEBHOOK_SECRET,
            `${timestamp}.${job.body}`,
          );
          const response = await fetch(job.url, {
            method: "POST",
            redirect: "manual",
            signal: AbortSignal.timeout(10000),
            headers: {
              "content-type": "application/json",
              "user-agent": "redpixels/0.1",
              "x-redpixels-event-id": job.event_id,
              "x-redpixels-timestamp": timestamp,
              "x-redpixels-signature": `v1=${signature}`,
            },
            body: job.body,
          });
          status = response.status;
          await response.body?.cancel();
        } catch {
          error = "network_or_configuration_error";
        }
        const success = status !== null && status >= 200 && status < 300;
        const retryable =
          status === null || status === 408 || status === 429 || status >= 500;
        const state = success
          ? "delivered"
          : retryable && job.attempts < MAX_ATTEMPTS
            ? "pending"
            : "failed";
        await this.ctx.storage.transaction(async () => {
          this.sql.exec(
            "UPDATE outbox SET status = ?, last_status = ?, last_error = ?, delivered_at = ?, next_attempt = ? WHERE event_id = ?",
            state,
            status,
            error,
            success ? Date.now() : null,
            Date.now() + 5000 * 2 ** (job.attempts - 1),
            job.event_id,
          );
          await this.schedule();
        });
      }
    } finally {
      this.delivering = false;
      await this.schedule();
    }
  }
}
