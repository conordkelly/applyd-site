// Per-user ATS (Workday) passwords for create-account / sign-in.
// Format mirrors the original worker pair (not the exact strings):
//   primary  — upper + lower + digit + symbol (≈10 chars; may be <12)
//   backup   — same character mix, ≥12 chars (Workday min-12 rule)

function randomInt(maxExclusive) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % maxExclusive;
}

/**
 * @param {number} minLength
 * @returns {string}
 */
export function generateAtsPassword(minLength) {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%&*?";
  const all = upper + lower + digits + symbols;
  const len = Math.max(4, Number(minLength) || 10);

  const chars = [
    upper[randomInt(upper.length)],
    lower[randomInt(lower.length)],
    digits[randomInt(digits.length)],
    symbols[randomInt(symbols.length)],
  ];
  while (chars.length < len) {
    chars.push(all[randomInt(all.length)]);
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }
  return chars.join("");
}

/**
 * Ensure canonical.ats_credentials has primary + backup. Never rotates
 * existing non-empty values (stable for Workday accounts already created).
 * @param {object|null|undefined} canonical
 * @returns {{ created: boolean, canonical: object }}
 */
export function ensureAtsCredentials(canonical) {
  const out =
    canonical && typeof canonical === "object" ? canonical : {};
  if (!out.ats_credentials || typeof out.ats_credentials !== "object") {
    out.ats_credentials = {};
  }
  const creds = out.ats_credentials;
  let created = false;

  if (!String(creds.password || "").trim()) {
    creds.password = generateAtsPassword(10);
    created = true;
  }
  const backup = String(creds.password_backup || "").trim();
  // Replace backup only when missing or too short for min-12 tenants.
  if (!backup || backup.length < 12) {
    creds.password_backup = generateAtsPassword(12);
    created = true;
  }
  return { created, canonical: out };
}
