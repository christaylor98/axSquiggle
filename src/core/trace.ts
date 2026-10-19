import { bbox, dp, pathLen } from './geom';
import { recognize } from './recognize';
import { DEVICES, GRID, type Device, type Pt, type Shape } from './types';

/** An image as the browser's ImageData gives it: RGBA bytes. */
export interface Raster { width: number; height: number; data: Uint8ClampedArray | Uint8Array }

export interface TraceResult { shapes: Shape[]; device: Device; /** how many strokes and text clusters were found, for the toast */ strokes: number; texts: number }

const WORK = 800; // longest side the tracer works at; plenty for a phone photo of a sketch

// ---------------- raster steps ----------------

/** Grayscale (alpha composited on white), box-downscaled so the longest side is at most WORK. */
function toGray(img: Raster): { g: Float32Array; w: number; h: number } {
  const k = Math.min(1, WORK / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y / k), y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) / k)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x / k), x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) / k)));
      let s = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * img.width + xx) * 4, a = img.data[i + 3] / 255;
        s += (0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]) * a + 255 * (1 - a); n++;
      }
      g[y * w + x] = n ? s / n : 255;
    }
  }
  return { g, w, h };
}

/** Ink = clearly darker than its neighbourhood (so uneven lighting on a paper photo does not matter) and not just mid-grey. */
function inkMask(g: Float32Array, w: number, h: number): Uint8Array {
  const ii = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += g[y * w + x]; ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row; } }
  const r = Math.max(8, Math.round(Math.min(w, h) / 25));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const sum = ii[y1 * (w + 1) + x1] - ii[y0 * (w + 1) + x1] - ii[y1 * (w + 1) + x0] + ii[y0 * (w + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0)), v = g[y * w + x];
      out[y * w + x] = v < mean * 0.8 && v < 200 ? 1 : 0;
    }
  }
  return out;
}

const N8: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

function dilate(m: Uint8Array, w: number, h: number): Uint8Array {
  const o = new Uint8Array(m);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) if (!m[y * w + x]) for (const [dx, dy] of N8) if (m[(y + dy) * w + x + dx]) { o[y * w + x] = 1; break; }
  return o;
}

/** Drop connected blobs smaller than `min` pixels (paper grain, dust). */
function despeckle(m: Uint8Array, w: number, h: number, min: number) {
  const seen = new Uint8Array(w * h);
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || seen[s]) continue;
    const stack = [s], comp: number[] = [];
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!; comp.push(p);
      const x = p % w, y = (p - x) / w;
      for (const [dx, dy] of N8) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const q = ny * w + nx; if (m[q] && !seen[q]) { seen[q] = 1; stack.push(q); } }
    }
    if (comp.length < min) for (const p of comp) m[p] = 0;
  }
}

/** Zhang-Suen thinning: reduces every stroke to a one-pixel centre line. */
function thin(m: Uint8Array, w: number, h: number) {
  const idx = (x: number, y: number) => y * w + x;
  for (let iter = 0; iter < 80; iter++) {
    let changed = false;
    for (let pass = 0; pass < 2; pass++) {
      const kill: number[] = [];
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        if (!m[idx(x, y)]) continue;
        const p2 = m[idx(x, y - 1)], p3 = m[idx(x + 1, y - 1)], p4 = m[idx(x + 1, y)], p5 = m[idx(x + 1, y + 1)];
        const p6 = m[idx(x, y + 1)], p7 = m[idx(x - 1, y + 1)], p8 = m[idx(x - 1, y)], p9 = m[idx(x - 1, y - 1)];
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        let A = 0; for (let i = 0; i < 8; i++) if (!seq[i] && seq[i + 1]) A++;
        if (A !== 1) continue;
        if (pass === 0 ? (p2 * p4 * p6 === 0 && p4 * p6 * p8 === 0) : (p2 * p4 * p8 === 0 && p2 * p6 * p8 === 0)) kill.push(idx(x, y));
      }
      for (const k of kill) m[k] = 0;
      if (kill.length) changed = true;
    }
    if (!changed) break;
  }
}

