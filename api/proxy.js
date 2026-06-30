// Vercel Serverless Function: GET /api/proxy?url=<image-url>
//
// Proxies an external image. A server-side fetch has no browser "Origin"
// header and can freely set Referer / User-Agent, so it gets past CDN hotlink
// protection that would reject a direct browser (or extension) request with
// HTTP 403. The page then loads the image same-origin (no CORS, no taint).

const FETCH_TIMEOUT_MS = 15000;

function jsonError(res, status, error, extra = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error, ...extra }));
}

export default async function handler(req, res) {
  const target = req.query?.url;
  if (!target) {
    return jsonError(res, 400, "Missing url parameter.");
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return jsonError(res, 400, "Invalid url parameter.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return jsonError(res, 400, "Only http(s) URLs are allowed.");
  }

  // Forge a normal browser request. Use the image's own origin as Referer,
  // which defeats most "same-site referer" hotlink checks.
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Referer: `${parsed.protocol}//${parsed.host}/`,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(parsed.href, {
      headers,
      redirect: "follow",
      signal: controller.signal,
    });

    if (!upstream.ok) {
      return jsonError(res, 502, `Upstream returned HTTP ${upstream.status}.`, {
        status: upstream.status,
      });
    }

    const contentType =
      upstream.headers.get("content-type") || "application/octet-stream";
    const buf = Buffer.from(await upstream.arrayBuffer());

    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end(buf);
  } catch (err) {
    const msg =
      err && err.name === "AbortError"
        ? "Upstream request timed out."
        : String(err && err.message ? err.message : err);
    return jsonError(res, 502, msg);
  } finally {
    clearTimeout(timer);
  }
}
