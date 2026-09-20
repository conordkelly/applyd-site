# Applyd — Onboarding & Account Provisioning Plan

Living record of the user onboarding flow and the per-user email infrastructure behind
it. This is a planning doc, not a build log — update it as decisions get made or
reversed, before code exists to document instead (see `UI_CONTEXT.md` for that once
this actually gets built).

Last updated: 2026-09-20 (shared profile schema draft linked).

**Shared profile contract (site ↔ DB ↔ worker):**  
`job-automation-ai/context/SHARED_PROFILE_SCHEMA.md`  
Example: `job-automation-ai/context/shared-profile.example.json`

## The flow (as specified by the user)

**Onboarding (one-time, self-serve until payment):**
1. Create user/password (maps to Clerk, already built — not a custom auth system)
2. Enter profile info used on applications (maps to the existing "My Info" tab —
   may need to become a step-by-step wizard for onboarding rather than the single
   long form it is today)
3. Upload resume
4. Select plan
5. Pay

**Then a 24-48 hour manual/semi-manual provisioning window**, during which:
- Backend user profile is created in the Applyd database (already happens today,
  via the Clerk-session-triggered upsert in `_middleware.js`)
- A dedicated mailbox is created and attached to the user's profile
- The user is notified their account is ready

**Ongoing, once live:**
- User pastes job links as needed (already built — Jobs Submission tab)
- An end-of-day summary email goes to the user's real/main email listing what was
  applied to that day

## Pricing (decided)

Three one-time prepaid bundles, **not subscriptions** — a subscription needs
renewal/proration/cancellation/dunning logic that a one-time Stripe Checkout
charge doesn't. Each bundle is a fixed number of applications with a 30-day
window, no auto-renewal; buying more once used up is just running the same
checkout again, not a separate "renewal" flow.

| Tier | Price | Applications | Per-application |
|---|---|---|---|
| Starter | $15 | 25 | $0.60 |
| Standard | $28 | 50 | $0.56 |
| Power | $50 | 100 | $0.50 |

Design rules behind these numbers, worth preserving if they change again later:

- **Per-application cost must strictly decrease as tiers get bigger.** Every
  earlier draft that violated this got caught by the same failure mode: a
  smaller tier became mathematically better value than a bigger one, meaning a
  rational buyer would just stack multiples of the cheaper tier instead of
  buying the expensive one (e.g. a version where Standard was worse per-app
  than Starter, and a later version where Power was exactly equal to 2x
  Standard, making Power pointless to ever choose). Any new tier or price
  change should be checked against this before locking it in.
- **The application caps are capacity numbers, not just pricing numbers.**
  Power's cap in particular was set by asking "what volume can the founder
  actually review reliably per month," not by working backward from a price
  curve — 150/month was flagged as too much for one person reviewing every
  submission manually, so the cap came down to 100 and the price was
  recalculated around that, rather than overpromising volume that can't
  actually be fulfilled. If review capacity changes (e.g., once review is no
  longer manual — see the dedicated-mailbox section above), these caps are
  worth revisiting upward.
- These are still comparable-market/capacity-based guesses, not derived from
  actual per-application cost (compute, mailbox amortization, eventual review
  labor). Sanity-check Starter's margin specifically once real cost data
  exists — it's the tier most likely to get squeezed.

## Resume and profile fields (decided)

Resume upload is a **real PDF file**, not plain text — a genuine change from
the existing "My Info" tab, which today has a plain textarea for pasting
resume text (`dashboard/index.html`, `f-resume_text` field). That textarea
either needs to become a file upload or sit alongside one.

Separately, and in addition to the resume file, onboarding also collects
**structured fields that correspond to what the worker actually fills in on
applications** — name, phone, address, work authorization, experience,
compensation expectations, EEO disclosures, etc. This is exactly what the
existing "My Info" tab's `PROFILE_FIELDS` already does (see `UI_CONTEXT.md`)
— it doesn't need to be reinvented, but it does need to become part of the
onboarding wizard's flow (step 2) rather than something only reachable after
the fact from inside the dashboard.

Build implication: a real PDF upload needs object storage — **Cloudflare R2
isn't set up yet** (this was already a known gap, see `UI_CONTEXT.md`
"Deferred / not built yet"). This is now a hard requirement for onboarding,
not a someday nice-to-have.

## Checking the dedicated email (decided)

Read-only viewer inside the Applyd dashboard — **not** real mailbox login
credentials handed to the user. Reasons:

- It's the only option that actually guarantees "can check it but can't
  change details." Real credentials would let a user change the password or
  recovery settings unless locked down via Workspace admin policy, which
  could be misconfigured or forgotten. A dashboard viewer makes changing
  anything impossible by construction.
- Less new integration work than it looks like. The backend already needs to
  read this mailbox programmatically (that's what the app-specific password
  from the security section above is for, so the worker can check it) —
  showing a filtered version of those same messages in a new dashboard tab
  reuses that access rather than requiring a second integration.
- Keeps the whole experience inside the Applyd product instead of sending
  users out to a Gmail login screen, and lets the dashboard surface things
  usefully (e.g. "reply from Acme Corp") rather than a raw inbox dump.

