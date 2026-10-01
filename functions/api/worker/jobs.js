// GET /api/worker/jobs?status=processing|completed&limit=50
// PATCH /api/worker/jobs
//   { id, action: "ops_complete" | "reject" | "reopen", reason? }
//   { id, status: "processing"|"completed" }  // legacy
// Auth: X-Worker-Key via /api/worker/_middleware.js

const USER_COMPLETE_DELAY_MINUTES = 2;

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

// withReason=false drops rejected_reason — used as a fallback when
// migrations/2026-09-30-rejected-reason.sql hasn't been run on D1 yet, so
// this endpoint (and ApplyD Review's Job Queue/Current/Cancelled tabs,
// which all read it) keeps working with no reason support rather than
// 503ing outright. Run that migration whenever convenient to pick up reasons.
function jobSelectList(withReason) {
  return `SELECT j.id, j.user_id, j.job_url, j.status, j.created_at, j.completed_at,
            j.ops_completed_at, j.rejected_at${withReason ? ", j.rejected_reason" : ""},
            u.email AS user_email
     FROM jobs j
     LEFT JOIN users u ON u.id = j.user_id`;
}

async function fetchJobs(env, status, userId, limit, withReason) {
  const sel = jobSelectList(withReason);
  if (status === "processing") {
    // Job Queue: open work only (not rejected, not ops-submitted waiting on delay)
    const q = userId
      ? await env.DB.prepare(
          `${sel}
           WHERE j.user_id = ?
             AND j.status = 'processing'
             AND j.rejected_at IS NULL
             AND j.ops_completed_at IS NULL
           ORDER BY j.created_at ASC LIMIT ?`
        )
          .bind(userId, limit)
          .all()
      : await env.DB.prepare(
          `${sel}
           WHERE j.status = 'processing'
             AND j.rejected_at IS NULL
             AND j.ops_completed_at IS NULL
           ORDER BY j.created_at ASC LIMIT ?`
        )
          .bind(limit)
          .all();
    return q.results || [];
  }
  const q = userId
    ? await env.DB.prepare(
        `${sel}
         WHERE j.user_id = ? AND j.status = 'completed'
         ORDER BY j.created_at ASC LIMIT ?`
      )
        .bind(userId, limit)
        .all()
    : await env.DB.prepare(
        `${sel}
         WHERE j.status = 'completed'
         ORDER BY j.created_at ASC LIMIT ?`
      )
        .bind(limit)
        .all();
  return q.results || [];
}

async function fetchJobsWithFallback(env, status, userId, limit) {
  try {
    return await fetchJobs(env, status, userId, limit, true);
  } catch (e) {
    // rejected_reason column missing — retry without it.
    const rows = await fetchJobs(env, status, userId, limit, false);
    return rows.map((r) => ({ ...r, rejected_reason: null }));
  }
}

async function fetchJobRow(env, id) {
  try {
    return await env.DB.prepare(`${jobSelectList(true)} WHERE j.id = ?`)
      .bind(id)
      .first();
  } catch (e) {
    const row = await env.DB.prepare(`${jobSelectList(false)} WHERE j.id = ?`)
      .bind(id)
      .first();
    if (row) row.rejected_reason = null;
    return row;
  }
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
    results = await fetchJobsWithFallback(env, status, userId, limit);
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
  const reasonRaw = typeof body.reason === "string" ? body.reason.trim() : "";
  const reason = reasonRaw ? reasonRaw.slice(0, 2000) : null;

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
      // rejected_at is COALESCEd so re-sending a reason (e.g. filled in
      // later from ApplyD Review's Cancelled Jobs tab) doesn't reset the
      // date shown on the user's Unable to Process tab. reason only
      // overwrites when one was actually sent this call.
      try {
        await env.DB.prepare(
          `UPDATE jobs
           SET rejected_at = COALESCE(rejected_at, datetime('now')),
               ops_completed_at = NULL,
               rejected_reason = COALESCE(?, rejected_reason)
           WHERE id = ?`
        )
          .bind(reason, id)
          .run();
      } catch (e) {
        // rejected_reason column missing — reject still works, the reason
        // just doesn't persist until migrations/2026-09-30-rejected-reason.sql
        // is run on D1.
        await env.DB.prepare(
          `UPDATE jobs
           SET rejected_at = COALESCE(rejected_at, datetime('now')),
               ops_completed_at = NULL
           WHERE id = ?`
        )
          .bind(id)
          .run();
      }
    } else if (reopen) {
      try {
        await env.DB.prepare(
          `UPDATE jobs
           SET status = 'processing',
               completed_at = NULL,
               ops_completed_at = NULL,
               rejected_at = NULL,
               rejected_reason = NULL
           WHERE id = ?`
        )
          .bind(id)
          .run();
      } catch (e) {
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
      }
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
      try {
        await env.DB.prepare(
          `UPDATE jobs
           SET status = 'processing',
               completed_at = NULL,
               ops_completed_at = NULL,
               rejected_at = NULL,
               rejected_reason = NULL
           WHERE id = ?`
        )
          .bind(id)
          .run();
      } catch (e) {
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
      }
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

  const row = await fetchJobRow(env, id);

  return json({ ok: true, job: row });
}
