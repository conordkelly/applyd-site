// POST /api/worker/backfill_notice_period
// One-off: gives every EXISTING profile notice_period = "2 Weeks" (only where
// it is blank). Profiles created after this runs are not touched, so new
// users still have to choose. Worker-key auth via /api/worker/_middleware.js.
// Idempotent. Deleted from the repo once it has run.
function json(d, s) { return new Response(JSON.stringify(d), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

export async function onRequestPost(context) {
  const { env } = context;
  try {
    const before = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM profiles WHERE COALESCE(json_extract(data,'$.notice_period'),'') = ''"
    ).first();
    await env.DB.prepare(
      `UPDATE profiles
       SET data = CASE
             WHEN json_type(json_set(data,'$.notice_period','2 Weeks'),'$.canonical.professional_background') = 'object'
             THEN json_set(json_set(data,'$.notice_period','2 Weeks'),'$.canonical.professional_background.notice_period','2 Weeks')
             ELSE json_set(data,'$.notice_period','2 Weeks')
           END,
           updated_at = datetime('now')
       WHERE COALESCE(json_extract(data,'$.notice_period'),'') = ''`
    ).run();
    const after = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM profiles WHERE COALESCE(json_extract(data,'$.notice_period'),'') = ''"
    ).first();
    const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM profiles").first();
    return json({ ok: true, total: total.n, blank_before: before.n, blank_after: after.n });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message ? e.message : e) }, 500);
  }
}
