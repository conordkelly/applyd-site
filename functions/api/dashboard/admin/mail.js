// GET /api/dashboard/admin/mail — admin: users with apply inboxes + messages
// GET /api/dashboard/admin/mail?userId=&id= — one message for a user

import { ensureApplyEmailTables } from "../../_apply_email.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestGet(context) {
  const { request, env, data } = context;

  if (data.userId !== env.ADMIN_USER_ID) {
    return json({ error: "Not authorized" }, 403);
  }

  await ensureApplyEmailTables(env.DB);

  const url = new URL(request.url);
  const userId = (url.searchParams.get("userId") || "").trim();
  const id = (url.searchParams.get("id") || "").trim();

  if (userId && id) {
    const row = await env.DB.prepare(
      `SELECT id, user_id, to_address, from_address, subject, body_text, body_html,
              received_at, forwarded_at, forward_status
       FROM apply_messages WHERE id = ? AND user_id = ?`
    )
      .bind(id, userId)
      .first();
    if (!row) return json({ error: "Not found" }, 404);
    return json({ message: row });
  }

  if (userId) {
    const user = await env.DB.prepare(
      "SELECT id, email, created_at FROM users WHERE id = ?"
    )
      .bind(userId)
      .first();
    const addr = await env.DB.prepare(
      "SELECT email FROM apply_email_addresses WHERE user_id = ?"
    )
      .bind(userId)
      .first();
    const { results } = await env.DB.prepare(
      `SELECT id, to_address, from_address, subject, received_at, forwarded_at, forward_status
       FROM apply_messages WHERE user_id = ?
       ORDER BY received_at DESC LIMIT 200`
    )
      .bind(userId)
      .all();
    return json({
      user: user || { id: userId },
      applyEmail: (addr && addr.email) || null,
      messages: results || [],
    });
  }

  const { results: users } = await env.DB.prepare(
    "SELECT id, email, created_at FROM users ORDER BY created_at DESC"
  ).all();

  const { results: addrs } = await env.DB.prepare(
    "SELECT email, user_id FROM apply_email_addresses"
  ).all();
  const addrByUser = {};
  (addrs || []).forEach(function (a) {
    addrByUser[a.user_id] = a.email;
  });

  const { results: counts } = await env.DB.prepare(
    `SELECT user_id, COUNT(*) AS n FROM apply_messages GROUP BY user_id`
  ).all();
  const countByUser = {};
  (counts || []).forEach(function (c) {
    countByUser[c.user_id] = c.n;
  });

  return json({
    users: (users || []).map(function (u) {
      return {
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        applyEmail: addrByUser[u.id] || null,
        messageCount: countByUser[u.id] || 0,
      };
    }),
  });
}
