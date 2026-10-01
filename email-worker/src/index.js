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
    const envelopeFrom = String(message.from || "").trim();
    // Prefer the visible From header: the envelope sender is often a
    // bounce-tracking ID (e.g. 0102...@amazonses.com) with no readable name.
    const from =
      String(message.headers.get("from") || "").trim() || envelopeFrom;
    const replyToHeader = String(message.headers.get("reply-to") || "").trim();
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
          replyTo: replyToHeader,
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
    const enc = headerValue(split[0], "content-transfer-encoding");
    return {
      text: decodeTransfer(split.slice(1).join("\n\n"), enc).trim(),
      html: "",
    };
  }
  return { text: "", html: "" };
}

function headerValue(headers, name) {
  const re = new RegExp("^" + name + ":\\s*([^\\r\\n]+)", "im");
  const m = String(headers || "").match(re);
  return m ? String(m[1] || "").trim() : "";
}

function extractMimePart(raw, mime) {
  const ctypeRe = new RegExp(
    "Content-Type:\\s*" + mime.replace("/", "\\/") + "[^\\n]*",
    "i"
  );
  const idx = raw.search(ctypeRe);
  if (idx < 0) return "";
  const fromType = raw.slice(idx);
  const headerEnd = fromType.search(/\r?\n\r?\n/);
  if (headerEnd < 0) return "";
  const partHeaders = fromType.slice(0, headerEnd);
  let body = fromType.slice(headerEnd).replace(/^\r?\n\r?\n/, "");
  const bound = body.search(/\r?\n--/);
  if (bound >= 0) body = body.slice(0, bound);
  const enc = headerValue(partHeaders, "content-transfer-encoding");
  return decodeTransfer(body, enc).trim();
}

function decodeTransfer(body, enc) {
  const e = String(enc || "").trim().toLowerCase();
  if (e === "base64") {
    try {
      return atob(String(body || "").replace(/\s+/g, ""));
    } catch {
      return String(body || "");
    }
  }
  // Soft line-wraps (`=\n`) mean quoted-printable even if the header
  // was missed — leaving them in shows as random "=" in Gmail.
  if (e === "quoted-printable" || /=\r?\n/.test(String(body || ""))) {
    return decodeQuotedPrintable(body);
  }
  return String(body || "");
}

function decodeQuotedPrintable(body) {
  return String(body || "")
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    );
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeId(s) {
  const t = String(s || "").trim();
  // Long hex/dash strings or anything with no letters-only word in it.
  return t.length > 20 && /^[0-9a-f-]+$/i.test(t);
}

function parseFromDisplayName(fromHeader) {
  const s = String(fromHeader || "").trim();
  const angle = s.match(/^"?([^"<]+)"?\s*<[^>]+>/);
  if (angle) {
    const n = String(angle[1] || "").trim().replace(/^["']|["']$/g, "");
    if (n && !looksLikeId(n)) return n;
  }
  const addr = (s.match(/<([^>]+)>/) || [null, s])[1];
  if (addr.includes("@")) {
    const local = addr.split("@")[0];
    const domain = addr.split("@")[1] || "";
    if (!looksLikeId(local) && !/^(no-?reply|noreply|donotreply|do-not-reply|mailer|notifications?)$/i.test(local)) {
      return local;
    }
    // Fall back to the company part of the domain (careers.clio.com -> Clio).
    const parts = domain.split(".").filter(Boolean);
    const root = parts.length >= 2 ? parts[parts.length - 2] : parts[0] || "";
    if (root && !/^(amazonses|sendgrid|mailgun|mandrillapp|sparkpostmail|mcsv|rsgsv)$/i.test(root)) {
      return root.charAt(0).toUpperCase() + root.slice(1);
    }
  }
  return "";
}

function withoutApplyd(s) {
  return String(s || "")
    .replace(/applyd/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildForwardFrom(opts, env) {
  // Never use applydjobs.com / "Applyd" — a quoted reply would leak it.
  const name = withoutApplyd(parseFromDisplayName(opts.originalFrom)) || "Mail";
  const apply = String(opts.applyAddress || "").trim().toLowerCase();
  if (apply && apply.endsWith("@" + APPLY_EMAIL_DOMAIN)) {
    return name + " <" + apply + ">";
  }
  const envFrom = withoutApplyd(String((env && env.EMAIL_FROM) || "").trim());
  if (envFrom && !/applyd/i.test(envFrom)) return envFrom;
  return name + " <noreply@" + APPLY_EMAIL_DOMAIN + ">";
}

async function forwardViaResend(env, opts) {
  const apiKey = String((env && env.RESEND_API_KEY) || "").trim();
  if (!apiKey) return { skipped: true, reason: "no_api_key" };

  const text = opts.text || "";
  const html =
    opts.html ||
    (text ? "<pre>" + escapeHtml(text) + "</pre>" : "");
  const payload = {
    from: buildForwardFrom(opts, env),
    to: [opts.to],
    subject: withoutApplyd(opts.subject) || opts.subject,
    text,
    html,
  };
  const replyTo =
    String(opts.replyTo || "").trim() || String(opts.originalFrom || "").trim();
  if (replyTo) payload.reply_to = replyTo;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
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
