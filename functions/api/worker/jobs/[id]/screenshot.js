// PUT /api/worker/jobs/:id/screenshot
// Local apply_worker.py uploads the filled-page JPEG after review-ready.

const MAX_BYTES = 8 * 1024 * 1024;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

export function screenshotKey(userId, jobId) {
  return `job-screenshots/${userId}/${jobId}.jpg`;
}

export async function onRequestPut(context) {
  const { request, env, params } = context;
  const jobId = String((params && params.id) || "").trim();
  if (!jobId) {
    return json({ error: "id is required" }, 400);
  }

  const job = await env.DB.prepare(
    "SELECT id, user_id FROM jobs WHERE id = ?"
  )
    .bind(jobId)
    .first();
  if (!job) {
    return json({ error: "Job not found" }, 404);
  }

  if (!env.RESUMES) {
    return json({ error: "Screenshot storage is not configured" }, 503);
  }

  const type = String(request.headers.get("Content-Type") || "").toLowerCase();
  if (
    type &&
    type.indexOf("image/jpeg") === -1 &&
    type.indexOf("image/jpg") === -1 &&
    type.indexOf("image/png") === -1 &&
    type.indexOf("application/octet-stream") === -1
  ) {
    return json({ error: "Expected a JPEG image" }, 400);
  }

  const buffer = await request.arrayBuffer();
  if (!buffer.byteLength) {
    return json({ error: "Empty screenshot" }, 400);
  }
  if (buffer.byteLength > MAX_BYTES) {
    return json({ error: "Screenshot is too large" }, 400);
  }

  await env.RESUMES.put(screenshotKey(job.user_id, job.id), buffer, {
    httpMetadata: { contentType: "image/jpeg" },
  });

  return json({ ok: true });
}
