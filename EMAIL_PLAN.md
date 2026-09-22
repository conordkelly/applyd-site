# Applyd — Email Plan & Workflow

Living plan for transactional mail (Applyd → user) and per-user **apply
addresses** (ATS / portal identity). Update this when decisions change.
Once built, keep runtime detail in `UI_CONTEXT.md`.

Last updated: 2026-09-22 (plan approved for Cloudflare catch-all build).

Related: `ONBOARDING_PLAN.md` (pricing / onboarding; mailbox section
superseded by this doc), `UI_CONTEXT.md` (shipped welcome email).

---

## Goals

1. Each user has a unique **apply address** for job applications and ATS
   logins so automation does not collide with accounts on their personal
   Gmail/Outlook.
2. Apply mail is **visible in Applyd** (user inbox + admin-by-user view).
3. Apply mail is **auto-forwarded** to the user's personal email so they
   can reply (interview invites, recruiter notes).
4. Cost stays near-flat at scale (no Google Workspace per-seat pricing).

---

## Two email systems (do not mix)

| Role | Address | System |
|---|---|---|
| Brand / transactional | `info@applydjobs.com` (Resend) | Welcome, account-ready, digests, etc. |
| Apply / ATS identity | `name@everydaymail.ca` | Cloudflare Email Routing catch-all |
| Personal (Clerk) | User's real inbox | Account login + human replies |

`applydjobs.com` stays brand mail only. Apply inboxes live on a
normal-looking domain (`everydaymail.ca`).

---

## Status

### Done

- Resend wired (`functions/api/_email.js`, `POST /api/dashboard/welcome`)
- Welcome email on first dashboard load (idempotent `welcomeEmailSent`)
- Pages secret `RESEND_API_KEY`; optional `EMAIL_FROM`

### You (before / during build)

- Buy **`everydaymail.ca`** on Cloudflare Registrar
- Confirm Canadian presence rules for `.ca` if prompted

### Build next (this plan)

1. DNS / Email Routing / catch-all → Email Worker on `everydaymail.ca`
2. Assign + persist `apply_email` (and related settings) on profile
3. Store inbound messages; user read-only inbox in dashboard
4. Auto-forward to personal email (default on; settings opt-out)
5. Admin view: all apply mail, sorted/filtered by user (read-only)
6. Worker uses `apply_email` on forms (not Clerk personal email)
7. Welcome copy already explains apply address + forwarding; include
   real address in welcome once assignment exists at send time

### Out of scope (later)

- Stripe / pay-gated provisioning
- Reply / send **as** the apply address
- Multi-domain rotation for fingerprint hygiene at large scale
- EOD application summary digests (still desired; separate from this build)

---

## Why not personal email / Gmail bulk / Workspace

- **Personal email on applications:** users often already have Greenhouse /
  Workday / Lever accounts on that address → "sign in" walls Applyd cannot
  pass. Use apply address on **all** ATS applications (not Workday-only).
- **Bulk `@gmail.com` / `@outlook.com`:** not available via API; automation
  violates provider ToS and does not scale.
- **Google Workspace per mailbox (~$7–8 USD/user/month):** rejected for
  long-term cost. Earlier `ONBOARDING_PLAN.md` Workspace approach is
  **superseded** by Cloudflare catch-all below.

---

## Chosen approach: Cloudflare catch-all

1. Own `everydaymail.ca` on Cloudflare.
2. Enable **Email Routing** with a **catch-all**.
3. Applyd invents addresses (`firstname.lastname@everydaymail.ca`, with
   collision rules as needed). No real mailbox login is created.
4. Inbound mail hits an **Email Worker** → parse `To`, map to user →
   store message (metadata + body) in D1 (and R2 for large raw MIME if
   needed).
5. Same Worker (or routing action) **forwards a copy** to the user's
   personal email when forwarding is enabled.
6. Dashboard and admin UI read stored messages (not Gmail IMAP).

### What this is / isn't

- **Is:** unique apply identity + receive + in-app inbox + forward.
- **Is not:** a password login for `jane@everydaymail.ca`. Users never
  sign into that address in Gmail/Outlook.

