// City lookup for Preferred job location. Proxies Open-Meteo geocoding
// so the browser can search worldwide cities without a static list.

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

function formatPlace(row) {
  const parts = [];
  [row && row.name, row && row.admin1, row && row.country].forEach((part) => {
    const text = String(part || "").trim();
    if (text && parts.indexOf(text) === -1) parts.push(text);
  });
  return parts.join(", ");
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const q = String(url.searchParams.get("q") || "").trim();
  if (q.length < 2 || q.length > 80) {
    return json({ locations: [] });
  }

  let res;
  try {
    res = await fetch(
      "https://geocoding-api.open-meteo.com/v1/search?name=" +
        encodeURIComponent(q) +
        "&count=12&language=en&format=json",
      { headers: { Accept: "application/json" } }
    );
  } catch {
    return json({ error: "Location search failed" }, 502);
  }

  if (!res.ok) {
    return json({ error: "Location search failed" }, 502);
  }

  let body = {};
  try {
    body = await res.json();
  } catch {
    return json({ error: "Location search failed" }, 502);
  }

  const rows = Array.isArray(body.results) ? body.results : [];
  const seen = {};
  const locations = [];
  for (let i = 0; i < rows.length; i++) {
    const label = formatPlace(rows[i]);
    if (!label || seen[label]) continue;
    seen[label] = true;
    locations.push(label);
  }

  return json({ locations });
}