// ---------------- skeleton -> strokes ----------------

interface Stroke { pts: Pt[]; closed: boolean }

/**
 * Walk the skeleton into polylines: from each endpoint/junction along the line, plus lone loops. Staircase pixels (three
 * mutually adjacent neighbours) are ordinary line pixels, not junctions, which is what the crossing number tells apart.
 * Short dead-end spurs hanging off a junction are dropped.
 */
function skeletonStrokes(m: Uint8Array, w: number, h: number, spur: number): Stroke[] {
  const at = (p: number, dx: number, dy: number) => { const x = (p % w) + dx, y = Math.floor(p / w) + dy; return x >= 0 && y >= 0 && x < w && y < h ? m[y * w + x] : 0; };
  const nb = (p: number) => { const x = p % w, y = (p - x) / w, out: number[] = []; for (const [dx, dy] of N8) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h && m[ny * w + nx]) out.push(ny * w + nx); } return out; };
  const kind = new Uint8Array(w * h); // 0 none, 1 line pixel, 2 endpoint, 3 junction
  for (let p = 0; p < m.length; p++) {
    if (!m[p]) continue;
    let cn = 0, deg = 0;
    for (let i = 0; i < 8; i++) { const a = at(p, N8[i][0], N8[i][1]), b = at(p, N8[(i + 1) % 8][0], N8[(i + 1) % 8][1]); if (a) deg++; if (!a && b) cn++; }
    kind[p] = deg <= 1 ? 2 : cn >= 3 ? 3 : 1;
  }
  const visited = new Uint8Array(w * h);
  const pt = (p: number): Pt => ({ x: p % w, y: Math.floor(p / w) });
  const adj = (a: number, b: number) => Math.abs((a % w) - (b % w)) <= 1 && Math.abs(Math.floor(a / w) - Math.floor(b / w)) <= 1;
  const out: Stroke[] = [];
  const walk = (start: number, first: number): number[] => {
    const path = [start, first];
    visited[first] = 1;
    let prev = start, cur = first;
    while (kind[cur] === 1) {
      const cand = nb(cur).filter((q) => q !== prev && (kind[q] !== 1 || !visited[q]));
      if (!cand.length) break;
      // end on a node if one is next to us; otherwise take the neighbour that is not adjacent to where we came from
      const node = cand.find((q) => kind[q] !== 1);
      const far = cand.filter((q) => !adj(q, prev));
      const nxt = node ?? (far.length ? far[0] : cand[0]);
      path.push(nxt); if (kind[nxt] === 1) visited[nxt] = 1;
      prev = cur; cur = nxt;
    }
    return path;
  };
  for (let p = 0; p < m.length; p++) {
    if (!m[p] || kind[p] === 1) continue;
    for (const q of nb(p)) {
      if (kind[q] !== 1 || visited[q]) continue;
      const path = walk(p, q), end = path[path.length - 1];
      if (path.length < spur && (kind[p] === 2 || kind[end] === 2) && (kind[p] === 3 || kind[end] === 3)) continue; // a spur off a junction
      out.push({ pts: path.map(pt), closed: path[0] === end });
    }
  }
  for (let p = 0; p < m.length; p++) { // loops with no endpoint or junction at all
    if (!m[p] || kind[p] !== 1 || visited[p]) continue;
    visited[p] = 1;
    const free = nb(p).filter((q) => kind[q] === 1 && !visited[q]);
    if (!free.length) continue;
    const path = walk(p, free[0]);
    out.push({ pts: path.map(pt), closed: adj(path[path.length - 1], p) });
  }
  return out;
}

/**
 * Where exactly two stroke ends meet (a corner, the tip of an arrowhead, a zigzag turn) the strokes are really one stroke that
 * the skeleton cut in two; join them. Three or more ends meeting is a genuine junction and stays split.
 */
