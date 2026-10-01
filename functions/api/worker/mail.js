// GET /api/worker/mail?userId=<clerkUserId>&since=<ISO>&limit=20
// GET /api/worker/mail?to=<apply@everydaymail.ca>&since=<ISO>&limit=20
//
// Machine poll of apply inbox for ATS email-verify links (Workday activate, etc.).
// Auth: X-Worker-Key via /api/worker/_middleware.js (not Clerk).
// Returns recent messages INCLUDING body_text / body_html so the fill worker
// can extract activation URLs without scraping the admin UI.

import { ensureApplyEmailTables } from "../_apply_email.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

function clampLimit(raw) {
  const n = parseInt(String(raw || ""), 10);
  if (!Number.isFinite(n) || n < 1) return 20;
  return Math.min(n, 50);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  await ensureApplyEmailTables(env.DB);

  const url = new URL(request.url);
  let userId = (url.searchParams.get("userId") || "").trim();
  const to = (url.searchParams.get("to") || "").trim().toLowerCase();
  const since = (url.searchParams.get("since") || "").trim();
  const id = (url.searchParams.get("id") || "").trim();
  const limit = clampLimit(url.searchParams.get("limit"));

  if (!userId && to) {
    const addr = await env.DB.prepare(
      "SELECT user_id, email FROM apply_email_addresses WHERE email = ?"
    )
      .bind(to)
      .first();
    if (!addr || !addr.user_id) {
      return json({ error: "No user for apply address", to }, 404);
    }
    userId = addr.user_id;
  }

  if (!userId) {
    return json(
      { error: "userId or to query param is required" },
      400
    );
  }

  const applyRow = await env.DB.prepare(
    "SELECT email FROM apply_email_addresses WHERE user_id = ?"
  )
    .bind(userId)
    .first();
  const applyEmail = (applyRow && applyRow.email) || null;

  if (id) {
    const row = await env.DB.prepare(
      `SELECT id, user_id, to_address, from_address, subject, body_text, body_html,
              received_at, forwarded_at, forward_status
       FROM apply_messages WHERE id = ? AND user_id = ?`
    )
      .bind(id, userId)
      .first();
    if (!row) return json({ error: "Not found" }, 404);
    return json({ applyEmail, message: row });
  }

  let sql =
    `SELECT id, user_id, to_address, from_address, subject, body_text, body_html,
            received_at, forwarded_at, forward_status
     FROM apply_messages WHERE user_id = ?`;
  const binds = [userId];
  if (since) {
    sql += " AND received_at >= ?";
    binds.push(since);
  }
  sql += " ORDER BY received_at DESC LIMIT ?";
  binds.push(limit);

  const { results } = await env.DB.prepare(sql)
    .bind(...binds)
    .all();

  return json({
    applyEmail,
    userId,
    since: since || null,
    messages: results || [],
  });
}
