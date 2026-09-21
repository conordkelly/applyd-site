// GET /api/worker/jobs?status=processing&limit=50
// PATCH /api/worker/jobs  { id, status: "processing"|"completed" }
// Lists / updates jobs across users for ApplyD Review + local fill worker.
// Auth: X-Worker-Key via /api/worker/_middleware.js

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const status = (url.searchParams.get("status") || "processing").trim();
  const limitRaw = parseInt(url.searchParams.get("limit") || "50", 10);
  const limit = Math.min(Math.max(limitRaw || 50, 1), 200);
  const userId = (url.searchParams.get("userId") || "").trim();

  const allowed = new Set(["processing", "completed"]);
  if (!allowed.has(status)) {
    return json({ error: "status must be processing or completed" }, 400);
  }

  let results;
  if (userId) {
    const q = await env.DB.prepare(
      `SELECT j.id, j.user_id, j.job_url, j.status, j.created_at, j.completed_at,
              u.email AS user_email
       FROM jobs j
       LEFT JOIN users u ON u.id = j.user_id
       WHERE j.user_id = ? AND j.status = ?
       ORDER BY j.created_at ASC LIMIT ?`
    )
      .bind(userId, status, limit)
      .all();
    results = q.results || [];
  } else {
    const q = await env.DB.prepare(
      `SELECT j.id, j.user_id, j.job_url, j.status, j.created_at, j.completed_at,
              u.email AS user_email
       FROM jobs j
       LEFT JOIN users u ON u.id = j.user_id
       WHERE j.status = ?
       ORDER BY j.created_at ASC LIMIT ?`
    )
      .bind(status, limit)
      .all();
    results = q.results || [];
  }

  return json({ jobs: results, count: results.length });
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const id = String(body.id || body.jobId || "").trim();
  const status = String(body.status || "").trim();
  if (!id) {
    return json({ error: "id is required" }, 400);
  }
  if (status !== "processing" && status !== "completed") {
    return json({ error: "status must be processing or completed" }, 400);
  }

  const existing = await env.DB.prepare(
    "SELECT id, user_id, job_url, status FROM jobs WHERE id = ?"
  )
    .bind(id)
    .first();
  if (!existing) {
    return json({ error: "Job not found" }, 404);
  }

  if (status === "completed") {
    await env.DB.prepare(
      "UPDATE jobs SET status = 'completed', completed_at = datetime('now') WHERE id = ?"
    )
      .bind(id)
      .run();
  } else {
    await env.DB.prepare(
      "UPDATE jobs SET status = 'processing', completed_at = NULL WHERE id = ?"
    )
      .bind(id)
      .run();
  }

  const row = await env.DB.prepare(
    `SELECT j.id, j.user_id, j.job_url, j.status, j.created_at, j.completed_at,
            u.email AS user_email
     FROM jobs j
     LEFT JOIN users u ON u.id = j.user_id
     WHERE j.id = ?`
  )
    .bind(id)
    .first();

  return json({ ok: true, job: row });
}
