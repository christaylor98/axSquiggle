import type { Pt, Shape } from './types';

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function pathLen(p: Pt[]): number {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += dist(p[i - 1], p[i]);
  return l;
}

export function bbox(p: Pt[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of p) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Resample a polyline to roughly even spacing. */
export function resample(p: Pt[], step: number): Pt[] {
  if (p.length < 2) return p.slice();
  const out: Pt[] = [p[0]];
  let carry = 0;
  for (let i = 1; i < p.length; i++) {
    let a = out[out.length - 1];
    const b = p[i];
    let d = dist(a, b);
    while (carry + d >= step) {
      const t = (step - carry) / d;
      a = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      out.push(a);
      d = dist(a, b);
      carry = 0;
    }
    carry += d;
  }
  const last = p[p.length - 1];
  if (dist(out[out.length - 1], last) > 0.5) out.push(last);
  return out;
}

/** 3-point moving average that keeps the endpoints. */
export function smooth(p: Pt[], passes = 1): Pt[] {
  let cur = p;
  for (let k = 0; k < passes; k++) {
    cur = cur.map((q, i) => {
      if (i === 0 || i === cur.length - 1) return q;
      const a = cur[i - 1], b = cur[i + 1];
      return { x: (a.x + q.x + b.x) / 3, y: (a.y + q.y + b.y) / 3 };
    });
  }
  return cur;
}

/** Douglas-Peucker; returns the kept points. */
export function dp(p: Pt[], eps: number): Pt[] {
  if (p.length < 3) return p.slice();
  const keep = new Array(p.length).fill(false);
  keep[0] = keep[p.length - 1] = true;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(p[i], p[s], p[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx >= 0 && maxD > eps) { keep[idx] = true; stack.push([s, idx], [idx, e]); }
  }
  return p.filter((_, i) => keep[i]);
}

export function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Algebraic (Kasa) circle fit. Returns null for degenerate input. */
export function kasa(p: Pt[]): { cx: number; cy: number; r: number } | null {
  const n = p.length;
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (const q of p) { mx += q.x; my += q.y; }
  mx /= n; my /= n;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const q of p) {
    const u = q.x - mx, v = q.y - my;
    suu += u * u; svv += v * v; suv += u * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const c1 = 0.5 * (suuu + suvv), c2 = 0.5 * (svvv + svuu);
  const uc = (c1 * svv - c2 * suv) / det;
  const vc = (suu * c2 - suv * c1) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  return { cx: uc + mx, cy: vc + my, r };
}

export function shoelace(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i].x * q.y - q.x * p[i].y;
  }
  return Math.abs(a) / 2;
}