function joinStrokes(strokes: Stroke[], near = 3.5): Stroke[] {
  const S = strokes.map((s) => ({ pts: [...s.pts], closed: s.closed }));
  for (let guard = 0; guard < 4000; guard++) {
    const ends: { s: number; tail: boolean; p: Pt }[] = [];
    S.forEach((s, i) => { if (!s || s.closed || s.pts.length < 2) return; ends.push({ s: i, tail: false, p: s.pts[0] }, { s: i, tail: true, p: s.pts[s.pts.length - 1] }); });
    let joined = false;
    for (const e of ends) {
      const here = ends.filter((o) => dist2(o.p, e.p) <= near * near);
      if (here.length !== 2) continue;
      const [a, b] = here;
      if (a.s === b.s) { S[a.s].closed = true; joined = true; break; }
      const A = S[a.s].pts, B = S[b.s].pts;
      const left = a.tail ? A : [...A].reverse(), right = b.tail ? [...B].reverse() : B;
      S[a.s] = { pts: [...left, ...right], closed: false };
      S[b.s] = undefined as never;
      joined = true; break;
    }
    if (!joined) break;
  }
  return S.filter(Boolean);
}

/** Handwriting is a wiggly mark that is short in height; ruled shapes and lines have few direction changes for their length. */
function handwriting(c: Pt[][], b: { w: number; h: number }): boolean {
  if (b.h >= 45 || b.w < 8) return false;
  const len = c.reduce((n, p) => n + pathLen(p), 0);
  const simp = c.map((p) => dp(p, 3));
  const verts = simp.reduce((n, p) => n + p.length, 0);
  // a long straight run (an arrow's shaft, an underline) is drawing, however wobbly the pen
  const longest = Math.max(...simp.map((p) => p.slice(1).reduce((m, q, i) => Math.max(m, Math.hypot(q.x - p[i].x, q.y - p[i].y)), 0)));
  return longest < 0.5 * Math.max(b.w, b.h) && verts >= 6 && verts / Math.max(1, len / 10) > 0.35;
}

// ---------------- strokes -> shapes ----------------

type Line = Extract<Shape, { k: 'line' }>;
const isPlain = (s: Shape): s is Line => s.k === 'line' && !s.arrow && !s.via;

/** Join collinear line pieces (a box side split by a T-junction becomes one line again). */
function joinCollinear(lines: Line[]): Line[] {
  const L = [...lines];
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j];
      const horiz = Math.abs(a.y1 - a.y2) < 6 && Math.abs(b.y1 - b.y2) < 6 && Math.abs(a.y1 - b.y1) < 9;
      const vert = Math.abs(a.x1 - a.x2) < 6 && Math.abs(b.x1 - b.x2) < 6 && Math.abs(a.x1 - b.x1) < 9;
      if (!horiz && !vert) continue;
      const [a0, a1, b0, b1] = horiz ? [Math.min(a.x1, a.x2), Math.max(a.x1, a.x2), Math.min(b.x1, b.x2), Math.max(b.x1, b.x2)] : [Math.min(a.y1, a.y2), Math.max(a.y1, a.y2), Math.min(b.y1, b.y2), Math.max(b.y1, b.y2)];
      if (Math.max(a0, b0) - Math.min(a1, b1) > 14) continue;       // too far apart
      const lo = Math.min(a0, b0), hi = Math.max(a1, b1);
      L[i] = horiz ? { k: 'line', x1: lo, y1: (a.y1 + b.y1) / 2, x2: hi, y2: (a.y1 + b.y1) / 2 } : { k: 'line', x1: (a.x1 + b.x1) / 2, y1: lo, x2: (a.x1 + b.x1) / 2, y2: hi };
      L.splice(j, 1); merged = true; break outer;
    }
  }
  return L;
}

