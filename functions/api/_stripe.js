// Minimal Stripe client for Pages Functions. No SDK (no npm on this project),
// just fetch against the REST API plus Web Crypto for webhook signatures.
//
// Env (Cloudflare Pages secrets):
//   STRIPE_SECRET_KEY      sk_test_... / sk_live_...
//   STRIPE_WEBHOOK_SECRET  whsec_...

export function stripeConfigured(env) {
  return !!String(env.STRIPE_SECRET_KEY || "").trim();
}

// Stripe wants nested form fields: a[b][c]=1, items[0][x]=2.
function flatten(value, prefix, out) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(v, prefix + "[" + i + "]", out));
  } else if (typeof value === "object") {
    Object.keys(value).forEach((k) =>
      flatten(value[k], prefix ? prefix + "[" + k + "]" : k, out)
    );
  } else {
    out.push([prefix, String(value)]);
  }
}

export function encodeForm(params) {
  const pairs = [];
  flatten(params || {}, "", pairs);
  return pairs
    .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v))
    .join("&");
}

// Returns { ok, status, data }. Never throws on a Stripe error response
// (declined cards come back as HTTP 402 with data.error).
export async function stripeRequest(env, method, path, params, opts) {
  const headers = {
    Authorization: "Bearer " + String(env.STRIPE_SECRET_KEY || "").trim(),
  };
  if (opts && opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  let url = "https://api.stripe.com" + path;
  let body;
  const encoded = encodeForm(params);
  if (method === "GET") {
    if (encoded) url += "?" + encoded;
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = encoded;
  }

  const res = await fetch(url, { method, headers, body });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

function hex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// Stripe-Signature: t=1700000000,v1=abcdef...,v1=...
// Signed payload is `${t}.${rawBody}` with HMAC-SHA256 keyed by the endpoint secret.
export async function verifyStripeSignature(rawBody, header, secret, toleranceSec) {
  const tol = toleranceSec || 300;
  if (!header || !secret) return false;
  let t = "";
  const sigs = [];
  String(header)
    .split(",")
    .forEach((part) => {
      const i = part.indexOf("=");
      if (i < 0) return;
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      if (k === "t") t = v;
      if (k === "v1") sigs.push(v);
    });
  if (!t || !sigs.length) return false;
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > tol) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(t + "." + rawBody)
  );
  const expected = hex(mac);
  return sigs.some((s) => timingSafeEqual(s, expected));
}
