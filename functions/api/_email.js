// Shared transactional email helper (Resend HTTP API).
// No npm deps — fetch only, same as the rest of this Pages project.
//
// Cloudflare Pages secrets / vars:
//   RESEND_API_KEY  — secret (required to actually send)
//   EMAIL_FROM      — optional var, default "Applyd <info@applydjobs.com>"
//
// If RESEND_API_KEY is missing, sendEmail returns { skipped: true } so
// local/dev and pre-DNS deploys don't crash.

/**
 * @param {object} env
 * @param {{ to: string, subject: string, html?: string, text?: string }} opts
 * @returns {Promise<{ ok?: boolean, skipped?: boolean, reason?: string, id?: string, error?: string }>}
 */
export async function sendEmail(env, opts) {
  const to = String((opts && opts.to) || "").trim();
  const subject = String((opts && opts.subject) || "").trim();
  const html = opts && opts.html != null ? String(opts.html) : "";
  const text = opts && opts.text != null ? String(opts.text) : "";

  if (!to || !subject || (!html && !text)) {
    return { skipped: true, reason: "invalid_args" };
  }

  const apiKey = String((env && env.RESEND_API_KEY) || "").trim();
  if (!apiKey) {
    return { skipped: true, reason: "no_api_key" };
  }

  const from =
    String((env && env.EMAIL_FROM) || "").trim() ||
    "Applyd <info@applydjobs.com>";

  const body = { from, to: [to], subject };
  if (html) body.html = html;
  if (text) body.text = text;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const err =
      (data && (data.message || data.error)) ||
      "Resend HTTP " + res.status;
    return { ok: false, error: String(err) };
  }

  return { ok: true, id: data && data.id ? String(data.id) : undefined };
}

/**
 * Thin welcome copy for first dashboard visit.
 * @param {{ firstName?: string }} opts
 */
export function buildWelcomeEmail(opts) {
  const name = String((opts && opts.firstName) || "").trim();
  const hello = name ? "Hi " + name + "," : "Hi,";
  const subject = "Apply less. Start here.";
  const text = [
    hello,
    "",
    "Welcome to Applyd. Complete these three steps, then start sending us job links and we'll take it from there:",
    "",
    "1. Add your details under 'My Info'",
    "2. Upload your resume",
    "3. Submit your first job link",
    "",
    "A real person reviews every application before it's submitted.",
    "",
    "Your Applyd email: You'll get a dedicated email address (typically a generic address like yourname@everydaymail.ca) for job applications and account logins. Anything sent there shows up in your dashboard and forwards automatically to your personal email so you can reply. Keep forwarding on so you don't miss an interview request.",
    "",
    "Get started: https://www.applydjobs.com/dashboard/",
    "",
    "Best,",
    "",
    "The Applyd Team",
  ].join("\n");

  const html =
    "<p>" +
    escapeHtml(hello) +
    "</p>" +
    "<p>Welcome to Applyd. Complete these three steps, then start sending us job links and we'll take it from there:</p>" +
    "<ol>" +
    "<li>Add your details under 'My Info'</li>" +
    "<li>Upload your resume</li>" +
    "<li>Submit your first job link</li>" +
    "</ol>" +
    "<p>A real person reviews every application before it's submitted.</p>" +
    "<p><strong>Your Applyd email:</strong> You'll get a dedicated email address (typically a generic address like yourname@everydaymail.ca) for job applications and account logins. Anything sent there shows up in your dashboard and forwards automatically to your personal email so you can reply. Keep forwarding on so you don't miss an interview request.</p>" +
    '<p><a href="https://www.applydjobs.com/dashboard/">Get started</a></p>' +
    "<p>Best,</p>" +
    "<p>The Applyd Team</p>";

  return { subject, text, html };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
