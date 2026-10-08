// One-off: make one user unlimited, matching Gmail-style (dots ignored) email.
// POST ?email=... ; reports matches and only updates if exactly one. Deleted after use.
function json(d, s) { return new Response(JSON.stringify(d), { status: s || 200, headers: { "Content-Type": "application/json" } }); }
const norm = (e) => { const [l, d] = String(e || "").trim().toLowerCase().split("@"); return (l || "").replace(/\./g, "").split("+")[0] + "@" + (d || ""); };
export async function onRequestPost(context) {
  const { env, request } = context;
  const want = norm(new URL(request.url).searchParams.get("email"));
  const { results } = await env.DB.prepare("SELECT id, email FROM users").all();
  const hits = results.filter((u) => norm(u.email) === want);
  if (hits.length !== 1) return json({ ok: false, matches: hits.map((h) => h.email), all: results.map((u) => u.email) }, 409);
  await env.DB.prepare("UPDATE users SET job_limit = -1 WHERE id = ?").bind(hits[0].id).run();
  return json({ ok: true, email: hits[0].email });
}
