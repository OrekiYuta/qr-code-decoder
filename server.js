// Local development server (NOT used on Vercel).
//
// On Vercel, static files are served from `public/` and `/api/proxy` is a
// Serverless Function (see api/proxy.js + vercel.json). This file just mirrors
// that behaviour for plain `node server.js` local runs, reusing the same
// proxy handler so there is a single source of truth for the proxy logic.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import proxyHandler from "./api/proxy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, "public");
const PORT = process.env.PORT ? Number(process.env.PORT) : 5173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

// Serve a static file from the public/ directory.
async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (urlPath === "/") urlPath = "/index.html";

  // Prevent path traversal.
  const filePath = path.normalize(path.join(ROOT_DIR, urlPath));
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not Found");
  }
}

// Minimal shim so the Vercel-style handler (req.query, res.statusCode/setHeader)
// works under the raw Node http server too.
function adaptForHandler(req, res, searchParams) {
  req.query = Object.fromEntries(searchParams.entries());
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");

  if (url.pathname === "/api/proxy") {
    adaptForHandler(req, res, url.searchParams);
    return proxyHandler(req, res);
  }

  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`qr-code-decoder running at http://localhost:${PORT}`);
});