/** Four lines that meet at the corners of a rectangle are a box (people often draw boxes as separate strokes). */
function boxesFromLines(lines: Line[]): { rects: Shape[]; rest: Line[] } {
  const H = lines.filter((l) => Math.abs(l.y1 - l.y2) < 6), V = lines.filter((l) => Math.abs(l.x1 - l.x2) < 6);
  const used = new Set<Line>(), rects: Shape[] = [];
  const hx = (l: Line) => [Math.min(l.x1, l.x2), Math.max(l.x1, l.x2)] as const;
  const vy = (l: Line) => [Math.min(l.y1, l.y2), Math.max(l.y1, l.y2)] as const;
  for (let a = 0; a < H.length; a++) for (let b = a + 1; b < H.length; b++) {
    const top = H[a].y1 < H[b].y1 ? H[a] : H[b], bot = top === H[a] ? H[b] : H[a];
    if (used.has(top) || used.has(bot) || bot.y1 - top.y1 < 14) continue;
    const [t0, t1] = hx(top), [b0, b1] = hx(bot), tol = Math.max(14, 0.12 * (t1 - t0));
    if (Math.abs(t0 - b0) > tol || Math.abs(t1 - b1) > tol) continue;
    const left = V.find((v) => !used.has(v) && Math.abs(v.x1 - Math.min(t0, b0)) < tol && Math.abs(vy(v)[0] - top.y1) < tol && Math.abs(vy(v)[1] - bot.y1) < tol);
    const right = V.find((v) => v !== left && !used.has(v) && Math.abs(v.x1 - Math.max(t1, b1)) < tol && Math.abs(vy(v)[0] - top.y1) < tol && Math.abs(vy(v)[1] - bot.y1) < tol);
    if (!left || !right) continue;
    [top, bot, left, right].forEach((l) => used.add(l));
    rects.push({ k: 'rect', x: left.x1, y: top.y1, w: right.x1 - left.x1, h: bot.y1 - top.y1 });
  }
  return { rects, rest: lines.filter((l) => !used.has(l)) };
}

/**
 * A long line whose end carries two short strokes folded back at roughly +-20..60 degrees is an arrow drawn with a V head.
 * (A single folded-back hook arrives from the recogniser already; this is the other common way to draw a head.)
 */
function arrowsFromBarbs(lines: Line[]): Shape[] {
  const out: Shape[] = [], used = new Set<Line>();
  const len = (l: Line) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
  for (const L of lines) {
    if (used.has(L) || len(L) < 50) continue;
    for (const tip of [{ x: L.x2, y: L.y2, ox: L.x1, oy: L.y1 }, { x: L.x1, y: L.y1, ox: L.x2, oy: L.y2 }]) {
      const back = Math.atan2(tip.oy - tip.y, tip.ox - tip.x);
      const barbs = lines.filter((b) => b !== L && !used.has(b) && len(b) >= 8 && len(b) <= 0.45 * len(L)).flatMap((b) => {
        const e = [{ x: b.x1, y: b.y1, fx: b.x2, fy: b.y2 }, { x: b.x2, y: b.y2, fx: b.x1, fy: b.y1 }].find((q) => Math.hypot(q.x - tip.x, q.y - tip.y) <= 10);
        if (!e) return [];
        let d = Math.atan2(e.fy - e.y, e.fx - e.x) - back;
        while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        return Math.abs(d) > 0.3 && Math.abs(d) < 1.1 ? [{ b, side: Math.sign(d) }] : [];
      });
      const pos = barbs.find((x) => x.side > 0), neg = barbs.find((x) => x.side < 0);
      if (pos && neg) {
        used.add(L); used.add(pos.b); used.add(neg.b);
        out.push(tip.x === L.x2 && tip.y === L.y2 ? { ...L, arrow: true } : { k: 'line', x1: L.x2, y1: L.y2, x2: L.x1, y2: L.y1, arrow: true });
        break;
      }
    }
  }
  return [...out, ...lines.filter((l) => !used.has(l))];
}

