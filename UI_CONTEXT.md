# Applyd — UI Context

Living record of what's built on the web side, and why. **Update this file
whenever the UI changes** — new views, new fields, restyled nav, new
endpoints. Treat it as the source of truth for "what does the site currently
do," separate from the marketing plan.

Last updated: 2026-09-16 (later same day: ATS logos added).

## Stack

- Cloudflare Pages — static hosting, no build step, no framework. Deploys
  automatically on `git push` to `main`.
- Cloudflare Pages Functions (`functions/api/**`) — hand-rolled, no npm
  dependencies (this machine has no `node`/`npm`/`wrangler` CLI). Clerk
  session verification is done manually via Web Crypto against Clerk's JWKS
  endpoint (`functions/api/dashboard/_middleware.js`) instead of
  `@clerk/backend`.
- Cloudflare D1 (SQLite) — data store. Managed through the Cloudflare
  dashboard's D1 Console (Workers & Pages → D1 → `applyd-jobs` →
  **Console** tab), since there's no local CLI to run migrations. Any schema
  change means: update `schema.sql` in the repo, *and* paste the matching
  `CREATE TABLE` / `ALTER TABLE` into that console by hand.
- Clerk — auth, loaded via vanilla `clerk-js` `<script>` tag (no SDK
  bundler). `Clerk.mountSignIn()`, `Clerk.mountUserButton()`,
  `Clerk.openUserProfile()`, session tokens via
  `Clerk.session.getToken()`.

## Pages

- `index.html` — marketing/landing page. Root domain, individual-job-seeker
  focused as of 2026-09-10 (see below — was agency-focused before that).
- `agencies-landing-archive.html` — a frozen copy of the agency-focused
  homepage exactly as it was live before the 2026-09-10 rewrite. Kept so
  the agency pitch isn't lost; not wired into any route. Candidate to
  become a real `/agencies` page later, once there's an actual multi-user
  agency flow to point it at — see "Positioning" below.
- `dashboard/index.html` — the authenticated app. Everything below is this
  one file (styles, markup, and vanilla JS all inline).

## Marketing page (`index.html`)

Same design-token system as the dashboard (see table below — `index.html`
defines its own copy of the same tokens plus `--surface-2` and `--glow`).
One long page: topbar → hero → stat strip → demo (placeholder) → how it
works → closing CTA → footer. No routing, no build step, just static
HTML/CSS/JS with two forms wired to a Cloudflare Pages Function.

**Positioning:** individuals are the primary audience at the root domain,
not agencies. This was a deliberate call, not just a copy change — the
actual product (the dashboard) is a single-user tool with no roster view,
no multi-candidate management, and no agency-scoped admin. The old agency
copy ("every candidate on your roster") was selling something the backend
couldn't do. Onboarding an agency is still possible without new backend
work (create N individual accounts, manage them the same way as any user
via the existing global Admin view — see dashboard docs above) — it just
isn't a self-serve landing-page flow, so it doesn't need to own the
homepage. The archived agency page can come back as a `/agencies` page
later, aimed at conversations already in progress rather than cold
traffic.

