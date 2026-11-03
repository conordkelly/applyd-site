// TEMPORARY one-off: speed up jobs lookups. Deleted right after use.
// Protected by the /api/worker/* key check (X-Worker-Key).
//   GET   lists the indexes on jobs and how many rows it has (read-only)
//   POST  adds the two indexes (IF NOT EXISTS, changes no data)
function json(data, status) {
  return new Response(JSON.stringify(data, null, 2), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function report(env) {
  const idx = await env.DB.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'jobs'"
  ).all();
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs").first();
  return { jobs_rows: n && n.n, indexes: idx.results };
}

export async function onRequestGet({ env }) {
  return json(await report(env));
}

export async function onRequestPost({ env }) {
  await env.DB.batch([
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_jobs_user_created ON jobs(user_id, created_at)"),
  ]);
  return json(await report(env));
}