const snap = (v: number) => Math.round(v / GRID) * GRID;

/**
 * Turn a photo or scan of a hand sketch into wireframe shapes, entirely offline: find the ink, thin it to strokes, run each
 * stroke through the same recogniser the drawing tool uses, rebuild boxes drawn as separate lines, and stand in for handwriting
 * with text placeholders (the image cannot be read without OCR or an AI; the placeholders show where text goes).
 */
export function traceImage(img: Raster, opts: { device?: Device } = {}): TraceResult {
  const { g, w, h } = toGray(img);
  const device: Device = opts.device ?? (h > w * 1.2 ? 'phone' : 'desktop');
  const F = DEVICES[device], k = Math.min(F.w / w, F.h / h);
  const ox = (F.w - w * k) / 2, oy = (F.h - h * k) / 2; // centred, exactly where the background image is drawn behind the frame
  const mask = dilate(inkMask(g, w, h), w, h);
  despeckle(mask, w, h, Math.max(12, Math.round(w * h * 0.00003)));
  thin(mask, w, h);
  const strokes = joinStrokes(skeletonStrokes(mask, w, h, Math.max(6, Math.round(w * 0.012))));
  const toFrame = (p: Pt): Pt => ({ x: p.x * k + ox, y: p.y * k + oy });

  // Split strokes into drawing strokes and glyph-sized marks (handwriting). A component is judged by its overall extent.
  const comps = groupStrokes(strokes.map((s) => s.pts.map(toFrame)));
  const glyphs: { b: ReturnType<typeof bbox>; ring: boolean }[] = [];
  const drawn: Pt[][] = [];
  for (const c of comps) {
    const all = c.flat(), b = bbox(all), size = Math.max(b.w, b.h);
    const ring = c.length === 1 && dist2(c[0][0], c[0][c[0].length - 1]) < 9 * 9 && size >= 14 && size <= 36 && b.w / Math.max(1, b.h) > 0.6 && b.w / Math.max(1, b.h) < 1.6;
    if ((size < 38 || handwriting(c, b)) && !(c.length === 1 && pathLen(c[0]) < 8)) glyphs.push({ b, ring });
    else if (size >= 38) c.forEach((p) => drawn.push(p));
  }

  // Rings that are not letters (no taller neighbours close by) are radio buttons / checkboxes.
  const shapes: Shape[] = [];
  const letters: typeof glyphs = [];
  for (const gl of glyphs) {
    if (!gl.ring) { letters.push(gl); continue; }
    const taller = glyphs.filter((o) => o !== gl && o.b.h >= 1.4 * gl.b.h && Math.abs((o.b.x + o.b.w / 2) - (gl.b.x + gl.b.w / 2)) < 2.2 * Math.max(gl.b.w, o.b.w) && Math.abs((o.b.y + o.b.h / 2) - (gl.b.y + gl.b.h / 2)) < gl.b.h * 1.2);
    if (taller.length >= 1) letters.push(gl);
    else shapes.push({ k: 'ell', x: snap(gl.b.x), y: snap(gl.b.y), w: 20, h: 20 });
  }

  const lines: Line[] = [];
  let strokeCount = 0;
  for (const pts of drawn) {
    if (pathLen(pts) < 14) continue;
    const r = recognize(dp(pts, 1.5), [], { snap: false });
    if (!r?.shape) continue;
    strokeCount++;
    if (isPlain(r.shape)) lines.push(r.shape); else shapes.push(r.shape);
  }
  const { rects, rest } = boxesFromLines(joinCollinear(lines));
  shapes.push(...rects, ...arrowsFromBarbs(rest));

  // Handwriting: cluster glyph marks into words/lines and stand in for them with text placeholders.
  let texts = 0;
  const cl = clusterGlyphs(letters.map((l) => l.b));
  for (const c of cl) {
    texts++;
    const many = c.n >= 7 && c.w > 140;
    shapes.push(many ? { k: 'tlines', x: snap(c.x), y: snap(c.y), w: Math.max(80, snap(c.w)), h: Math.max(20, snap(c.h)) } : { k: 'text', x: Math.round(c.x), y: Math.round(c.y + c.h), s: 'Label' });
  }
  return { shapes: shapes.map(tidy), device, strokes: strokeCount, texts };
}

