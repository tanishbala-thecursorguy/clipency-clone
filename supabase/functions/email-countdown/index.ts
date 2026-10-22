// email-countdown
// GET ?until=<ISO time>  ->  an animated GIF of the time left, "23:59:41",
// ticking down for 60 seconds from the moment the email is opened.
//
// Email clients run no JavaScript, so a live countdown in an email can only be
// an image the server draws at open time. Every open (and every image proxy
// refetch) redraws it from the current clock. Public and harmless: it only
// ever draws digits.
//
// No dependencies: digits are drawn from stroke paths with analytic
// anti-aliasing, then written as a GIF with a small LZW encoder.

const W = 560, H = 120;                        // drawn at 2x, shown at 280 x 60
const BG = [0xf6, 0xf3, 0xec], INK = [0x14, 0x12, 0x0e], DIM = [0xa0, 0x9a, 0x90];
const LEVELS = 16;                             // anti-alias steps per colour

/* ---------- glyphs: strokes on a 10 x 16 unit box ---------- */
type Pt = [number, number];
const ell = (cx: number, cy: number, rx: number, ry: number, a0 = 0, a1 = Math.PI * 2, n = 48): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * i / n; out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); }
  return out;
};
const GLYPH: Record<string, Pt[][]> = {
  "0": [ell(5, 8, 3.7, 6.9)],
  "1": [[[2.6, 3.4], [5.4, 1.1], [5.4, 15]]],
  "2": [[[1.7, 4.3], [2.3, 2.3], [3.9, 1.1], [6.1, 1.1], [7.7, 2.3], [8.3, 4.2], [7.9, 6.3], [6.4, 8.2], [1.6, 14.9], [8.6, 14.9]]],
  "3": [[[1.8, 2.6], [3.3, 1.1], [6.2, 1.1], [7.9, 2.6], [8.1, 4.8], [7.0, 6.8], [4.4, 7.8]],
        [[4.4, 7.8], [7.2, 8.6], [8.5, 10.8], [8.2, 13.2], [6.4, 14.9], [3.4, 14.9], [1.6, 13.3]]],
  "4": [[[6.6, 15], [6.6, 1.1], [1.3, 10.9], [8.9, 10.9]]],
  "5": [[[8.1, 1.1], [2.4, 1.1], [1.9, 7.1], [3.6, 6.2], [6.0, 6.1], [7.9, 7.4], [8.5, 10.2], [8.1, 12.9], [6.4, 14.9], [3.6, 15], [1.6, 13.5]]],
  "6": [[[7.8, 2.1], [6.1, 1.1], [4.1, 1.2], [2.4, 2.6], [1.6, 5.4], [1.5, 10.6]], ell(5.05, 10.9, 3.55, 4.05)],
  "7": [[[1.3, 1.1], [8.8, 1.1], [4.1, 15]]],
  "8": [ell(5, 4.3, 3.1, 3.2), ell(5, 11.35, 3.75, 3.65)],
  "9": [ell(4.95, 5.1, 3.55, 4.05), [[8.5, 5.4], [8.4, 10.6], [7.6, 13.4], [5.9, 14.9], [3.9, 15], [2.2, 14]]],
};
const COLON_DOTS: Pt[] = [[2.5, 5.2], [2.5, 11.2]];

const S = 5.4;                                 // px per unit
const HALF = 0.86 * S;                         // half stroke width in px
const CELL_W = { d: 10, c: 5 }, GAP = 1.2, TOP = (H - 16 * S) / 2;

function segDist(px: number, py: number, a: Pt, b: Pt) {
  const vx = b[0] - a[0], vy = b[1] - a[1], wx = px - a[0], wy = py - a[1];
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy || 1)));
  const dx = wx - vx * t, dy = wy - vy * t;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Coverage bitmap (0..1) of one glyph, in its own cell. */
function drawGlyph(ch: string): { w: number; h: number; a: Float32Array } {
  const cw = Math.ceil((ch === ":" ? CELL_W.c : CELL_W.d) * S), ch_ = Math.ceil(16 * S) + 2;
  const a = new Float32Array(cw * ch_);
  const paths = GLYPH[ch] ?? [];
  for (let y = 0; y < ch_; y++) for (let x = 0; x < cw; x++) {
    const px = x + 0.5, py = y + 0.5 - 1;
    let d = Infinity;
    if (ch === ":") {
      for (const [cx, cy] of COLON_DOTS) d = Math.min(d, Math.hypot(px - cx * S, py - cy * S) - 0.95 * S);
      a[y * cw + x] = Math.max(0, Math.min(1, 0.5 - d));
      continue;
    }
    for (const p of paths) for (let i = 1; i < p.length; i++) {
      d = Math.min(d, segDist(px, py, [p[i - 1][0] * S, p[i - 1][1] * S], [p[i][0] * S, p[i][1] * S]));
    }
    a[y * cw + x] = Math.max(0, Math.min(1, HALF + 0.5 - d));
  }
  return { w: cw, h: ch_, a };
}

