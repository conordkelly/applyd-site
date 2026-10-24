// TEMPORARY one-off: remove test users. Deleted right after use.
// Protected by the /api/worker/* key check (X-Worker-Key).
//   GET   lists matching users and what they own (read-only)
//   POST  { ids: [...] } deletes only those ids, and only if they still match
const PREFIXES = ["john.smith", "conor.kelly3", "test1.test2", "kelvin.adzikah", "conor.kelly2"];
const EXACT = ["conor.kelly@hotmail.ca"];

function json(data, status) {
  return new Response(JSON.stringify(data, null, 2), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function candidates(env) {
  const where = PREFIXES.map(() => "lower(email) LIKE ?").concat(EXACT.map(() => "lower(email) = ?")).join(" OR ");
  const binds = PREFIXES.map((p) => p + "%").concat(EXACT);
  const { results } = await env.DB.prepare(
    "SELECT id, email, job_limit, plan FROM users WHERE " + where
  )
    .bind(...binds)
    .all();
  const out = [];
  for (const u of results || []) {
    const count = async (sql) => {
      try {
        const r = await env.DB.prepare(sql).bind(u.id).first();
        return r ? r.n : 0;
      } catch (e) {
        return null;
      }
    };
    out.push({
      ...u,
      jobs: await count("SELECT COUNT(*) AS n FROM jobs WHERE user_id = ?"),
      payments: await count("SELECT COUNT(*) AS n FROM stripe_payments WHERE user_id = ?"),
      messages: await count("SELECT COUNT(*) AS n FROM apply_messages WHERE user_id = ?"),
    });
  }
  return out;
}

export async function onRequestGet({ request, env }) {
  if (new URL(request.url).searchParams.get("all")) {
    const users = await env.DB.prepare(
      "SELECT u.id, u.email, u.created_at, u.job_limit, (SELECT COUNT(*) FROM jobs j WHERE j.user_id = u.id) AS jobs, (SELECT email FROM apply_email_addresses a WHERE a.user_id = u.id) AS apply_address FROM users u ORDER BY u.created_at DESC"
    ).all();
    return json({ users: users.results });
  }
  return json({ matches: await candidates(env) });
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  if (!ids.length) return json({ error: "ids required" }, 400);
  const allowed = new Map((await candidates(env)).map((u) => [u.id, u]));
  const done = [];
  const skipped = [];
  for (const id of ids) {
    const u = allowed.get(id);
    if (!u || (u.job_limit !== null && u.job_limit < 0) || u.payments > 0) {
      skipped.push(id);
      continue;
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM apply_messages WHERE user_id = ?").bind(id),
      env.DB.prepare("DELETE FROM apply_email_addresses WHERE user_id = ?").bind(id),
      env.DB.prepare("DELETE FROM jobs WHERE user_id = ?").bind(id),
      env.DB.prepare("DELETE FROM profiles WHERE user_id = ?").bind(id),
      env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id),
    ]);
    if (env.RESUMES) {
      for (const prefix of ["resumes/" + id + "/", "job-screenshots/" + id + "/"]) {
        const listed = await env.RESUMES.list({ prefix });
        await Promise.all(listed.objects.map((o) => env.RESUMES.delete(o.key)));
      }
    }
    done.push(u.email);
  }
  return json({ deleted: done, skipped });
}
