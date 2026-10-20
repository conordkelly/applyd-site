// GET /api/pricing - public. Tells the landing page whether launch pricing is
// still on (fewer than LAUNCH_SPOTS people have taken a launch spot). The
// prices themselves live in the landing page HTML and in dashboard/_billing.js.
import { LAUNCH_SPOTS } from "./dashboard/_billing.js";

export async function onRequestGet({ env }) {
  let used = 0;
  try {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE launch_used = 1").first();
    used = (r && r.n) || 0;
  } catch (e) {
    used = 0; // plans migration not run: launch pricing is still on
  }
  return new Response(JSON.stringify({ launch_available: used < LAUNCH_SPOTS }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
  });
}
