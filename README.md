# qr-code-decoder

Decode a QR code back to its original text — **right in your browser**. Give it
an **image URL**, **upload a file**, or just **paste an image** (Ctrl/Cmd + V).
A tiny server-side proxy is used only for URL fetches, to get past CDN hotlink
protection. Built to deploy on **Vercel** with zero configuration.

## Three ways to decode

1. **Image URL** — paste a link; the image is fetched through the same-origin
   proxy (`/api/proxy`) and decoded.
2. **Upload** — pick a local image file.
3. **Paste** — copy any image and press <kbd>Ctrl/Cmd</kbd> + <kbd>V</kbd>
   anywhere on the page.

Upload and paste are decoded **entirely in the browser** — the image never
leaves your device and never touches the server. This also works when a source
CDN blocks the proxy (see below).

## Why a proxy (and its limits)

Some image CDNs reject direct browser/extension requests with HTTP 403 because
of the `Origin` header (hotlink protection). The serverless function at
`/api/proxy` fetches the image **server-side** with forged browser headers
(no `Origin`, a normal `User-Agent`, and a same-site `Referer`), so it gets
past those checks. The page then loads the image **same-origin**, which means
no CORS error and no tainted canvas.

**Limitation:** a minority of CDNs block by **IP range** (data-center / cloud
IPs), not by headers. Those return 403 to any server-side fetch — including
Vercel — and no header trick can bypass that. For those images, use **Upload**
or **Paste** instead, which decode locally with no network request.

## Multi-engine decoding

Decoding happens in the browser, trying three engines in order of strength:

1. **zbar** (`zbar-wasm`) — strongest for inverted / artistic QR codes.
2. **ZXing** (`TRY_HARDER`) — solid general-purpose fallback.
3. **jsQR** — lightweight last resort.

Each engine is run against several preprocessing variants of the image
(grayscale, inverted, multiple thresholds), each optionally upscaled 2×/3× to
help dense or small-module codes. The first successful decode wins, and the
engine that succeeded is shown in the status line.

## Project structure

```
qr-code-decoder/
├── api/
│   └── proxy.js            # Vercel Serverless Function: GET /api/proxy?url=...
├── public/                 # static root (served by Vercel / local server)
│   ├── index.html          # static entry (SEO meta, JSON-LD, analytics)
│   ├── favicon.svg         # site icon
│   ├── robots.txt
│   ├── sitemap.xml
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js          # decode pipeline + URL / upload / paste handlers
│       ├── jsQR.js         # engine 3 (lightweight)
│       └── vendor/
│           ├── zbar-wasm.mjs   # engine 1 (strongest)
│           ├── zbar.wasm
│           └── zxing.min.js    # engine 2 (TRY_HARDER)
├── server.js               # local dev server (not used on Vercel)
├── vercel.json             # static root + caching headers
├── LICENSE
└── package.json
```

There is **no build step** and **no `node_modules`** — all decoder libraries
are vendored as static files.

## Local development

Requires Node.js 18+ (uses the built-in `fetch`).

```bash
npm run dev
```

Then open http://localhost:5173. Change the port with `PORT=8080 npm run dev`.

`server.js` serves the static files and reuses the exact same handler from
`api/proxy.js`, so local behaviour matches production.

## Deploy to Vercel

The repo is already in Vercel's zero-config layout: static files under
`public/` (set as the output directory in `vercel.json`) and the function
under `api/`. No framework preset is needed.

**Option A — Dashboard**

1. Push this repo to GitHub/GitLab/Bitbucket.
2. In Vercel, **Add New → Project** and import the repo.
3. Framework Preset: **Other**. Leave the Build Command empty (the output
   directory is already set to `public` via `vercel.json`). Deploy.

**Option B — CLI**

```bash
npm i -g vercel
vercel          # preview deploy
vercel --prod   # production deploy
```

After deploying, the app is available at your Vercel URL and the proxy at
`https://<your-app>.vercel.app/api/proxy?url=<image-url>`.

## License

[MIT](LICENSE) © OrekiYuta
