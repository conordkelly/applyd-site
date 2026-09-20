// Resume PDF storage in R2. One resume per user: every upload replaces
// whatever was there before (list-and-delete under the user's own prefix,
// then put the new object) rather than accumulating history.
//
// Every operation is scoped to the authenticated user's own prefix
// (`resumes/{userId}/`) derived from the Clerk session in _middleware.js —
// no request ever accepts a client-supplied key, so there's no way for one
// user to read, replace, or delete another user's resume.

const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

function prefixFor(userId) {
  return `resumes/${userId}/`;
}

function sanitizeBaseName(name) {
  let base = String(name || "resume").replace(/\.[^/.]+$/, "");
  base = base.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return (base || "resume").slice(0, 60);
}

// ATS-facing filename: prefer "FirstLast_Resume.pdf" derived from the
// profile already on file, since that's what most ATS forms show back to
// a recruiter; fall back to a sanitized version of whatever the user
// actually uploaded.
async function buildDisplayFilename(env, userId, originalName) {
  try {
    const row = await env.DB.prepare("SELECT data FROM profiles WHERE user_id = ?")
      .bind(userId)
      .first();
    if (row) {
      const profile = JSON.parse(row.data);
      const identity = (profile.canonical && profile.canonical.identity) || {};
      const first = (profile.first_name || identity.first_name || "").trim();
      const last = (profile.last_name || identity.last_name || "").trim();
      const combined = (first + last).replace(/[^a-zA-Z0-9]/g, "");
      if (combined) return combined + "_Resume.pdf";
    }
  } catch {
    // fall through to the sanitized original name
  }
  return sanitizeBaseName(originalName) + ".pdf";
}

async function clearExisting(env, userId) {
  const listed = await env.RESUMES.list({ prefix: prefixFor(userId) });
  await Promise.all(listed.objects.map((o) => env.RESUMES.delete(o.key)));
}

export async function onRequestPost(context) {
  const { request, env, data } = context;

  if (!env.RESUMES) {
    return json({ error: "Resume storage isn't set up yet — the R2 bucket needs to be created and bound first." }, 503);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Expected multipart form data" }, 400);
  }

  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    return json({ error: "No file provided" }, 400);
  }

  if (file.size > MAX_BYTES) {
    return json({ error: "File is too large — max 10MB" }, 400);
  }

  const nameLooksLikePdf = /\.pdf$/i.test(file.name || "");
  if (!nameLooksLikePdf && file.type && file.type !== "application/pdf") {
    return json({ error: "Only PDF files are accepted" }, 400);
  }

  const buffer = await file.arrayBuffer();
  const head = new Uint8Array(buffer.slice(0, 5));
  const isPdf = PDF_MAGIC.every((b, i) => head[i] === b);
  if (!isPdf) {
    return json({ error: "That file doesn't look like a valid PDF" }, 400);
  }

  const displayFilename = await buildDisplayFilename(env, data.userId, file.name);
  const key = `${prefixFor(data.userId)}${Date.now()}-${sanitizeBaseName(file.name)}.pdf`;

  try {
    await clearExisting(env, data.userId);

    await env.RESUMES.put(key, buffer, {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: {
        displayFilename,
        uploadedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    // Most likely cause: the binding exists in wrangler.toml but the R2
    // bucket itself hasn't been created yet. See UI_CONTEXT.md "Resume
    // storage (R2)" for the exact `wrangler r2 bucket create` step.
    return json({ error: "Couldn't reach resume storage — the R2 bucket may not exist yet." }, 502);
  }

  return json({
    resume_url: "/api/dashboard/resume",
    resume_upload_filename: displayFilename,
    key,
  });
}

// Streams the signed-in user's own resume back. Deliberately takes no
// key/userId from the request — always resolves from the authenticated
// session, so this doubles as the access-control check.
export async function onRequestGet(context) {
  const { env, data } = context;

  if (!env.RESUMES) {
    return json({ error: "Resume storage isn't set up yet" }, 503);
  }

  let listed;
  try {
    listed = await env.RESUMES.list({ prefix: prefixFor(data.userId) });
  } catch (err) {
    return json({ error: "Couldn't reach resume storage — the R2 bucket may not exist yet." }, 502);
  }
  if (!listed.objects.length) {
    return json({ error: "No resume on file" }, 404);
  }

  const latestKey = listed.objects.sort((a, b) => b.uploaded - a.uploaded)[0].key;
  const obj = await env.RESUMES.get(latestKey);
  if (!obj) {
    return json({ error: "No resume on file" }, 404);
  }

  const displayFilename = (obj.customMetadata && obj.customMetadata.displayFilename) || "Resume.pdf";

  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${displayFilename.replace(/"/g, "")}"`,
    },
  });
}

export async function onRequestDelete(context) {
  const { env, data } = context;

  if (!env.RESUMES) {
    return json({ error: "Resume storage isn't set up yet" }, 503);
  }

  try {
    await clearExisting(env, data.userId);
  } catch (err) {
    return json({ error: "Couldn't reach resume storage — the R2 bucket may not exist yet." }, 502);
  }
  return json({ ok: true });
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}
