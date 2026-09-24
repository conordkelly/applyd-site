// GET /api/dashboard/jobs/:id/screenshot
// Signed-in user only, own job, JPEG of the submitted page.

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestGet(context) {
  const { env, data, params } = context;
  const jobId = String((params && params.id) || "").trim();
  if (!jobId) {
    return json({ error: "id is required" }, 400);
  }

  const job = await env.DB.prepare(
    "SELECT id, user_id FROM jobs WHERE id = ? AND user_id = ?"
  )
    .bind(jobId, data.userId)
    .first();
  if (!job) {
    return json({ error: "Job not found" }, 404);
  }

  if (!env.RESUMES) {
    return json({ error: "No screenshot" }, 404);
  }

  const key = `job-screenshots/${data.userId}/${job.id}.jpg`;
  let obj;
  try {
    obj = await env.RESUMES.get(key);
  } catch {
    return json({ error: "No screenshot" }, 404);
  }
  if (!obj) {
    return json({ error: "No screenshot" }, 404);
  }

  return new Response(obj.body, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
