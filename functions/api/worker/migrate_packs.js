// ONE-OFF: runs migrations/2026-10-24-packs.sql. Protected by the worker key
// (functions/api/worker/_middleware.js). Delete this file after it runs.
const STATEMENTS = [
  "ALTER TABLE users ADD COLUMN auto_reload_jobs INTEGER NOT NULL DEFAULT 10",
  "ALTER TABLE users ADD COLUMN referred_by_code TEXT",
  "ALTER TABLE users ADD COLUMN referred_at TEXT",
];

export async function onRequestPost({ env }) {
  const out = [];
  for (const sql of STATEMENTS) {
    try {
      await env.DB.prepare(sql).run();
      out.push({ sql, ok: true });
    } catch (e) {
      // "duplicate column name" just means it already ran.
      out.push({ sql, ok: false, error: String(e && e.message ? e.message : e) });
    }
  }
  return new Response(JSON.stringify(out, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
