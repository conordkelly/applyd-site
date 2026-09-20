// GET /api/worker/resume?userId=<clerkUserId>
// Streams that user's resume PDF from R2 for the local fill worker.
// Auth: X-Worker-Key via /api/worker/_middleware.js (not Clerk).

function prefixFor(userId) {
  return `resumes/${userId}/`;
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const userId = (url.searchParams.get("userId") || "").trim();

  if (!userId) {
    return json({ error: "userId query param is required" }, 400);
  }

  if (!env.RESUMES) {
    return json(
      { error: "Resume storage isn't set up yet — create the R2 bucket first." },
      503
    );
  }

  let listed;
  try {
    listed = await env.RESUMES.list({ prefix: prefixFor(userId) });
  } catch (err) {
    return json(
      {
        error:
          "Couldn't reach resume storage — the R2 bucket may not exist yet.",
      },
      502
    );
  }

  if (!listed.objects.length) {
    return json({ error: "No resume on file for this user" }, 404);
  }

  const latestKey = listed.objects.sort((a, b) => b.uploaded - a.uploaded)[0]
    .key;
  const obj = await env.RESUMES.get(latestKey);
  if (!obj) {
    return json({ error: "No resume on file for this user" }, 404);
  }

  const displayFilename =
    (obj.customMetadata && obj.customMetadata.displayFilename) || "Resume.pdf";

  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${displayFilename.replace(
        /"/g,
        ""
      )}"`,
      "X-Applyd-User-Id": userId,
      "X-Applyd-Resume-Filename": displayFilename,
    },
  });
}
