// GET /api/worker/jobs?status=processing&limit=50
// Lists jobs across users for the local fill worker to claim/process.
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
      "SELECT id, user_id, job_url, status, created_at, completed_at FROM jobs WHERE user_id = ? AND status = ? ORDER BY created_at ASC LIMIT ?"
    )
      .bind(userId, status, limit)
      .all();
    results = q.results || [];
  } else {
    const q = await env.DB.prepare(
      "SELECT id, user_id, job_url, status, created_at, completed_at FROM jobs WHERE status = ? ORDER BY created_at ASC LIMIT ?"
    )
      .bind(status, limit)
      .all();
    results = q.results || [];
  }

  return json({ jobs: results, count: results.length });
}
