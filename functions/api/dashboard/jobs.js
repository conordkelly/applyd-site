const USER_COMPLETE_DELAY_MINUTES = 10;

export async function onRequestGet(context) {
  const { env, data } = context;

  // Promote ops-submitted jobs past the 10 min user-facing delay
  try {
    await env.DB.prepare(
      `UPDATE jobs
       SET status = 'completed',
           completed_at = COALESCE(completed_at, datetime('now'))
       WHERE user_id = ?
         AND status = 'processing'
         AND rejected_at IS NULL
         AND ops_completed_at IS NOT NULL
         AND datetime(ops_completed_at) <= datetime('now', ?)`
    )
      .bind(data.userId, `-${USER_COMPLETE_DELAY_MINUTES} minutes`)
      .run();
  } catch (e) {
    console.log("jobs promote:", String(e && e.message ? e.message : e));
  }

  let results = [];
  try {
    const q = await env.DB.prepare(
      `SELECT id, job_url, status, created_at, completed_at, ops_completed_at, rejected_at
       FROM jobs
       WHERE user_id = ?
       ORDER BY created_at DESC`
    )
      .bind(data.userId)
      .all();
    results = q.results || [];
  } catch (e) {
    // Pre-migration fallback
    const q = await env.DB.prepare(
      "SELECT id, job_url, status, created_at, completed_at FROM jobs WHERE user_id = ? ORDER BY created_at DESC"
    )
      .bind(data.userId)
      .all();
    results = q.results || [];
  }

  const processing = results.filter(
    (r) =>
      r.status === "processing" &&
      !(r.rejected_at && String(r.rejected_at).trim())
  );
  const completed = results.filter((r) => r.status === "completed");

  return json({ processing, completed });
}

export async function onRequestPost(context) {
  const { request, env, data } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const links = Array.isArray(body.links) ? body.links : [];
  const cleaned = links
    .map((l) => String(l || "").trim())
    .filter((l) => {
      try {
        new URL(l);
        return true;
      } catch {
        return false;
      }
    });

  if (cleaned.length === 0) {
    return json({ error: "No valid links submitted" }, 400);
  }

  const stmt = env.DB.prepare(
    "INSERT INTO jobs (user_id, job_url, status) VALUES (?, ?, 'processing')"
  );
  await env.DB.batch(cleaned.map((url) => stmt.bind(data.userId, url)));

  return json({ ok: true, submitted: cleaned.length });
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}