const dist2 = (a: Pt, b: Pt) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Strokes that touch or nearly touch belong together (a box with its inner divider, a letter with its dot). */
function groupStrokes(strokes: Pt[][]): Pt[][][] {
  const boxes = strokes.map((s) => bbox(s));
  const parent = strokes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const near = (a: number, b: number) => {
    const A = boxes[a], B = boxes[b], gap = 3;
    if (A.x > B.x + B.w + gap || B.x > A.x + A.w + gap || A.y > B.y + B.h + gap || B.y > A.y + A.h + gap) return false;
    // bounding boxes overlap: they join only if some points are actually close
    const sa = strokes[a].filter((_, i) => i % 2 === 0), sb = strokes[b].filter((_, i) => i % 2 === 0);
    return sa.some((p) => sb.some((q) => dist2(p, q) <= 6 * 6));
  };
  for (let i = 0; i < strokes.length; i++) for (let j = i + 1; j < strokes.length; j++) if (find(i) !== find(j) && near(i, j)) parent[find(i)] = find(j);
  const groups = new Map<number, Pt[][]>();
  strokes.forEach((s, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), s]); });
  return [...groups.values()];
}

/** Merge glyph boxes that sit on one line close together into words, then stack neighbouring lines into one block. */
function clusterGlyphs(boxes: { x: number; y: number; w: number; h: number }[]) {
  type C = { x: number; y: number; w: number; h: number; n: number };
  let cs: C[] = boxes.map((b) => ({ ...b, n: 1 })).sort((a, b) => a.x - b.x);
  const merge = (a: C, b: C): C => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y, n: a.n + b.n }; };
  let again = true;
  while (again) {
    again = false;
    for (let i = 0; i < cs.length && !again; i++) for (let j = i + 1; j < cs.length && !again; j++) {
      const a = cs[i], b = cs[j], hh = Math.max(a.h, b.h, 14);
      const gapX = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
      const ov = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (gapX <= 1.1 * hh && ov >= 0.35 * Math.min(a.h, b.h)) { cs = [...cs.filter((_, k) => k !== i && k !== j), merge(a, b)]; again = true; }
    }
  }
  // lines of text stacked closely (a paragraph): join vertically when they overlap horizontally
  again = true;
  while (again) {
    again = false;
    for (let i = 0; i < cs.length && !again; i++) for (let j = i + 1; j < cs.length && !again; j++) {
      const a = cs[i], b = cs[j];
      const gapY = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h), ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if (a.n >= 5 && b.n >= 5 && gapY <= 0.9 * Math.max(a.h, b.h) && ox > 0.5 * Math.min(a.w, b.w)) { cs = [...cs.filter((_, k) => k !== i && k !== j), merge(a, b)]; again = true; }
    }
  }
  return cs;
}

/** Round to whole pixels and keep everything on the frame. */
function tidy(s: Shape): Shape {
  const r = Math.round;
  switch (s.k) {
    case 'line': return { ...s, x1: r(s.x1), y1: r(s.y1), x2: r(s.x2), y2: r(s.y2), ...(s.via ? { via: s.via.map(([a, b]) => [r(a), r(b)]) } : {}) };
    case 'free': return { ...s, pts: s.pts.map(([a, b]) => [r(a), r(b)]) };
    case 'text': return { ...s, x: r(s.x), y: r(s.y) };
    default: return { ...s, x: r(s.x), y: r(s.y), w: Math.max(4, r(s.w)), h: Math.max(4, r(s.h)) };
  }
}