export function pointInPoly(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export const snapTo = (v: number, g: number) => Math.round(v / g) * g;

// ---- text metrics (overridable by the UI with real canvas measurement) ----
export const FONT_PX = 18;
export const SUB_PX = 14;        // a sub-label is drawn this size, in a muted colour
export const LINE_STEP = 22;     // baseline to baseline, ordinary lines
export const SUB_STEP = 18;      // baseline to baseline, sub-label lines

export interface TextLine { text: string; sub: boolean; dy: number /* baseline offset from the first line's */; dx?: number /* indent that justifies the line within the block (only when the label is centred or right-justified) */ }

/**
 * A label is one or more lines. The first line is the label; a later line that is indented (starts with spaces or a tab)
 * is a sub-label (smaller, muted); any other later line just continues the label.
 */
export function textLines(s: string, wrap = 0, align: 'left' | 'center' | 'right' = 'left'): TextLine[] {
  const out: TextLine[] = [];
  let dy = 0;
  s.split('\n').forEach((raw, i) => {
    const text = raw.trim();
    if (!text && i > 0) return;
    const sub = i > 0 && /^[ \t]+\S/.test(raw), k = sub ? SUB_PX / FONT_PX : 1;
    // `wrap`: a width the words must fit in; a line that is too long carries on underneath (the text itself is not changed).
    const parts = wrap > 0 && textWidth(text) * k > wrap ? wrapText(text, wrap / k) : [text];
    parts.forEach((part, j) => {
      if (i > 0 || j > 0) dy += sub ? SUB_STEP : LINE_STEP;
      out.push({ text: part, sub, dy });
    });
  });
  if (align !== 'left' && out.length > 1) {   // each line sits centred (or right) within the block, not all hard against its left edge
    const lw = out.map((l) => textWidth(l.text) * (l.sub ? SUB_PX / FONT_PX : 1)), bw = Math.max(...lw);
    out.forEach((l, i) => { const d = align === 'center' ? (bw - lw[i]) / 2 : bw - lw[i]; if (d > 0.5) l.dx = d; });
  }
  return out;
}

/** Width and height of a label's text block (height from the top of the first line to the bottom of the last). */
export function textBlock(s: string, wrap = 0): { w: number; h: number } {
  const ls = textLines(s, wrap);
  const w = Math.max(...ls.map((l) => textWidth(l.text) * (l.sub ? SUB_PX / FONT_PX : 1)));
  return { w, h: ls[ls.length - 1].dy + FONT_PX * 1.1 };
}
let measurer: ((s: string) => number) | null = null;
export function setTextMeasurer(fn: ((s: string) => number) | null) { measurer = fn; }
export function textWidth(s: string): number {
  return measurer ? measurer(s) : s.length * FONT_PX * 0.52;
}

/** How far down a paragraph's lines start so they sit at the top, middle or bottom of its box. */
export const paragraphDy = (lineCount: number, height: number, av?: 'middle' | 'bottom'): number => {
  const th = (lineCount - 1) * PARA_LINE + 24;
  return av === 'middle' ? Math.max(0, (height - th) / 2) : av === 'bottom' ? Math.max(0, height - th) : 0;
};

/** How far in a wrapped line starts so it sits left, centred or right in a column of this width. */
export const justifyDx = (line: string, width: number, al?: 'center' | 'right'): number => (al === 'center' ? Math.max(0, (width - textWidth(line)) / 2) : al === 'right' ? Math.max(0, width - textWidth(line)) : 0);

/** Greedy word wrap to a pixel width using the current text measurer; long words are split. */
export function wrapText(s: string, width: number): string[] {
  const out: string[] = [];
  for (const para of s.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (textWidth(w) > width && w.length > 1) {
        let n = w.length - 1;
        while (n > 1 && textWidth(w.slice(0, n)) > width) n--;
        if (line) { out.push(line); line = ''; }
        out.push(w.slice(0, n)); w = w.slice(n);
      }
      const t = line ? `${line} ${w}` : w;
      if (line && textWidth(t) > width) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}
export const PARA_LINE = 24;
/** Height a paragraph needs for its text at this width (never less than the 60px placeholder). */
export const paraHeight = (s: string, width: number) => Math.max(60, wrapText(s, width).length * PARA_LINE + 8);

export interface Box { x: number; y: number; w: number; h: number }

/** A line's path: its two ends plus any waypoints it routes through. */
export function linePts(s: Extract<Shape, { k: 'line' }>): Pt[] {
  return [{ x: s.x1, y: s.y1 }, ...(s.via ?? []).map(([x, y]) => ({ x, y })), { x: s.x2, y: s.y2 }];
}

/** Axis-aligned bounds of any shape, in logical coordinates. */
export function bounds(s: Shape): Box {
  switch (s.k) {
    case 'line': return bbox(linePts(s));
    case 'text': { const tb = textBlock(s.s, s.wrap); return { x: s.x, y: s.y - FONT_PX * 0.8, w: tb.w, h: tb.h }; }
    case 'free': {
      const b = bbox(s.pts.map(([x, y]) => ({ x, y })));
      return b;
    }
    default: return { x: s.x, y: s.y, w: s.w, h: s.h };
  }
}

export const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
export const area = (b: Box) => Math.max(0, b.w) * Math.max(0, b.h);
export function interArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
export function contains(outer: Box, inner: Box, tol = 2): boolean {
  return inner.x >= outer.x - tol && inner.y >= outer.y - tol && inner.x + inner.w <= outer.x + outer.w + tol && inner.y + inner.h <= outer.y + outer.h + tol;
}

/** The middle of the longest run of a line, and where a label of this size goes: centred on it (the line breaks round the words). `half` is the gap to leave either side along the run. */
export function lineLabelSpot(s: Extract<Shape, { k: 'line' }>, text: string): { mid: Pt; x: number; y: number; seg: number; half: number } {
  const pts = linePts(s);
  let bi = 1, bl = -1;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); if (l > bl) { bl = l; bi = i; } }
  const p = pts[bi - 1], q = pts[bi], mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  const blk = textBlock(text), last = blk.h - FONT_PX * 1.1, level = Math.abs(q.x - p.x) >= Math.abs(q.y - p.y);
  return { mid, x: mid.x - blk.w / 2, y: mid.y + 6 - last / 2, seg: bi - 1, half: (level ? blk.w : blk.h) / 2 + 6 };
}

/** How far a point is from a line's path. */
export function distToLine(s: Extract<Shape, { k: 'line' }>, pt: Pt): number {
  const pts = linePts(s);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i], dx = q.x - p.x, dy = q.y - p.y, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((pt.x - p.x) * dx + (pt.y - p.y) * dy) / l2));
    best = Math.min(best, Math.hypot(pt.x - (p.x + t * dx), pt.y - (p.y + t * dy)));
  }
  return best;
}
