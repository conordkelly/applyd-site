// One-off: runs migrations/2026-10-08-job-allotment.sql. Idempotent. Deleted after use.
function json(d, s) { return new Response(JSON.stringify(d), { status: s || 200, headers: { "Content-Type": "application/json" } }); }
export async function onRequestPost(context) {
  const { env } = context;
  const out = {};
  for (const col of ["job_limit INTEGER", "job_reset_at TEXT"]) {
    try { await env.DB.prepare("ALTER TABLE users ADD COLUMN " + col).run(); out[col] = "added"; }
    catch (e) {
      const m = String(e && e.message ? e.message : e);
      out[col] = /duplicate column name/i.test(m) ? "already there" : "ERROR: " + m;
    }
  }
  return json({ ok: true, result: out });
}
