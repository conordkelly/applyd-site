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
    "Welcome to Applyd. Three steps and you're set. Then you send links, we handle the forms:",
    "",
    "1. My Info - your answers, filled in once",
    "2. Resume - the PDF we submit with each application",
    "3. First job link - paste a posting to get going",
    "",
    "A human reviews every application before it goes out.",
    "",
    "Open your dashboard: https://www.applydjobs.com/dashboard/",
    "",
    "- Applyd",
  ].join("\n");

  const html =
    "<p>" +
    escapeHtml(hello) +
    "</p>" +
    "<p>Welcome to Applyd. Three steps and you're set. Then you send links, we handle the forms:</p>" +
    "<ol>" +
    "<li><strong>My Info</strong> - your answers, filled in once</li>" +
    "<li><strong>Resume</strong> - the PDF we submit with each application</li>" +
    "<li><strong>First job link</strong> - paste a posting to get going</li>" +
    "</ol>" +
    "<p>A human reviews every application before it goes out.</p>" +
    '<p><a href="https://www.applydjobs.com/dashboard/">Open your dashboard</a></p>' +
    "<p>- Applyd</p>";

  return { subject, text, html };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
