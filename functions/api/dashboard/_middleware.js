// Verifies a Clerk session token on every /api/dashboard/* request.
// Implemented by hand (no @clerk/backend) so the site can stay dependency-free
// and keep deploying with no build step, same as the rest of this project.
//
// Requires two env vars, set in the Cloudflare Pages project settings:
//   CLERK_ISSUER — e.g. "https://your-app.clerk.accounts.dev" (no trailing slash)
//   (the JWKS is fetched from `${CLERK_ISSUER}/.well-known/jwks.json`)

let jwksCache = null;
let jwksCacheAt = 0;
const JWKS_TTL_MS = 10 * 60 * 1000;

function base64UrlToUint8Array(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "===".slice((b64.length + 3) % 4);
  const raw = atob(padded);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function base64UrlToJson(b64url) {
  return JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(b64url)));
}

async function getJwks(issuer) {
  const now = Date.now();
  if (jwksCache && now - jwksCacheAt < JWKS_TTL_MS) return jwksCache;
  const res = await fetch(`${issuer}/.well-known/jwks.json`);
  if (!res.ok) throw new Error("Failed to fetch JWKS");
  jwksCache = await res.json();
  jwksCacheAt = now;
  return jwksCache;
}

async function verifyClerkToken(token, issuer) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  const [headerB64, payloadB64, sigB64] = parts;

  const header = base64UrlToJson(headerB64);
  const payload = base64UrlToJson(payloadB64);

  if (header.alg !== "RS256") throw new Error("Unexpected alg");
  if (payload.iss !== issuer) throw new Error("Wrong issuer");
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) {
    throw new Error("Token expired");
  }

  const jwks = await getJwks(issuer);
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("Unknown signing key");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const signature = base64UrlToUint8Array(sigB64);
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature,
    signedData
  );
  if (!ok) throw new Error("Bad signature");

  return payload; // includes `sub` (Clerk user id) and usually `email`
}

export async function onRequest(context) {
  const { request, env, next } = context;

  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return json({ error: "Not signed in" }, 401);

  let payload;
  try {
    payload = await verifyClerkToken(token, env.CLERK_ISSUER);
  } catch (err) {
    return json({ error: "Invalid session" }, 401);
  }

  const userId = payload.sub;
  const email = payload.email || payload.email_address || "";

  // First request from this user ever: create their row.
  await env.DB.prepare(
    "INSERT INTO users (id, email) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET email = excluded.email WHERE excluded.email != ''"
  )
    .bind(userId, email)
    .run();

  context.data = { userId, email };
  return next();
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}
