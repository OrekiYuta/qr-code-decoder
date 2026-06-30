# qr-code-decoder

Decode a QR code from an **image URL** and get the original text back —
running entirely in the browser, with a tiny server-side proxy to bypass CDN
hotlink protection. Built to deploy on **Vercel** with zero configuration.

## Why a proxy?

Some image CDNs reject direct browser/extension requests with HTTP 403 because
of the `Origin` header (hotlink protection). The serverless function at
`/api/proxy` fetches the image **server-side** with forged browser headers
(no `Origin`, a normal `User-Agent`, and a same-site `Referer`), so it gets
past those checks. The page then loads the image **same-origin**, which means
no CORS error and no tainted canvas.

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
│   ├── index.html          # static entry
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js          # decode pipeline (ES module)
│       ├── jsQR.js         # engine 3 (lightweight)
│       └── vendor/
│           ├── zbar-wasm.mjs   # engine 1 (strongest)
│           ├── zbar.wasm
│           └── zxing.min.js    # engine 2 (TRY_HARDER)
├── server.js               # local dev server (not used on Vercel)
├── vercel.json             # static root + caching headers
└── package.json
```

There is **no build step** and **no `node_modules`** — all decoder libraries
are vendored as static files.

## Local development

Requires Node.js 18+ (uses the built-in `fetch`).

```bash
npm run dev
```

Then open http://localhost:5173 and paste an image URL. Change the port with
`PORT=8080 npm run dev`.

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
