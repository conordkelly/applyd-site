# Worker API auth for /api/worker/*
# Local apply_worker.py will call these with X-Worker-Key (not a Clerk browser session).
# Set WORKER_API_KEY as a Cloudflare Pages secret (Production + Preview).
# Until it is set, all /api/worker/* routes return 503.

function timingSafeEqual(a, b) {
  const aa = String(a || "");
  const bb = String(b || "");
  if (aa.length !== bb.length) return false;
  let out = 0;
  for (let i = 0; i < aa.length; i++) out |= aa.charCodeAt(i) ^ bb.charCodeAt(i);
  return out === 0;
}

function workerKeyFromRequest(request) {
  const headerKey = request.headers.get("X-Worker-Key");
  if (headerKey) return headerKey.trim();
  const auth = request.headers.get("Authorization") || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return "";
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const expected = (env.WORKER_API_KEY || "").trim();

  if (!expected) {
    return json(
      {
        error:
          "Worker API isn't configured yet — set WORKER_API_KEY in Pages secrets.",
      },
      503
    );
  }

  const provided = workerKeyFromRequest(request);
  if (!provided || !timingSafeEqual(provided, expected)) {
    return json({ error: "Unauthorized" }, 401);
  }

  context.data = { worker: true };
  return next();
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}
