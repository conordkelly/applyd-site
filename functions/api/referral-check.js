// GET /api/referral-check?code=APPLYDWILL - public. The landing page asks this
// before showing "Referral code added", so a made-up code shows nothing.
import { REFERRAL_CODES, REFERRAL_BONUS, normalizeCode } from "./dashboard/_billing.js";

export async function onRequestGet({ request }) {
  const code = normalizeCode(new URL(request.url).searchParams.get("code"));
  const valid = !!REFERRAL_CODES[code];
  return new Response(JSON.stringify({ valid, code: valid ? code : null, bonus: valid ? REFERRAL_BONUS : 0 }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
  });
}