const CACHE = new Map<string, ReturnType<typeof drawGlyph>>();
const glyph = (c: string) => { let g = CACHE.get(c); if (!g) { g = drawGlyph(c); CACHE.set(c, g); } return g; };

/** Palette index image of the text. */
function frame(text: string): Uint8Array {
  const img = new Uint8Array(W * H);                     // 0 = background
  const units = [...text].reduce((s, c) => s + (c === ":" ? CELL_W.c : CELL_W.d), 0) + GAP * (text.length - 1);
  let x0 = Math.round((W - units * S) / 2);
  for (const c of text) {
    const g = glyph(c), top = Math.round(TOP) - 1, base = c === ":" ? LEVELS : 0;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const v = g.a[y * g.w + x];
      if (v <= 0) continue;
      const X = x0 + x, Y = top + y;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const lvl = Math.min(LEVELS - 1, Math.round(v * (LEVELS - 1)));
      if (lvl > 0) img[Y * W + X] = base + lvl;
    }
    x0 += Math.round(((c === ":" ? CELL_W.c : CELL_W.d) + GAP) * S);
  }
  return img;
}

function palette(): Uint8Array {
  const p = new Uint8Array(32 * 3);
  for (let i = 0; i < 32; i++) {
    const to = i < LEVELS ? INK : DIM, t = (i % LEVELS) / (LEVELS - 1);
    for (let k = 0; k < 3; k++) p[i * 3 + k] = Math.round(BG[k] + (to[k] - BG[k]) * t);
  }
  return p;
}

/* ---------- GIF writer ---------- */
function lzw(minCode: number, idx: Uint8Array): Uint8Array {
  const out: number[] = [];
  let cur = 0, shift = 0;
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, next = eoi + 1, table = new Map<number, number>();
  const emit = (code: number) => {
    cur |= code << shift; shift += size;
    while (shift >= 8) { out.push(cur & 0xff); cur >>>= 8; shift -= 8; }
  };
  emit(clear);
  let ib = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i], key = (ib << 8) | k, code = table.get(key);
    if (code === undefined) {
      emit(ib);
      if (next === 4096) { emit(clear); next = eoi + 1; size = minCode + 1; table = new Map(); }
      else { if (next >= (1 << size)) size++; table.set(key, next++); }
      ib = k;
    } else ib = code;
  }
  emit(ib); emit(eoi);
  if (shift > 0) out.push(cur & 0xff);
  // sub-blocks of at most 255 bytes
  const blocks: number[] = [minCode];
  for (let i = 0; i < out.length; i += 255) {
    const n = Math.min(255, out.length - i);
    blocks.push(n, ...out.slice(i, i + n));
  }
  blocks.push(0);
  return new Uint8Array(blocks);
}

const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];

export function hms(seconds: number) {
  const s = Math.max(0, Math.min(99 * 3600 + 3599, Math.floor(seconds)));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return [h, m, r].map((v) => String(v).padStart(2, "0")).join(":");
}

export function countdownGif(secondsLeft: number, frames = 60): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...le16(W), ...le16(H), 0xf4, 0, 0]));
  parts.push(palette());
  let prev: Uint8Array | null = null;
  const n = secondsLeft <= 0 ? 1 : Math.min(frames, Math.floor(secondsLeft) + 1);
  for (let f = 0; f < n; f++) {
    const img = frame(hms(secondsLeft - f));
    // only the rectangle that changed since the last frame
    let x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1;
    if (prev) {
      x0 = W; y0 = H; x1 = -1; y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (img[y * W + x] !== prev[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 < 0) { x0 = y0 = x1 = y1 = 0; }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, sub = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) sub.set(img.subarray((y0 + y) * W + x0, (y0 + y) * W + x0 + w), y * w);
    const last = f === n - 1;
    parts.push(new Uint8Array([0x21, 0xf9, 0x04, 0x04, ...le16(last ? 0 : 100), 0, 0]));
    parts.push(new Uint8Array([0x2c, ...le16(x0), ...le16(y0), ...le16(w), ...le16(h), 0]));
    parts.push(lzw(5, sub));
    prev = img;
  }
  parts.push(new Uint8Array([0x3b]));
  const len = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(len);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

if (import.meta.main) Deno.serve((req) => {
  const url = new URL(req.url);
  const until = Date.parse(url.searchParams.get("until") ?? "");
  const left = isNaN(until) ? 0 : (until - Date.now()) / 1000;
  return new Response(countdownGif(left).buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
