// POST /api/worker/migrate_rejected_reason
// One-off: runs migrations/2026-09-30-rejected-reason.sql on D1 so it never
// has to be pasted into the Cloudflare dashboard's D1 Console by hand.
// Auth: X-Worker-Key via /api/worker/_middleware.js (same as every other
// /api/worker/* route — no new secret, no new exposure).
//
// Idempotent: "duplicate column name" means it already ran, treated as
// success rather than an error. Safe to call more than once.

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPost(context) {
  const { env } = context;
  try {
    await env.DB.prepare("ALTER TABLE jobs ADD COLUMN rejected_reason TEXT").run();
    return json({ ok: true, applied: true });
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (/duplicate column name/i.test(msg)) {
      return json({ ok: true, applied: false, note: "column already exists" });
    }
    return json({ ok: false, error: msg }, 500);
  }
}
