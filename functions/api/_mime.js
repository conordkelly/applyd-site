// Header text like =?UTF-8?B?...?= or =?utf-8?Q?We=E2=80=99ve?= -> real
// characters. The email worker decodes new mail; this fixes subjects and
// senders already stored undecoded when they are read back.
export function decodeMimeWords(value) {
  const str = String(value || "");
  if (!str.includes("=?")) return str;
  return str
    .replace(/(\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g, (whole, charset, enc, text) => {
      try {
        let bytes;
        if (enc.toLowerCase() === "b") {
          bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
        } else {
          const out = [];
          for (const piece of text.replace(/_/g, " ").split(/(=[0-9A-Fa-f]{2})/)) {
            if (/^=[0-9A-Fa-f]{2}$/.test(piece)) out.push(parseInt(piece.slice(1), 16));
            else for (let i = 0; i < piece.length; i++) out.push(piece.charCodeAt(i) & 255);
          }
          bytes = Uint8Array.from(out);
        }
        return new TextDecoder(charset.split("*")[0]).decode(bytes);
      } catch {
        return whole;
      }
    });
}

export function decodeMessageHeaders(row) {
  if (!row) return row;
  return {
    ...row,
    subject: decodeMimeWords(row.subject),
    from_address: decodeMimeWords(row.from_address),
  };
}