**Hero headline:** "Never Complete Another Job Application." — landed on
after trying several directions (relatable/pain-first, outcome-driven
with fabricated stats, a Squarespace-style full-bleed photo hero, a
before/after comparison, a centered conversational layout). Outcome-driven
copy with invented precision ("3.2x more interviews, on average", "142
apps submitted since Monday") was explicitly rejected as reading like
AI-generated filler — the fix was swapping fabricated numbers for either
true capability statements (any ATS, one profile) or the real product UI
itself. **Style rule carried into all shipped copy on this page: no em
dashes.** Rewrite them as periods, commas, colons, or (inside the
manifest rows) a middle dot — this was an explicit standing request, not
a one-off edit, so keep applying it to anything new written for this
page.

**Manifest widget** (`.manifest`, `.manifest-row`, `#rows`/`#counter`/
`#clock` in the closing `<script>`), labeled "Live Application Tracker" in
the UI: a live-updating "activity feed" — counter ticks up from a seeded
seed of 214, rows fade in (`rowIn` animation) picking a random
`[company, role]` pair from the `companies` array in the script, clock
next to it shows the real current time (`timeNow()`), 12-hour with
AM/PM (not 24-hour, not an elapsed timer). `timeNow()` is also used for
each row's timestamp; the row's fixed-width time column was widened
(64px → 88px, plus `white-space: nowrap`) to fit the longer `h:mm:ss AM`
string without wrapping. Originally showed a `candidate → company` format
(built for the agency-roster framing); the candidate name and array were
removed when the page went individual-first, since there's only one
person applying, not a roster. Row format is now `Company · Role`.

**Stat strip:** three stats, each answering a different objection —
"1 / thing you have to do: paste the link" (is this hard to use?),
"10 secs / time to complete 1 application, versus 30 minutes by hand"
(does it save time? — an honest comparison of typical application time
vs. the product's actual mechanics, not a fabricated outcome stat),
"All Major Application Platforms" plus the real ATS logos (will it work
with the job sites I use?). Keep each stat's `.figure` short (a number
or a couple words) — a full phrase there wraps to multiple lines and
makes that column visibly taller than the other two, breaking the row's
alignment. Caption tone should stay plain across all three: no
parentheses, no abbreviations like "vs" (spell out "versus"), no em
dashes.

Every `.stat` is a centered flex column (`align-items: center`,
`justify-content: center`, `text-align: center`) so shorter stats sit
centered within the row's full height instead of top-aligned against
whichever stat is tallest — this matters because the third stat (ATS)
is taller than the other two once its logos/heading are accounted for.

The ATS stat's heading was originally "All Major ATS" with a
"Workday, Greenhouse, Ashby, Lever, and more" caption underneath. Once
the real logos (`.stat-ats-row` > `.stat-ats-logos`, inline to the right
of the figure text, wrapping below it on narrow screens) were added,
that caption became redundant and was removed, and the heading was
changed to the fuller "All Major Application Platforms" — but that
phrase is too long for the shared 34px `.figure` size (it wraps to
three lines and makes the column visibly taller than the other two).
Fix: a `.figure-ats` modifier class (`.stat .figure.figure-ats`, note
the specificity — a bare `.figure-ats` alone loses to `.stat .figure`)
drops it to 20px, which wraps to a clean two lines instead. Images are
embedded as base64 `data:` URIs directly in the HTML — same convention
as this file's fonts and favicon, so the page stays one self-contained
file with no external asset requests. `.stat-strip` stays
`repeat(3, 1fr)` — an earlier version widened the third column
(`1fr 1fr 1.5fr`) to give the logos more room, but that made the row
look lopsided once it actually rendered, so it was reverted; the logos
fit fine at an equal 1fr share. Source logo files aren't kept in the
repo (they were embedded once from the user's Downloads folder); to
swap or add a logo, get the new image file, base64-encode it, and
replace the relevant `data:` URI.

**Waitlist form:** `<form id="hero-form">` and `<form id="closing-form">`,
each wired by the shared `wireForm(formId, blockId)` function at the
bottom of the script. Submits POST to `/api/subscribe` with `{ email }`,
toggles the block's class to `sent` or `error` based on the response —
this is a real working Cloudflare Pages Function backed by the `WAITLIST`
KV namespace (see `wrangler.toml`), not a placeholder. Both submit
buttons read "Start Today" (renamed from "Get early access"). Any new
landing copy that reuses these form ids keeps this working automatically;
a fresh form needs its own `wireForm(...)` call added at the bottom of
the script.

**Topbar auth links:** `.create-account-link` (outlined, secondary) and
`.sign-in-link` (solid accent, primary) sit side by side in
`.topbar-right`, both pointing at `/dashboard` — there's no separate
sign-up route; Clerk's `mountSignIn()` widget on that page handles both
sign-in and account creation in one embedded flow.

## Design tokens (`dashboard/index.html`)

Theme-aware: light is the default `:root`, dark applies via
`prefers-color-scheme` and via `[data-theme="dark"]`.

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#F2F4F7` | `#0A0C10` |
| `--surface` | `#FFFFFF` | `#12151B` |
| `--text` | `#12151B` | `#EDEFF3` |
| `--text-2` | `#525964` | `#98A0AC` |
| `--text-3` | `#868D98` | `#5B6270` |
| `--accent` | `#1D5FD1` | `#4C8DFF` |
| `--accent-ink` | `#F5F9FF` | `#071223` |
| `--signal` | `#2F8F5B` | `#6DBF8B` |
| `--hairline` | `rgba(18,21,27,.10)` | `rgba(237,239,243,.09)` |
| `--hairline-strong` | `rgba(18,21,27,.20)` | `rgba(237,239,243,.18)` |

Fonts: **Big Shoulders Display** (headings, wordmark), **Hanken Grotesk**
(body text), **JetBrains Mono** (labels, nav, buttons, tabular data —
the site's default "voice" for UI chrome is monospace/uppercase).

Mobile breakpoint: `@media (max-width: 520px)`.

## Dashboard structure

Top-level layout: `.topbar` (brand + nav + avatar) → one of three mutually
exclusive `<div>` sections toggled by JS (`showJobsView()`, `showInfoView()`,
`showAdminView()`), all children of `#app-view`:

- `#jobs-section` — default view
- `#info-section` — "My Info"
- `#admin-section` — hidden unless the signed-in user is the admin

### Top nav

`.topbar-left` groups the brandmark + `.nav-group` together (left-aligned,
"primary nav next to the logo" pattern); `.topbar-right` holds just the
Clerk user-button avatar.

`.nav-group` buttons, in order: **Home** (plain link to `/`), **My Jobs**,
**My Info**, **Admin** (`display:none` until the admin check passes). All
four share one `.nav-link` style — same font/size/case/weight — this was a
deliberate correction: an earlier version styled "Back to site" differently
(a separate boxed link) from the view-switch buttons, and the user asked
for all top nav items to look consistent. Active view gets `.nav-link.active`
(accent color + 2px bottom border).

Admin's visibility check (`dashboard/index.html`, `window.addEventListener
('load', ...)`):
```js
var ADMIN_USER_ID = 'user_3JeY8TVmctjpcU6GbaK4l888Ak9'; // must match ADMIN_USER_ID in wrangler.toml
```

**History note:** a Clerk-native `customMenuItems` approach for putting
Admin inside Clerk's own avatar dropdown was tried and abandoned — it
didn't render and couldn't be confirmed against real `@clerk/types`
definitions. A separate plain `<button>` in the topbar works and is what's
live.

### My Jobs (`#jobs-section`)

Segmented pill switcher (`.tabs` / `.tab-btn`, active tab filled solid,
accent background) between three panels:

- **Submission** — a blank grid (`table.grid`) the user pastes job links
  into, `+ Add row`, `Submit`. Submitting POSTs to `/api/dashboard/jobs`
  and clears the grid.
- **Processing** — jobs with `status = 'processing'`, fetched from
  `/api/dashboard/jobs` (GET), rendered as a table with a "Submitted"
  date column.
- **Completed** — jobs with `status = 'completed'`, same endpoint,
  "Date Submitted" column uses `completed_at`.

**Not connected to the real Google Sheet or worker yet** — this is UI +
D1 only, by explicit choice ("I don't want it to connect to a live google
sheet yet"). Real-worker connection is deferred, tracked as a later phase.

### My Info (`#info-section`)

An editable application-profile form — **not** account settings. Its
purpose: capture everything a job application typically asks for once, so
the worker can auto-fill applications from it later. Expanded 2026-09-20
to match the canonical contract in
`~/job-automation-ai/context/SHARED_PROFILE_SCHEMA.md` (the shape the
worker actually needs), rather than the earlier ad hoc field set modeled
loosely on `~/.applyd/profile.json`.

Sections (`.field-group`), each a fieldset-style block, two-column grid on
desktop (`.field-grid`, collapses to one column under 520px):

1. **Resume** — moved to the top of the form 2026-09-21 (was last), since
   it's the field most users fill in first. Real PDF file input
   (`f-resume_file`) only now — the plain-text paste box (`f-resume_text`)
   was removed the same day; nothing reads it (`apply_worker.py` has no
   reference to `resume_text` at all), so it was pure unused surface area.
   Selecting a file uploads it **immediately** (not on "Save info") to
   `POST /api/dashboard/resume`, which stores it in R2 (see "Resume
   storage (R2)" below). On success the client sets
   `resume_upload_filename` / `resume_uploaded_at` / `resume_url` and
   auto-saves the profile blob right away, so a resume left on the page
   mid-edit doesn't get orphaned if the tab closes before "Save info" is
   clicked. Shows "Current file on record: `<name>`" plus a **Remove
   resume** button (`resume-remove-btn`, only visible when a resume is on
   file) that calls `DELETE /api/dashboard/resume` and clears those three
   fields. A status line (`#resume-upload-status`) shows "Uploading...",
   "Uploaded and saved.", or the server's error message. Selecting a new
   file always replaces whatever was on file — there's no separate
   "Replace" control, the file input's `change` handler doubles as both
   first upload and replace. **Resume parsing/autofill (asked about
   2026-09-21, not built):** sending the PDF to Claude's API to extract
   fields and autofill the rest of the form is planned but deferred —
   needs an `ANTHROPIC_API_KEY` secret added in Cloudflare first.
2. **Personal** — first name, last name, full legal name (auto-fills from
   first + last on save if left blank), preferred name, phone (digits-only,
   auto-formats as `555-123-4567` via `formatPhoneNumber()`), phone country,
   country, street address, city, state/province, postal code,
   LinkedIn/GitHub/portfolio URLs.

   **Three searchable combobox fields** (phone country, country,
   state/province) share one implementation: `createSearchableCombobox()`.
   Each field is a plain `<input>` wrapped in `.country-field` with a
   `.country-chevron` SVG and a `.country-dropdown-list` panel
   (`#phone-country-list` / `#country-name-list` / `#province-list`) —
   typing filters, arrow keys + Enter navigate/pick, clicking an option
   selects it, opening always shows the full list (never filters against
   whatever's already selected, which would just show "No matches" against
   itself). Added 2026-09-22 as a shared helper once there were three
   near-identical copies of the same widget; before that, phone country and
   state/province each had their own ~120-line duplicate.
   - **Phone country** — `#phone-country-field`/`#phone-country-list`,
     labels `"Name (+Code)"` from `PHONE_COUNTRY_PINNED` (United States,
     Canada, United Kingdom) + `PHONE_COUNTRY_CODES` (~196 more,
     alphabetical), `required`.
   - **Country** — `#country-name-field`/`#country-name-list`, reuses the
     exact same `PHONE_COUNTRY_PINNED`/`PHONE_COUNTRY_CODES` data as phone
     country (no second country list to maintain) but labels just the name,
     no dial code. The existing country → "currently reside in Canada?"
     blur auto-fill (see Location Preferences below) still fires normally,
     since selecting an option only sets `.value` — it doesn't touch the
     field's own blur listener.
   - **State / province** — `#province-field`/`#province-list`. **The
     separate "code" and "full name" fields from earlier were merged into
     this one field on 2026-09-21** — having both was redundant once the
     code can be parsed back out of whichever option gets picked. Labels
     are `"Name (Code)"` (e.g. "Ontario (ON)") built from
     `PROVINCE_FULL_NAMES`, Ontario pinned above a divider. On save,
     `collectProfileForm()` splits the picked label back into two flat keys
     — `province_full` ("Ontario") and `state_province` ("ON") — via one
     regex (`/^(.*?)\s*\(([A-Za-z]{2,3})\)\s*$/`), so both are still
     available for ATS forms that specifically want the 2-letter code (very
     common — Workday/Greenhouse state fields are usually a code
     `<select>`) even though there's no `state_province` input anymore. On
     load, `fillProfileForm()` re-combines those two saved keys back into
     the single displayed "Name (Code)" string.
3. **Work Authorization** — authorized to work? require sponsorship?
   require *future* sponsorship? (new), status (free text).
4. **Location Preferences** (new section) — preferred job location (the
   "where you want roles" geo string, distinct from home address), willing
   to work onsite/hybrid locally?, willing to relocate?, currently reside
   in Canada? (auto-fills Yes/No from the Country field on blur if empty).
5. **Experience** — current title, current company (new), years of
   experience, education level, school/university name (new, required by
   the worker), degree name (new), graduation year (new), target roles.
6. **Work Experience Points** (new section, directly under Experience) —
   dynamic repeatable role cards (`+ Add role` / `Remove role`), each with
   company, title, start/end month pickers or an "I currently work here"
   checkbox that disables the end date, and a repeatable bullet list
   (`+ Add bullet` / per-bullet `Remove`). Persisted as
   `profile.experience_roles`, an array of
   `{ company, role, start, end, present, bullets: [''] }` — the same
   shape `experience_bank.json` uses, so it can eventually merge with that
   local worker file. Rendered/managed entirely in vanilla JS
   (`renderExperienceRoles()`, `renderRoleCard()`, `renderBulletRow()`) —
   no framework, consistent with the rest of the dashboard.
7. **Compensation** — desired salary, currency, minimum acceptable,
   maximum range, plus a live read-only preview line ("Shown on
   applications as: 90K-120K CAD") built by `buildSalaryDisplay()` /
   `buildSalaryTypedBand()` and saved as `salary_display` /
   `salary_typed_band`.
8. **Preferences** (new section) — SMS/text consent (default No), how did
   you hear about us (default LinkedIn), pronouns.
9. **Voluntary Disclosures** (EEO) — gender, race/ethnicity, veteran
   status, disability status. All default to "Decline to self-identify."

**Explicitly left out:** an ATS-account `password` field that exists in
the local `profile.json` (used by the real worker to create accounts on
job sites per-application). Storing other users' passwords on a
multi-tenant dashboard wasn't something to do without a separate
conversation about it — flagged, not built.

Top of the panel also shows "Signed in as `{email}`" with a **manage
account** link that opens Clerk's own account modal
(`Clerk.openUserProfile()`) for things like changing email/password —
this covers *account* settings, separate from the *application profile*
data below it.

Saved as one JSON blob per user via `GET`/`POST /api/dashboard/profile`
(see Backend below). Flat fields still live in JS as `PROFILE_FIELDS` —
the generic `fillProfileForm()` / `collectProfileForm()` functions loop
over that array, so adding a simple field is: add the `<input>` (id
`f-<key>`) + add `<key>` to `PROFILE_FIELDS`. On save, `collectProfileForm()`
also calls `buildCanonicalProfile()`, which maps the flat fields (plus
`experience_roles`) into the **nested canonical shape** from
`SHARED_PROFILE_SCHEMA.md` and attaches it as `profile.canonical` — so the
saved blob carries both the flat form keys (back-compat / easy re-fill)
and the nested object the worker/product side actually wants. Yes/No
selects all use capitalized `"Yes"`/`"No"` values directly now (not
lowercase) — `normalizeYesNo()` still coerces old lowercase data on load
for safety.

**Known gap, called out by the user (2026-09-02):** this is "a very good
start" but will need real expansion to cover the actual range of things
job applications ask. The 2026-09-20 expansion above addresses that first
round; expect more sections/fields over time — keep this doc in sync when
that happens.

### Admin (`#admin-section`)

Visible only to `ADMIN_USER_ID`. Fetches `/api/dashboard/admin` (GET,
403s for anyone else), renders every user grouped in a `.user-group` card
— email header + job count, then each user's jobs as a table (link,
status chip, submitted date, completed date).

## Backend (`functions/api/dashboard/`)

All routes behind `_middleware.js`, which verifies the Clerk session JWT
by hand (RS256 via Web Crypto against `${CLERK_ISSUER}/.well-known/jwks.json`,
cached 10 min) and sets `context.data = { userId, email }`. Also
self-heals the `users` row on every request (upsert, backfills email if
it was blank — Clerk's default token doesn't include email; a custom
session claim `{"email": "{{user.primary_email_address}}"}` is configured
in Clerk Dashboard → Sessions → Customize session token to make this
available at all).

| Route | Method | Does |
|---|---|---|
| `dashboard/jobs.js` | GET | Returns `{ processing: [...], completed: [...] }` for the signed-in user |
| `dashboard/jobs.js` | POST | Validates links (`new URL()`), inserts as `status='processing'` |
| `dashboard/profile.js` | GET | Returns `{ profile: {...} }` — parsed JSON blob for the signed-in user, `{}` if none saved yet |
| `dashboard/profile.js` | POST | Upserts the whole `profile` object as one JSON blob |
| `dashboard/resume.js` | POST | Multipart upload (`file` field) → validates PDF, stores in R2, returns `{ resume_url, resume_upload_filename, key }` |
| `dashboard/resume.js` | GET | Streams the signed-in user's own resume PDF back (used for eventual worker/ATS-attach fetches, not linked from the UI today) |
| `dashboard/resume.js` | DELETE | Deletes the signed-in user's resume object(s) from R2 |
| `dashboard/admin.js` | GET | 403 unless `userId === env.ADMIN_USER_ID`; otherwise every user + their jobs |

## Resume storage (R2)

`functions/api/dashboard/resume.js` handles PDF storage, separate from the
`profiles` JSON blob (D1 isn't a good place for binary file bytes). One
resume per user: every upload lists and deletes whatever's under that
user's own prefix before writing the new object, so there's never more
than one file to go stale.

**Bucket layout:** `resumes/{clerkUserId}/{timestamp}-{sanitizedName}.pdf`.
Every route (`GET`/`POST`/`DELETE`) derives the prefix from
`context.data.userId` (set by `_middleware.js` from the verified Clerk
JWT) — **no route ever accepts a client-supplied key**, so there's no way
to read, replace, or delete another user's file by guessing or passing a
different key. This is also why cross-user access control needed no new
D1 columns: the R2 key's own path *is* the access boundary.

**Access model — authenticated download, not public R2:** chose an
authenticated `GET /api/dashboard/resume` (streams the object through the
existing Clerk-session check) over a public R2 custom domain or `r2.dev`
public bucket. Resumes carry full name, address, phone — real PII — so
"unguessable URL" isn't an acceptable substitute for actual access
control, and a public bucket has no way to enforce "only this user" at
all. The cost is that `assets.resume_url` is the **same relative path for
every user** (`/api/dashboard/resume`) rather than a unique per-file URL —
whoever calls it (the browser today, a future worker) must present their
own auth and gets back *their own* resume, not a specific file by URL.

**Worker access (built):** separate routes under `/api/worker/*` with their
own middleware — not the Clerk dashboard middleware. Auth is
`X-Worker-Key: <WORKER_API_KEY>` (or `Authorization: Bearer …`). Set
`WORKER_API_KEY` as an encrypted Pages secret (Production + Preview).

| Route | Returns |
|---|---|
| `GET /api/worker/profile?userId=` | `{ user, profile, canonical, resume }` |
| `GET /api/worker/resume?userId=` | PDF stream from R2 for that user |
| `GET /api/worker/jobs?status=processing` | Open queue (not rejected, not ops-completed waiting on delay) |
| `PATCH /api/worker/jobs` | `action`: `ops_complete` (10 min user delay), `reject`, `reopen`; or legacy `status` |

Python worker + ApplyD Review: Start Job / ✕ reject / Re-queue / ops_complete.
User Completed tab promotes ~10 min after ops Submit. Requires D1 columns
`ops_completed_at`, `rejected_at` (see `migrations/2026-09-21-jobs-ops-delay.sql`).

**Validation on upload:** PDF only, checked three ways — filename ends in
`.pdf`, `Content-Type` is `application/pdf` if the browser sent one, and
the first 5 bytes of the file are the `%PDF-` magic number (catches a
renamed non-PDF even if the first two checks are spoofed). Max 10MB,
rejected before the buffer is even read into R2 if the browser-reported
size is over that. None of this is logged.

**Display filename:** `buildDisplayFilename()` in `resume.js` looks up
the user's already-saved profile row and, if `first_name`/`last_name` (or
`canonical.identity`) are present, names the file `FirstLast_Resume.pdf`
— the ATS-facing name is deliberately not whatever the user's local file
happened to be called. Falls back to a sanitized version of the original
filename if no name is on file yet (e.g. resume uploaded before Personal
section is filled in).

**Setting up the actual bucket** (not done as part of writing this code —
needs to run once, with Cloudflare account access):

```bash
# 1. Create the bucket (from applyd-site/, needs `wrangler login` once first)
wrangler r2 bucket create applyd-resumes
```

Or via the dashboard: Cloudflare dashboard → R2 → Create bucket → name it
`applyd-resumes` → Create (no public access, no custom domain needed —
this project uses the authenticated-download model above, not public R2).

The `[[r2_buckets]]` binding is already in `wrangler.toml` (binding
`RESUMES`, bucket `applyd-resumes`), and this project's D1/KV bindings
already work through git-push deploys without a manual dashboard binding
step — Cloudflare Pages reads bindings from `wrangler.toml` on build. If
the binding doesn't show up automatically after the bucket exists and a
deploy runs, add it manually: Cloudflare dashboard → Pages → applyd-site
→ Settings → Functions → R2 bucket bindings → Add binding → variable name
`RESUMES`, bucket `applyd-resumes` (set for both Production and Preview).

**Until the bucket exists**, `env.RESUMES` is `undefined` and every route
in `resume.js` returns `503 { error: "Resume storage isn't set up yet" }`
instead of throwing — the upload UI surfaces that message inline rather
than silently failing.

## D1 schema (`schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  job_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`profiles.data` holds the whole "My Info" form as one JSON object: flat
keys matching `PROFILE_FIELDS` in the dashboard JS, plus `experience_roles`
(array) and `canonical` (the nested object matching
`~/job-automation-ai/context/SHARED_PROFILE_SCHEMA.md`). No schema
migration needed — D1 just stores whatever JSON blob the client sends.

## Config (`wrangler.toml`)

```toml
[[r2_buckets]]
binding = "RESUMES"
bucket_name = "applyd-resumes"

[vars]
CLERK_ISSUER = "https://clerk.applydjobs.com"
ADMIN_USER_ID = "user_3JeY8TVmctjpcU6GbaK4l888Ak9"
```

`ADMIN_USER_ID` must match the constant hardcoded in
`dashboard/index.html` (used client-side to decide whether to reveal the
Admin nav item). If these two ever drift, the fix is usually a typo
(happened once already — capital `O` vs digit `0`).

## Deferred / not built yet

- No `/agencies` page live. `agencies-landing-archive.html` has the old
  agency-focused homepage preserved for whenever there's a real reason to
  stand it up as its own route (see Positioning above).
- No connection to the real Google Sheet or `~/.applyd` worker. Worker
  currently polls one hardcoded tab; would need per-user tab support
  before this dashboard's job submissions mean anything to it.
- Resume PDF upload is wired to R2 (`functions/api/dashboard/resume.js`,
  see "Resume storage (R2)" above) — code is in and the bucket binding is
  in `wrangler.toml`, but **the R2 bucket itself still needs to be
  created** (`wrangler r2 bucket create applyd-resumes` or via dashboard)
  before uploads actually work in production; until then the endpoint
  returns a clean 503 instead of crashing.
- Worker HTTP API exists (`/api/worker/profile`, `/resume`, `/jobs`) behind
  `WORKER_API_KEY`, but the Python worker does not call it yet, and the
  secret must be set in Pages before those routes return anything but 503.
- "My Info" field set covers the `SHARED_PROFILE_SCHEMA.md` contract as of
  2026-09-20 — expect it to keep growing as real application forms surface
  fields it doesn't cover yet.
- Known reliability gap in the real worker (not a dashboard issue, noted
  for whenever the connection happens): `~/.applyd/apply_worker.py` can
  write "Submitted" to the sheet even on some error paths
  (`browser_closed_on_error`), not only on genuine success.
