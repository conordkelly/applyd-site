# Applyd — UI Context

Living record of what's built on the web side, and why. **Update this file
whenever the UI changes** — new views, new fields, restyled nav, new
endpoints. Treat it as the source of truth for "what does the site currently
do," separate from the marketing plan.

Last updated: 2026-09-02.

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

- `index.html` — marketing/landing page.
- `dashboard/index.html` — the authenticated app. Everything below is this
  one file (styles, markup, and vanilla JS all inline).

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
var ADMIN_USER_ID = 'user_3Ik0NIiJSvyv2gwwdVISFrQWSSd'; // must match ADMIN_USER_ID in wrangler.toml
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
the worker can auto-fill applications from it later. Field shape is
deliberately modeled on `~/.applyd/profile.json` (the real worker's actual
config file) so the two line up when the dashboard eventually feeds the
worker.

Sections (`.field-group`), each a fieldset-style block, two-column grid on
desktop (`.field-grid`, collapses to one column under 520px):

1. **Personal** — full legal name, preferred name, phone, country, street
   address, city, state/province, postal code, LinkedIn URL, GitHub URL,
   portfolio/website URL.
2. **Work Authorization** — authorized to work? (yes/no), require
   sponsorship? (yes/no), status (free text).
3. **Experience** — current title, years of experience, education level
   (dropdown), target roles (comma-separated text).
4. **Compensation** — desired salary, currency, minimum acceptable,
   maximum range.
5. **Resume** — plain-text paste box (`textarea`). No file upload yet —
   would need object storage (R2) that isn't wired up; text is also what
   the real worker actually consumes today.
6. **Voluntary Disclosures** (EEO) — gender, race/ethnicity, veteran
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
(see Backend below). Field list lives in JS as `PROFILE_FIELDS` — the
generic `fillProfileForm()` / `collectProfileForm()` functions loop over
that array, so adding a field is: add the `<input>` (id `f-<key>`) +
add `<key>` to `PROFILE_FIELDS`.

**Known gap, called out by the user (2026-09-02):** this is "a very good
start" but will need real expansion to cover the actual range of things
job applications ask (this is a first pass, not the final field set).
Expect more sections/fields over time — keep this doc in sync when that
happens.

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
| `dashboard/admin.js` | GET | 403 unless `userId === env.ADMIN_USER_ID`; otherwise every user + their jobs |

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

`profiles.data` holds the whole "My Info" form as one JSON object, keyed
by the same field names as `PROFILE_FIELDS` in the dashboard JS.

## Config (`wrangler.toml`)

```toml
[vars]
CLERK_ISSUER = "https://solid-mallard-7796.clerk.accounts.dev"
ADMIN_USER_ID = "user_3Ik0NIiJSvyv2gwwdVISFrQWSSd"
```

`ADMIN_USER_ID` must match the constant hardcoded in
`dashboard/index.html` (used client-side to decide whether to reveal the
Admin nav item). If these two ever drift, the fix is usually a typo
(happened once already — capital `O` vs digit `0`).

## Deferred / not built yet

- No connection to the real Google Sheet or `~/.applyd` worker. Worker
  currently polls one hardcoded tab; would need per-user tab support
  before this dashboard's job submissions mean anything to it.
- No resume file upload (needs R2 or similar).
- "My Info" field set is a first pass — expect it to grow as real
  application forms surface fields it doesn't cover yet.
- Known reliability gap in the real worker (not a dashboard issue, noted
  for whenever the connection happens): `~/.applyd/apply_worker.py` can
  write "Submitted" to the sheet even on some error paths
  (`browser_closed_on_error`), not only on genuine success.
