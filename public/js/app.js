import { scanRGBABuffer } from "./vendor/zbar-wasm.mjs";

const elements = {
  input: document.getElementById("qr-image-url"),
  decodeBtn: document.getElementById("qr-decode-btn"),
  copyBtn: document.getElementById("qr-copy-btn"),
  status: document.getElementById("qr-status"),
  preview: document.getElementById("qr-preview"),
  result: document.getElementById("qr-result"),
  canvas: document.getElementById("qr-canvas"),
};

let lastDecodedText = "";

function setStatus(message, state) {
  if (!elements.status) return;
  elements.status.textContent = message || "";
  elements.status.className = "qr-status";
  if (state) elements.status.classList.add(`qr-status-${state}`);
}

function setBusy(isBusy) {
  if (elements.decodeBtn) elements.decodeBtn.disabled = isBusy;
  if (elements.input) elements.input.disabled = isBusy;
}

function showPreview(src) {
  if (!elements.preview) return;
  elements.preview.classList.remove("qr-preview-empty");
  elements.preview.innerHTML = "";
  const img = document.createElement("img");
  img.className = "qr-preview-img";
  img.alt = "QR preview";
  img.src = src;
  elements.preview.appendChild(img);
}

function clearPreview() {
  if (!elements.preview) return;
  elements.preview.classList.add("qr-preview-empty");
  elements.preview.innerHTML = "<span>No image loaded</span>";
}

function showResult(text, engine) {
  lastDecodedText = text;
  if (elements.result) {
    elements.result.classList.remove("qr-result-empty");
    elements.result.textContent = text;
  }
  if (elements.copyBtn) elements.copyBtn.disabled = false;
}

function clearResult() {
  lastDecodedText = "";
  if (elements.result) {
    elements.result.classList.add("qr-result-empty");
    elements.result.innerHTML =
      '<span class="qr-result-placeholder">Result will appear here.</span>';
  }
  if (elements.copyBtn) elements.copyBtn.disabled = true;
}

function normalizeUrl(raw) {
  const value = (raw || "").trim();
  if (!value) return "";
  if (/^(https?:|data:)/i.test(value)) return value;
  return `https://${value}`;
}

// Route external images through the same-origin proxy so the browser does a
// plain same-origin load (no CORS, no tainted canvas).
function toLoadableSrc(url) {
  if (/^data:/i.test(url)) return url;
  return `/api/proxy?url=${encodeURIComponent(url)}`;
}

function loadImage(src) {
  return new Promise(function (resolve, reject) {
    const img = new Image();
    let settled = false;
    const timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      reject(new Error("Image load timed out."));
    }, 20000);

    img.onload = function () {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = async function () {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        const resp = await fetch(src);
        const ct = resp.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const data = await resp.json();
          reject(new Error(data.error || "Failed to load image."));
          return;
        }
      } catch {
        /* ignore */
      }
      reject(new Error("Failed to load image."));
    };
    img.src = src;
  });
}

// ---- Pixel helpers -------------------------------------------------------

function getBaseImageData(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error("Image has no readable dimensions.");
  const canvas = elements.canvas;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function toGray(rgba, w, h) {
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    gray[j] = (rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114) | 0;
  }
  return gray;
}

function grayToRGBA(gray, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < gray.length; j++) {
    const k = j * 4;
    out[k] = out[k + 1] = out[k + 2] = gray[j];
    out[k + 3] = 255;
  }
  return out;
}

function invert(gray) {
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = 255 - gray[i];
  return out;
}

function threshold(gray, t) {
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = gray[i] < t ? 0 : 255;
  return out;
}

function upscaleGray(gray, w, h, f) {
  const W2 = w * f;
  const H2 = h * f;
  const out = new Uint8ClampedArray(W2 * H2);
  for (let y = 0; y < H2; y++) {
    const sy = (y / f) | 0;
    for (let x = 0; x < W2; x++) {
      out[y * W2 + x] = gray[sy * w + ((x / f) | 0)];
    }
  }
  return { data: out, width: W2, height: H2 };
}

// ---- Decoders ------------------------------------------------------------

// Engine 1: zbar (strongest for artistic / inverted codes).
async function decodeZbar(gray, w, h) {
  try {
    const rgba = grayToRGBA(gray, w, h);
    const symbols = await scanRGBABuffer(rgba.buffer, w, h);
    if (symbols && symbols.length) {
      return symbols[0].decode();
    }
  } catch {
    /* fall through */
  }
  return null;
}

