import { sendEmail, buildSignupNoticeEmail } from "./_email.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const email = String(body.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return json({ error: "Invalid email" }, 400);
  }

  const existing = await env.WAITLIST.get(`sub:${email}`);
  await env.WAITLIST.put(
    `sub:${email}`,
    JSON.stringify({ email, subscribedAt: new Date().toISOString() })
  );

  // Notify the Applyd inbox on first signup only (not repeat submits).
  if (!existing) {
    const notice = (async () => {
      try {
        const msg = buildSignupNoticeEmail({ kind: "waitlist", email });
        await sendEmail(env, {
          to: "info@applydjobs.com",
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
        });
      } catch (e) {
        console.log("waitlist notify:", String(e && e.message ? e.message : e));
      }
    })();
    if (typeof waitUntil === "function") waitUntil(notice);
  }

  return json({ ok: true });
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}