Build implication: needs a new dashboard view (e.g. alongside My Jobs / My
Info) that lists messages from the dedicated mailbox, read-only, no
send/reply/delete.

## EOD summary email (decided)

Sends at **12:01am**, covering the previous day's activity (not literally
noon as the original notes said — that was a typo/ambiguity, now resolved).

## Open questions — need answers before building

All resolved for now. Next step is turning this plan into an actual build
(onboarding wizard, Stripe one-time checkout, R2 for resume storage, the
Workspace mailbox provisioning, the read-only email viewer tab).

## Decided: dedicated mailbox, not the user's real email

Two options were considered for the per-user mailbox the worker logs into:

1. **OAuth into the user's real Gmail/Outlook** — rejected. Most job seekers
   already have old ATS accounts (Greenhouse/Workday/Lever) tied to their real
   email from before ever using Applyd. When automation hits one of those, it's
   "an account already exists, please sign in" — and Applyd doesn't have that
   password. This breaks unpredictably, differently per user, with zero visibility
   into what pre-existing accounts exist. Not viable for reliable automation.

2. **A dedicated mailbox Applyd creates and controls** — chosen. The only
   accounts that can exist on a dedicated address are ones Applyd itself created,
   so Applyd always has the password. The only collision risk is applying to the
   same company twice, which Applyd's own database can actually track.

### Why not real @gmail.com / @outlook.com addresses

Google and Microsoft don't offer any API for a third party to provision real
consumer @gmail.com / @outlook.com addresses in bulk — Workspace/365 admin APIs
only create mailboxes on a domain *you* own. Getting a real @gmail.com or
@outlook.com address requires each provider's own human-oriented consumer signup
flow (phone verification, abuse detection built specifically to catch one
operator creating many accounts). Automating around that is a Terms of Service
violation. Manually doing it one at a time (the user's original plan) can work in
tiny volume but has a shelf life — the same detection systems increasingly catch
*behavioral* patterns across accounts (shared login times/IPs, a Playwright bot
logging in instead of a human), not just how the account was created.

### Chosen approach: Google Workspace, multiple domains

- Buy generic, non-"applydjobs"-sounding domains (e.g. `mailhaven.com`-style —
  short, no reference to jobs/hiring/applications) and run them through Google
  Workspace. Addresses look like `firstname@thatdomain.com` — not literally
  gmail.com, but reads as a normal personal email rather than an obvious company
  address.
- Fully provisionable via the Workspace Admin SDK — no manual signup, no
  phone-verification wall, no ToS risk.
- **A single shared domain across every user is still a fingerprint** — once
  enough unrelated candidates show up with the same uncommon domain, that
  pattern itself becomes flaggable, the same way disposable-email domains get
  blocklisted over time. Mitigate by spreading users across multiple domains
  within the same Workspace account (Workspace supports multi-domain natively —
  one admin console, one API, many domains).
- **For the test/pilot group:** start everyone on one domain — a handful of
  users sharing a domain isn't a pattern worth noticing. Add more domains to the
  same Workspace account as the user base grows, and put new users on the newer
  domains going forward.
- **Never move an existing user to a different domain/address** — once someone's
  ATS accounts are tied to a specific dedicated address, changing it breaks
  those accounts. Rotate across new users, never within one user's lifetime.
- Domain hygiene, as an ongoing practice (not a one-time setup task):
  - Don't register multiple domains on the same day/registrar — stagger them,
    use WHOIS privacy.
  - Let a domain age before putting real users on it.
  - Keep a spare domain or two in reserve so a flagged domain can be phased out
    without scrambling.
  - The email domain is likely not the biggest fingerprint anyway — shared IPs,
    identical timing, and Playwright's own browser signature are more detectable
    than the email suffix. Worth addressing eventually, not a day-one blocker.

### Security: don't store the mailbox's real password

Storing a dedicated mailbox's actual login password in the Applyd database is a
liability even though Applyd (not the user) owns the account — an email account
is the master key to nearly everything else, since password resets for other
services flow through it. A database breach would expose more than app data; it
would hand over full control of every user's application-related mailbox and
anything reachable via its password-reset flow.

Mitigation: use Google Workspace's **app-specific passwords** (or OAuth tokens
scoped to the mailbox, if going through the Gmail API instead of raw IMAP/SMTP
login) for whatever the worker uses to read/send mail, rather than storing the
actual account password. An app-specific password can be revoked and rotated
independently of the real account password, and it's useless for anything
outside its narrow scope (e.g., it can't be used to change the account's
recovery info or password).

**What an app-specific password actually is:** a second, separate password
Google generates for one account, made for apps/bots instead of humans. It can
log in and read/send mail — that's all it can do. It can't change the account's
real password, can't touch recovery info, can't be used to take the account
over, and it can be revoked independently at any time without affecting the
real password. Like giving a contractor a key that only opens one door, instead
of the master key to the whole building.

**No effect on the user-facing flow.** This is purely a backend/storage
decision about what credential Applyd keeps in its own database for the
worker's use — it doesn't touch what the user does during onboarding or
afterward. The real account password still exists and would still be what's
used if a user is ever given direct login access to their dedicated mailbox
(see the still-open "can they check this email" question above) — switching
the worker to an app-specific password doesn't change that question either
way.
