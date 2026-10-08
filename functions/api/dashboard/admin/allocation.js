// POST /api/dashboard/admin/allocation — admin only
//   { user_id, action: "add", amount }  raises that user's job limit by amount
//   { user_id, action: "reset" }        usage goes back to 0 (limit unchanged)
//   { user_id, action: "unlimited" }    no cap for that user
import { getAllotment, DEFAULT_JOB_LIMIT } from "../_job_limit.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPost(context) {
  const { request, env, data } = context;
  if (data.userId !== env.ADMIN_USER_ID) {
    return json({ error: "Not authorized" }, 403);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request body" }, 400); }

  const userId = String(body.user_id || "").trim();
  const action = String(body.action || "").trim();
  if (!userId) return json({ error: "user_id is required" }, 400);
  const exists = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
  if (!exists) return json({ error: "User not found" }, 404);

  try {
    if (action === "add") {
      const amount = Math.floor(Number(body.amount));
      if (!Number.isFinite(amount) || amount < 1 || amount > 10000) {
        return json({ error: "amount must be a whole number from 1 to 10000" }, 400);
      }
      const cur = await getAllotment(env, userId);
      if (cur.unlimited) return json({ error: "That user is already unlimited" }, 400);
      await env.DB.prepare("UPDATE users SET job_limit = ? WHERE id = ?")
        .bind(cur.limit + amount, userId).run();
    } else if (action === "unlimited") {
      await env.DB.prepare("UPDATE users SET job_limit = -1 WHERE id = ?").bind(userId).run();
    } else if (action === "reset") {
      await env.DB.prepare("UPDATE users SET job_reset_at = datetime('now') WHERE id = ?")
        .bind(userId).run();
    } else {
      return json({ error: "action must be add, reset or unlimited" }, 400);
    }
  } catch (e) {
    return json({
      error: "Update failed. The job allotment migration may not have run yet.",
      detail: String(e && e.message ? e.message : e),
    }, 503);
  }
  return json({ ok: true, usage: await getAllotment(env, userId), default_limit: DEFAULT_JOB_LIMIT });
}
