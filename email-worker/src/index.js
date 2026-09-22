// Inbound Email Worker for *@everydaymail.ca
// Stores messages in D1 and optionally re-sends a copy to the user's
// personal email via Resend (Cloudflare message.forward only works to
// pre-verified destinations — Resend handles arbitrary personal inboxes).

const APPLY_EMAIL_DOMAIN = "everydaymail.ca";

export default {
  async email(message, env, ctx) {
    const to = String(message.to || "")
      .trim()
      .toLowerCase();
    if (!to.endsWith("@" + APPLY_EMAIL_DOMAIN)) {
      console.log("apply-inbox: ignoring non-domain recipient", to);
      return;
    }
    const from = String(message.from || "").trim();
    const subject = message.headers.get("subject") || "(no subject)";
    const receivedAt = new Date().toISOString();
    const id = crypto.randomUUID();

    try {
      await ensureTables(env.DB);

      const row = await env.DB.prepare(
        "SELECT user_id FROM apply_email_addresses WHERE email = ?"
      )
        .bind(to)
        .first();

      if (!row || !row.user_id) {
        // Unknown address — accept & drop so we don't bounce randomly.
        console.log("apply-inbox: no user for", to);
        return;
      }

      const userId = row.user_id;
      const rawText = await readStreamText(message.raw);
      const parsed = extractBodies(rawText);
      const bodyText = parsed.text || stripHtml(parsed.html) || rawText.slice(0, 20000);
      const bodyHtml = parsed.html || "";

      let forwardStatus = "skipped";
      let forwardedAt = null;

      const profileRow = await env.DB.prepare(
        "SELECT data FROM profiles WHERE user_id = ?"
      )
        .bind(userId)
        .first();

      let profile = {};
      if (profileRow && profileRow.data) {
        try {
          profile = JSON.parse(profileRow.data);
        } catch {
          profile = {};
        }
      }

      const forwardOn = profile.apply_email_forward_to_personal !== false;
      const userRow = await env.DB.prepare(
        "SELECT email FROM users WHERE id = ?"
      )
        .bind(userId)
        .first();
      const personal = String((userRow && userRow.email) || "").trim();

      if (forwardOn && personal) {
        const fwd = await forwardViaResend(env, {
          to: personal,
          applyAddress: to,
          originalFrom: from,
          subject,
          text: bodyText,
          html: bodyHtml,
        });
        if (fwd.ok) {
          forwardStatus = "sent";
          forwardedAt = new Date().toISOString();
        } else if (fwd.skipped) {
          forwardStatus = "skipped:" + (fwd.reason || "skipped");
        } else {
          forwardStatus = "error:" + String(fwd.error || "failed").slice(0, 120);
        }
      } else if (!forwardOn) {
        forwardStatus = "disabled";
      } else {
        forwardStatus = "skipped:no_personal";
      }

      await env.DB.prepare(
        `INSERT INTO apply_messages (
          id, user_id, to_address, from_address, subject,
          body_text, body_html, received_at, forwarded_at, forward_status, raw_size
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          id,
          userId,
          to,
          from,
          subject.slice(0, 500),
          bodyText.slice(0, 100000),
          bodyHtml.slice(0, 200000),
          receivedAt,
          forwardedAt,
          forwardStatus,
          message.rawSize || null
        )
        .run();
    } catch (err) {
      console.error("apply-inbox failed", err);
      // Do not setReject — avoid bouncing ATS mail on transient errors.
    }
  },
};

async function ensureTables(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS apply_email_addresses (
        email TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS apply_messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        to_address TEXT NOT NULL,
        from_address TEXT NOT NULL,
        subject TEXT,
        body_text TEXT,
        body_html TEXT,
        received_at TEXT NOT NULL,
        forwarded_at TEXT,
        forward_status TEXT,
        raw_size INTEGER
      )`
    )
    .run();
}

async function readStreamText(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  const max = 1_500_000;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
      if (total >= max) break;
    }
  }
  const out = new Uint8Array(Math.min(total, max));
  let offset = 0;
  for (const c of chunks) {
    const n = Math.min(c.length, out.length - offset);
    out.set(c.subarray(0, n), offset);
    offset += n;
    if (offset >= out.length) break;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(out);
}

function extractBodies(raw) {
  const text = extractMimePart(raw, "text/plain");
  const html = extractMimePart(raw, "text/html");
  if (text || html) return { text, html };
  // Non-multipart: body after first blank line
  const split = raw.split(/\r?\n\r?\n/);
  if (split.length > 1) {
    return { text: split.slice(1).join("\n\n").trim(), html: "" };
  }
  return { text: "", html: "" };
}

function extractMimePart(raw, mime) {
  const re = new RegExp(
    "Content-Type:\\s*" +
      mime.replace("/", "\\/") +
      "[^\\n]*\\n(?:Content-Transfer-Encoding:\\s*([^\\n]+)\\n)?(?:Content-[^\\n]+\\n)*\\r?\\n([\\s\\S]*?)(?=\\r?\\n--|$)",
    "i"
  );
  const m = raw.match(re);
  if (!m) return "";
  let body = m[2] || "";
  const enc = (m[1] || "").trim().toLowerCase();
  if (enc === "base64") {
    try {
      body = atob(body.replace(/\s+/g, ""));
    } catch {
      /* keep */
    }
  } else if (enc === "quoted-printable") {
    body = body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, h) =>
        String.fromCharCode(parseInt(h, 16))
      );
  }
  return body.trim();
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function forwardViaResend(env, opts) {
  const apiKey = String((env && env.RESEND_API_KEY) || "").trim();
  if (!apiKey) return { skipped: true, reason: "no_api_key" };

  const from =
    String((env && env.EMAIL_FROM) || "").trim() ||
    "Applyd <info@applydjobs.com>";
  const subject = "[Applyd] " + opts.subject;
  const intro =
    "This message was sent to your Applyd apply address (" +
    opts.applyAddress +
    "). Reply from your personal email to the original sender (" +
    opts.originalFrom +
    ").\n\n---\n\n";
  const text = intro + (opts.text || "");
  const html =
    "<p>This message was sent to your Applyd apply address (<code>" +
    escapeHtml(opts.applyAddress) +
    "</code>). Reply from your personal email to the original sender (" +
    escapeHtml(opts.originalFrom) +
    ").</p><hr/>" +
    (opts.html || "<pre>" + escapeHtml(opts.text || "") + "</pre>");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject,
      text,
      html,
    }),
  });

  if (!res.ok) {
    let err = "Resend HTTP " + res.status;
    try {
      const data = await res.json();
      err = (data && (data.message || data.error)) || err;
    } catch {
      /* ignore */
    }
    return { ok: false, error: String(err) };
  }
  return { ok: true };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
