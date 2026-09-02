export async function onRequestGet(context) {
  const { env, data } = context;

  const row = await env.DB.prepare(
    "SELECT data FROM profiles WHERE user_id = ?"
  )
    .bind(data.userId)
    .first();

  return json({ profile: row ? JSON.parse(row.data) : {} });
}

export async function onRequestPost(context) {
  const { request, env, data } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const profile =
    body && typeof body.profile === "object" && body.profile !== null
      ? body.profile
      : {};

  await env.DB.prepare(
    "INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
  )
    .bind(data.userId, JSON.stringify(profile))
    .run();

  return json({ ok: true });
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}