// Engine 2: ZXing (good general fallback, TRY_HARDER).
let zxingReader = null;
function getZxingReader() {
  if (zxingReader) return zxingReader;
  const ZX = window.ZXing;
  if (!ZX) return null;
  const reader = new ZX.MultiFormatReader();
  const hints = new Map();
  hints.set(ZX.DecodeHintType.TRY_HARDER, true);
  hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.QR_CODE]);
  reader.setHints(hints);
  zxingReader = { reader, ZX };
  return zxingReader;
}

function decodeZxing(gray, w, h) {
  const z = getZxingReader();
  if (!z) return null;
  try {
    const src = new z.ZX.RGBLuminanceSource(gray, w, h);
    const bmp = new z.ZX.BinaryBitmap(new z.ZX.HybridBinarizer(src));
    z.reader.reset();
    const r = z.reader.decode(bmp);
    return r ? r.getText() : null;
  } catch {
    return null;
  }
}

// Engine 3: jsQR (lightweight, last resort).
function decodeJsQR(gray, w, h) {
  if (typeof window.jsQR !== "function") return null;
  try {
    const rgba = grayToRGBA(gray, w, h);
    const code = window.jsQR(rgba, w, h, { inversionAttempts: "attemptBoth" });
    return code && code.data ? code.data : null;
  } catch {
    return null;
  }
}

// Try all engines on one gray buffer.
async function runEngines(gray, w, h) {
  const zbar = await decodeZbar(gray, w, h);
  if (zbar) return { text: zbar, engine: "zbar" };
  const zxing = decodeZxing(gray, w, h);
  if (zxing) return { text: zxing, engine: "zxing" };
  const js = decodeJsQR(gray, w, h);
  if (js) return { text: js, engine: "jsQR" };
  return null;
}

// Full decode pipeline: build preprocessing variants, run engines on each,
// stop at the first hit. Mirrors the zbar+zxing strategy used by tuzim.net.
async function decodePipeline(img) {
  const base = getBaseImageData(img);
  const w = base.width;
  const h = base.height;
  const gray = toGray(base.data, w, h);
  const inv = invert(gray);

  // Variant generators, ordered cheapest/most-likely first.
  const variants = [];
  variants.push({ tag: "gray", data: gray, w, h });
  variants.push({ tag: "inverted", data: inv, w, h });
  for (const t of [110, 128, 145, 90, 160]) {
    variants.push({ tag: `threshold-${t}`, data: threshold(gray, t), w, h });
  }

  // Try the un-scaled variants first.
  for (const v of variants) {
    const hit = await runEngines(v.data, v.w, v.h);
    if (hit) return hit;
  }

  // Then upscale each variant (helps dense / small-module artistic codes).
  for (const f of [2, 3]) {
    for (const v of variants) {
      const up = upscaleGray(v.data, v.w, v.h, f);
      const hit = await runEngines(up.data, up.width, up.height);
      if (hit) return hit;
    }
  }

  return null;
}

// ---- UI handlers ---------------------------------------------------------

async function handleDecode() {
  const url = normalizeUrl(elements.input ? elements.input.value : "");
  if (!url) {
    setStatus("Please enter an image URL first.", "error");
    if (elements.input) elements.input.focus();
    return;
  }

  clearResult();
  clearPreview();
  setBusy(true);
  setStatus("Fetching image...", "loading");

  try {
    const src = toLoadableSrc(url);
    const img = await loadImage(src);
    showPreview(src);

    setStatus("Decoding (zbar > zxing > jsQR, multi-pass)...", "loading");
    const hit = await decodePipeline(img);

    if (hit) {
      showResult(hit.text, hit.engine);
      setStatus(`Decoded successfully via ${hit.engine}.`, "success");
    } else {
      setStatus(
        "No QR code could be decoded. The image may be too distorted; try WeChat as the site suggests.",
        "error"
      );
    }
  } catch (err) {
    setStatus(err && err.message ? err.message : String(err), "error");
  } finally {
    setBusy(false);
  }
}

async function handleCopy() {
  if (!lastDecodedText) return;
  try {
    await navigator.clipboard.writeText(lastDecodedText);
    setStatus("Result copied to clipboard.", "success");
  } catch {
    setStatus("Copy failed. Please copy manually.", "error");
  }
}

function bind() {
  if (elements.decodeBtn) elements.decodeBtn.addEventListener("click", handleDecode);
  if (elements.copyBtn) elements.copyBtn.addEventListener("click", handleCopy);
  if (elements.input) {
    elements.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        handleDecode();
      }
    });
  }
}

clearResult();
clearPreview();
setStatus("", "");
bind();