---

## Workflows

### User

1. Signs up with Clerk (personal email).
2. Gets an assigned apply address stored on their profile.
3. Completes My Info + resume; submits job links.
4. Worker fills applications using **apply address**.
5. Employer / ATS mail → apply address → stored in Applyd + forwarded to
   personal email (if on).
6. User replies from **personal email** when a human response is needed.
7. Can view the same mail in Applyd (read-only inbox).

### Admin (you)

1. Open admin apply-mail view.
2. Select a user (list or tabs).
3. Read that user's apply emails (v1: read only; no send-as).

### Forwarding policy

- **Default: ON** (strongly recommended).
- Settings toggle to turn off, with a clear warning: turning off means
  interview / recruiter mail may be missed and replies from email are
  harder.
- Forwarding sends a **copy**; Applyd still keeps the message for user
  and admin views.

### Reply behavior (expected)

- Replies from personal email show the **personal** From address to the
  employer. That is intentional for v1.
- Applications and ATS logins keep using the **apply** address.

---

## Welcome email (Resend)

Already shipping. Exact copy:

- Subject: `Apply less. Start here.`
- Body:

```
Hi {name},

Welcome to Applyd. Complete these three steps, then start sending us job links and we'll take it from there:

1. Add your details under 'My Info'
2. Upload your resume
3. Submit your first job link

A real person reviews every application before it's submitted.

Your Applyd email: You'll get a dedicated email address (typically a generic address like yourname@everydaymail.ca) for job applications and account logins. Anything sent there shows up in your dashboard and forwards automatically to your personal email so you can reply. Keep forwarding on so you don't miss an interview request.

Get started: https://www.applydjobs.com/dashboard/

Best,

The Applyd Team
```

When `apply_email` exists at send time, prefer stating the real address
instead of the generic `yourname@everydaymail.ca` example.

---

## Data shape (intended)

Profile / settings (exact keys may land in `canonical` or top-level;
keep worker contract in sync with `SHARED_PROFILE_SCHEMA.md`):

- `apply_email` — assigned address
- `apply_email_forward_to_personal` — boolean, default `true`
- Optional: `apply_email_assigned_at`

Inbound messages (new store; D1 table or equivalent):

- `user_id`, `to_address`, `from_address`, `subject`, `received_at`
- body / snippet; optional raw MIME pointer in R2
- `forwarded_at` / forward status if useful for ops

---

## Cost shape

- Domain: ~$9/year (`everydaymail.ca`)
- Cloudflare Email Routing inbound: effectively free at our scale
- Resend: transactional volume only
- **Not** ~$7–8/user/month Workspace seats

At large scale, add more normal-looking domains and put **new** users on
newer domains (never change an existing user's apply address).

---

## Build checklist

- [ ] Domain purchased and on Cloudflare DNS
- [ ] Email Routing + catch-all + Email Worker receiving
- [ ] Address assignment + profile persistence
- [ ] Message storage
- [ ] User dashboard inbox (read-only)
- [ ] Forward-to-personal default on + settings toggle + warning
- [ ] Admin inbox by user (read-only)
- [ ] Worker reads `apply_email` for form fill
- [ ] Welcome email includes assigned address when available
- [ ] `UI_CONTEXT.md` updated when shipped

---

## Decision log

| Date | Decision |
|---|---|
| 2026-09-20 | Dedicated apply identity (not personal email) — see older Workspace notes in `ONBOARDING_PLAN.md` |
| 2026-09-22 | Reject Workspace per-seat cost |
| 2026-09-22 | Choose Cloudflare catch-all + Email Worker |
| 2026-09-22 | Domain: `everydaymail.ca` |
| 2026-09-22 | Apply address on **all** ATS apps |
| 2026-09-22 | Auto-forward to personal default ON; discouraged opt-out |
| 2026-09-22 | Admin view by user; read-only v1 (no reply-as) |
| 2026-09-22 | Resend welcome live; copy includes email explainer |
