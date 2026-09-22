# applyd-email-inbox

Cloudflare Email Worker for `*@everydaymail.ca`.

Receives catch-all mail, stores it in the shared `applyd-jobs` D1 database,
and optionally re-sends a copy to the user's personal email via Resend.

## Deploy

```bash
cd email-worker
npx wrangler deploy
npx wrangler secret put RESEND_API_KEY
```

## Wire Email Routing (dashboard)

1. Cloudflare → select zone **everydaymail.ca**
2. **Email** → **Email Routing** → enable (adds MX records)
3. **Routing rules** → **Catch-all** → Action: **Send to a Worker** → choose **applyd-email-inbox**
4. Save

## Test

1. Sign in to Applyd dashboard (assigns `you@everydaymail.ca`)
2. Send a test message to that address from any mailbox
3. Check **Inbox** in the dashboard and your personal email (if forwarding is on)
