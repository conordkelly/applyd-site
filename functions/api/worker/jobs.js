// GET /api/worker/jobs?status=processing|completed&limit=50
// PATCH /api/worker/jobs
//   { id, action: "ops_complete" | "reject" | "reopen" }
//   { id, status: "processing"|"completed" }  // legacy
// Auth: X-Worker-Key via /api/worker/_middleware.js

const USER_COMPLETE_DELAY_MINUTES = 10;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function promoteDueCompletions(env) {
  // processing + ops_completed_at old enough → user-visible completed
  try {
    await env.DB.prepare(
      `UPDATE jobs
       SET status = 'completed',
           completed_at = COALESCE(completed_at, datetime('now'))
       WHERE status = 'processing'
         AND rejected_at IS NULL
         AND ops_completed_at IS NOT NULL
         AND datetime(ops_completed_at) <= datetime('now', ?)`
    )
      .bind(`-${USER_COMPLETE_DELAY_MINUTES} minutes`)
      .run();
  } catch (e) {
    // Column missing until migration runs — ignore promote
    console.log("promoteDueCompletions:", String(e && e.message ? e.message : e));
  }
}

function jobSelectList() {
  return `SELECT j.id, j.user_id, j.job_url, j.status, j.created_at, j.completed_at,
            j.ops_completed_at, j.rejected_at, u.email AS user_email
     FROM jobs j
     LEFT JOIN users u ON u.id = j.user_id`;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const status = (url.searchParams.get("status") || "processing").trim();
  const limitRaw = parseInt(url.searchParams.get("limit") || "50", 10);
  const limit = Math.min(Math.max(limitRaw || 50, 1), 200);
  const userId = (url.searchParams.get("userId") || "").trim();

  const allowed = new Set(["processing", "completed"]);
  if (!allowed.has(status)) {
    return json({ error: "status must be processing or completed" }, 400);
  }

  await promoteDueCompletions(env);

  let results;
  try {
    if (status === "processing") {
      // Job Queue: open work only (not rejected, not ops-submitted waiting on delay)
      if (userId) {
        const q = await env.DB.prepare(
          `${jobSelectList()}
           WHERE j.user_id = ?
             AND j.status = 'processing'
             AND j.rejected_at IS NULL
             AND j.ops_completed_at IS NULL
           ORDER BY j.created_at ASC LIMIT ?`
        )
          .bind(userId, limit)
          .all();
        results = q.results || [];
      } else {
        const q = await env.DB.prepare(
          `${jobSelectList()}
           WHERE j.status = 'processing'
             AND j.rejected_at IS NULL
             AND j.ops_completed_at IS NULL
           ORDER BY j.created_at ASC LIMIT ?`
        )
          .bind(limit)
          .all();
        results = q.results || [];
      }
    } else {
      if (userId) {
        const q = await env.DB.prepare(
          `${jobSelectList()}
           WHERE j.user_id = ? AND j.status = 'completed'
           ORDER BY j.created_at ASC LIMIT ?`
        )
          .bind(userId, limit)
          .all();
        results = q.results || [];
      } else {
        const q = await env.DB.prepare(
          `${jobSelectList()}
           WHERE j.status = 'completed'
           ORDER BY j.created_at ASC LIMIT ?`
        )
          .bind(limit)
          .all();
        results = q.results || [];
      }
    }
  } catch (e) {
    return json(
      {
        error:
          "jobs query failed — run migrations/2026-09-21-jobs-ops-delay.sql on D1",
        detail: String(e && e.message ? e.message : e),
      },
      503
    );
  }

  return json({ jobs: results, count: results.length });
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const id = String(body.id || body.jobId || "").trim();
  if (!id) {
    return json({ error: "id is required" }, 400);
  }

  const action = String(body.action || "").trim();
  const status = String(body.status || "").trim();
  const opsComplete = body.ops_completed === true || action === "ops_complete";
  const reject = body.reject === true || action === "reject";
  const reopen = body.reopen === true || action === "reopen";

  const existing = await env.DB.prepare(
    "SELECT id, user_id, job_url, status FROM jobs WHERE id = ?"
  )
    .bind(id)
    .first();
  if (!existing) {
    return json({ error: "Job not found" }, 404);
  }

  try {
    if (opsComplete) {
      await env.DB.prepare(
        `UPDATE jobs
         SET ops_completed_at = COALESCE(ops_completed_at, datetime('now')),
             rejected_at = NULL
         WHERE id = ?`
      )
        .bind(id)
        .run();
    } else if (reject) {
      await env.DB.prepare(
        `UPDATE jobs
         SET rejected_at = datetime('now'),
             ops_completed_at = NULL
         WHERE id = ?`
      )
        .bind(id)
        .run();
    } else if (reopen) {
      await env.DB.prepare(
        `UPDATE jobs
         SET status = 'processing',
             completed_at = NULL,
             ops_completed_at = NULL,
             rejected_at = NULL
         WHERE id = ?`
      )
        .bind(id)
        .run();
    } else if (status === "completed") {
      // Legacy immediate complete (avoid for user-delay path)
      await env.DB.prepare(
        `UPDATE jobs
         SET status = 'completed',
             completed_at = datetime('now'),
             ops_completed_at = COALESCE(ops_completed_at, datetime('now')),
             rejected_at = NULL
         WHERE id = ?`
      )
        .bind(id)
        .run();
    } else if (status === "processing") {
      await env.DB.prepare(
        `UPDATE jobs
         SET status = 'processing',
             completed_at = NULL,
             ops_completed_at = NULL,
             rejected_at = NULL
         WHERE id = ?`
      )
        .bind(id)
        .run();
    } else {
      return json(
        {
          error:
            "provide action ops_complete|reject|reopen or status processing|completed",
        },
        400
      );
    }
  } catch (e) {
    return json(
      {
        error:
          "jobs update failed — run migrations/2026-09-21-jobs-ops-delay.sql on D1",
        detail: String(e && e.message ? e.message : e),
      },
      503
    );
  }

  await promoteDueCompletions(env);

  const row = await env.DB.prepare(`${jobSelectList()} WHERE j.id = ?`)
    .bind(id)
    .first();

  return json({ ok: true, job: row });
}
