import { bbox, bounds, dist, dp, interArea, area, kasa, pathLen, resample, segDist, shoelace, smooth, snapTo, type Box } from './geom';
import { GRID, type Pt, type Shape } from './types';

export type Gesture = 'box' | 'ellipse' | 'circle' | 'line' | 'arrow' | 'corner' | 'paragraph' | 'erase' | 'image' | 'free';

export interface RecResult {
  gesture: Gesture;
  label: string;
  /** The clean shape to add (absent for erase / image conversion). */
  shape?: Shape;
  /** Index of an existing rect that becomes an img. */
  convert?: number;
  /** Index of an existing shape to delete. */
  remove?: number;
}

export interface RecOptions { snap: boolean; sketch?: boolean } // sketch: keep the stroke as drawn, no cleanup

/** Count horizontal direction reversals with a pixel hysteresis. */
export function horizontalReversals(p: Pt[], hyst = 6): number {
  if (!p.length) return 0;
  let dir = 0, hi = p[0].x, lo = p[0].x, ext = p[0].x, n = 0;
  for (const { x } of p) {
    if (dir === 0) {
      hi = Math.max(hi, x); lo = Math.min(lo, x);
      if (x - lo > hyst) { dir = 1; ext = x; } else if (hi - x > hyst) { dir = -1; ext = x; }
    } else if (dir === 1) {
      if (x > ext) ext = x; else if (ext - x > hyst) { dir = -1; ext = x; n++; }
    } else {
      if (x < ext) ext = x; else if (x - ext > hyst) { dir = 1; ext = x; n++; }
    }
  }
  return n;
}

const cosBetween = (a: Pt, b: Pt, c: Pt, d: Pt) => {
  const ux = b.x - a.x, uy = b.y - a.y, vx = d.x - c.x, vy = d.y - c.y;
  const m = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  return m === 0 ? 0 : (ux * vx + uy * vy) / m;
};

function snapBox(b: Box, snap: boolean): Box {
  if (!snap) return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
  const x = snapTo(b.x, GRID), y = snapTo(b.y, GRID);
  const w = Math.max(GRID, snapTo(b.x + b.w, GRID) - x), h = Math.max(GRID, snapTo(b.y + b.h, GRID) - y);
  return { x, y, w, h };
}

function boxShape(k: 'rect' | 'ell' | 'tlines', b: Box, snap: boolean): Shape {
  const s = snapBox(b, snap);
  return { k, x: s.x, y: s.y, w: s.w, h: s.h };
}

function minBox(b: Box, m = 12): Box {
  const w = Math.max(b.w, m), h = Math.max(b.h, m);
  return { x: b.x - (w - b.w) / 2, y: b.y - (h - b.h) / 2, w, h };
}

/**
 * A rounded or noisy corner can come out of Douglas-Peucker as two close vertices.
 * When a 4-point polyline's middle segment is under 30% of both arms, treat it as one
 * corner at the intersection of the outer arms. (Refinement of the 3-point rule.)
 */
function mergeCutCorner(poly: Pt[]): Pt[] {
  if (poly.length !== 4) return poly;
  const [a, b, c, d] = poly;
  if (dist(b, c) >= 0.3 * Math.min(dist(a, b), dist(c, d))) return poly;
  const r1x = b.x - a.x, r1y = b.y - a.y, r2x = c.x - d.x, r2y = c.y - d.y;
  const den = r1x * r2y - r1y * r2x;
  let corner: Pt = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
  if (Math.abs(den) > 1e-6) {
    const t = ((d.x - a.x) * r2y - (d.y - a.y) * r2x) / den;
    const q = { x: a.x + t * r1x, y: a.y + t * r1y };
    if (dist(q, corner) < 0.3 * Math.min(dist(a, b), dist(c, d))) corner = q;
  }
  return [a, corner, d];
}

/** Sharpest turn (radians) at any interior vertex of a simplified polyline. */
function maxTurn(poly: Pt[]): number {
  let m = 0;
  for (let i = 1; i < poly.length - 1; i++) {
    const a = Math.atan2(poly[i].y - poly[i - 1].y, poly[i].x - poly[i - 1].x), b = Math.atan2(poly[i + 1].y - poly[i].y, poly[i + 1].x - poly[i].x);
    let d = Math.abs(b - a); if (d > Math.PI) d = 2 * Math.PI - d;
    m = Math.max(m, d);
  }
  return m;
}

/** Turn angle (radians) at interior vertex i. */
function turnAt(poly: Pt[], i: number): number {
  const a = Math.atan2(poly[i].y - poly[i - 1].y, poly[i].x - poly[i - 1].x), b = Math.atan2(poly[i + 1].y - poly[i].y, poly[i + 1].x - poly[i].x);
  let d = Math.abs(b - a); if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

/** True when every bend of a simplified polyline turns the same way (an L, a corner, an arc), false for a zigzag or an S. */
function bendsOneWay(poly: Pt[]): boolean {
  let sign = 0;
  for (let i = 1; i < poly.length - 1; i++) {
    const c = (poly[i].x - poly[i - 1].x) * (poly[i + 1].y - poly[i].y) - (poly[i].y - poly[i - 1].y) * (poly[i + 1].x - poly[i].x);
    if (Math.abs(c) < 1e-6) continue;
    if (sign && Math.sign(c) !== sign) return false;
    sign = Math.sign(c);
  }
  return true;
}

/**
 * Index where a stroke turns sharply back on itself within its last stretch (the hook of a hand-drawn arrowhead), or -1.
 * The hook must be short next to the body and turn by more than ~130 degrees.
 */
function findHook(p: Pt[], cosMax = -0.8, bentMax = 0.2): number {
  const total = pathLen(p);
  if (total < 60) return -1;
  let acc = 0;
  for (let k = p.length - 1; k > 6; k--) {
    acc += dist(p[k], p[k - 1]);
    if (acc > Math.min(60, 0.35 * total)) break;
    if (acc < 10) continue;
    // Direction of the body arriving at k (over ~24px) against the hook leaving it.
    let m = k, run = 0;
    while (m > 0 && run < 24) { run += dist(p[m], p[m - 1]); m--; }
    if (run < 16) continue;
    const c = cosBetween(p[m], p[k], p[k], p[p.length - 1]);
    const tail = dist(p[k], p[p.length - 1]);
    // The hook is a short straight stroke; a curve that merely bends over at its end is not an arrowhead.
    const bent = p.slice(k).reduce((mx, q) => Math.max(mx, segDist(q, p[k], p[p.length - 1])), 0);
    if (c < cosMax && tail >= 10 && bent <= bentMax * tail) return k;
  }
  return -1;
}

/**
 * The end bit of an arrow: the stroke runs out to a tip (its farthest point from where it started) and then folds back in a short,
 * fairly straight stroke. Returns the tip's index, or -1. The shaft before it can be as wonky as you like, but it has to be going somewhere.
 */
function tipHook(pts: Pt[]): number {
  const first = pts[0], n = pts.length;
  let k = 0, far = 0;
  for (let i = 0; i < n; i++) { const d = dist(first, pts[i]); if (d > far) { far = d; k = i; } }
  if (k < 5 || k >= n - 2) return -1;
  const tailPts = pts.slice(k), tail = pathLen(tailPts), body = pathLen(pts.slice(0, k + 1));
  if (tail < 10 || tail > Math.min(40, 0.5 * body) || body < 36 || far < Math.max(30, 0.75 * body)) return -1;
  const end = pts[n - 1];
  if (tailPts.some((q) => segDist(q, pts[k], end) > 0.35 * Math.max(dist(pts[k], end), 1))) return -1;
  // The tail must fold back toward where the stroke started (more than ~80 degrees off the direction of travel).
  const bx = pts[k].x - first.x, by = pts[k].y - first.y, tx = end.x - pts[k].x, ty = end.y - pts[k].y;
  const cos = (bx * tx + by * ty) / (Math.hypot(bx, by) * Math.hypot(tx, ty) || 1);
  return cos < -0.15 ? k : -1;
}

export function recognize(raw: Pt[], shapes: Shape[], opts: RecOptions): RecResult | null {
  if (raw.length < 2 || pathLen(raw) < 8) return null;
  const pts = smooth(resample(raw, 4), 2);
  const bb = bbox(pts);
  const size = Math.max(bb.w, bb.h);
  const len = pathLen(pts);
  const first = pts[0], last = pts[pts.length - 1];
  const chord = dist(first, last);
  if (opts.sketch) {
    const hk = chord < 0.4 * size ? -1 : tipHook(pts);
    if (hk > 4) return { gesture: 'arrow', label: 'Kept as sketch → arrow', shape: { k: 'free', pts: dp(pts.slice(0, hk + 1), 2.5).map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]), arrow: true } };
    const simp = dp(pts, 2.5);
    return { gesture: 'free', label: 'Kept as sketch', shape: { k: 'free', pts: simp.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]) } };
  }

  // 1. Zigzag: scribble out a shape, or sketch paragraph lines.
  // (A loop that comes back to where it began and encloses real area is a box or circle being drawn, not a scribble.)
  const loopish = chord < 0.4 * size && bb.h > 20 && bb.w > 20 && shoelace(pts) / (bb.w * bb.h) > 0.55;
  if (bb.w >= 40 && !loopish && horizontalReversals(pts) >= 4) {
    const zb = minBox(bb, 1);
    let best = -1, bestR = 0.5;
    shapes.forEach((s, i) => {
      const sb = minBox(bounds(s));
      const r = interArea(zb, sb) / Math.max(1, Math.min(area(zb), area(sb)));
      if (r > bestR) { bestR = r; best = i; }
    });
    if (best >= 0) return { gesture: 'erase', label: 'Cleaned → erased', remove: best };
    return { gesture: 'paragraph', label: 'Cleaned → text lines', shape: boxShape('tlines', { ...bb, h: Math.max(bb.h, 20) }, opts.snap) };
  }

  // 1a. The end bit is what makes an arrow: any stroke that finishes with a short stroke folded back is an arrow from where it
  // started to where the hook turned, however wonky the line before it.
  if (chord >= 0.4 * size) {
    const k = tipHook(pts);
    if (k > 0) {
      let x1 = first.x, y1 = first.y, x2 = pts[k].x, y2 = pts[k].y;
      const ang = (Math.atan2(Math.abs(y2 - y1), Math.abs(x2 - x1)) * 180) / Math.PI;
      if (ang <= 10) { const y = (y1 + y2) / 2; y1 = y2 = y; } else if (ang >= 80) { const x = (x1 + x2) / 2; x1 = x2 = x; }
      if (opts.snap) { x1 = snapTo(x1, GRID); y1 = snapTo(y1, GRID); x2 = snapTo(x2, GRID); y2 = snapTo(y2, GRID); }
      const r = (v: number) => Math.round(v);
      return { gesture: 'arrow', label: 'Cleaned → arrow', shape: { k: 'line', x1: r(x1), y1: r(y1), x2: r(x2), y2: r(y2), arrow: true } };
    }
  }

  // 1b. Straight shaft ending in a short hook back: an arrow, however small the hook is next to the shaft
  // (the straight-line test below would otherwise absorb it as noise).
  {
    const k = findHook(pts, -0.55);
    if (k > 4) {
      const body = pts.slice(0, k + 1), bc = dist(first, pts[k]);
      if (bc > 30 && body.every((q) => segDist(q, first, pts[k]) <= 0.1 * bc)) {
        let x1 = first.x, y1 = first.y, x2 = pts[k].x, y2 = pts[k].y;
        const ang = (Math.atan2(Math.abs(y2 - y1), Math.abs(x2 - x1)) * 180) / Math.PI;
        if (ang <= 10) { const y = (y1 + y2) / 2; y1 = y2 = y; } else if (ang >= 80) { const x = (x1 + x2) / 2; x1 = x2 = x; }
        if (opts.snap) { x1 = snapTo(x1, GRID); y1 = snapTo(y1, GRID); x2 = snapTo(x2, GRID); y2 = snapTo(y2, GRID); }
        const r = (v: number) => Math.round(v);
        return { gesture: 'arrow', label: 'Cleaned → arrow', shape: { k: 'line', x1: r(x1), y1: r(y1), x2: r(x2), y2: r(y2), arrow: true } };
      }
    }
  }

  // 2. Straight line (or diagonal across a rect = image placeholder).
  // A quarter arc has chord/length = 0.9003, right on the 0.9 cut-off, so the ratio test
  // also requires the stroke to stay close to its chord (max deviation <= 12% of chord).
  const maxDev = pts.reduce((m, p) => Math.max(m, segDist(p, first, last)), 0);
  const straight = (len > 0 && chord / len > 0.9 && maxDev <= 0.12 * chord) || dp(pts, Math.max(6, 0.05 * chord)).length === 2;
  if (straight) {
    for (let i = 0; i < shapes.length; i++) {
      const s = shapes[i];
      if (s.k !== 'rect') continue;
      const tol = Math.max(24, 0.2 * Math.min(s.w, s.h));
      const near = (p: Pt, cx: number, cy: number) => dist(p, { x: cx, y: cy }) <= tol;
      const tl: [number, number] = [s.x, s.y], tr: [number, number] = [s.x + s.w, s.y];
      const bl: [number, number] = [s.x, s.y + s.h], br: [number, number] = [s.x + s.w, s.y + s.h];
      const pairs: [[number, number], [number, number]][] = [[tl, br], [tr, bl]];
      if (pairs.some(([a, b]) => (near(first, ...a) && near(last, ...b)) || (near(first, ...b) && near(last, ...a)))) {
        return { gesture: 'image', label: 'Cleaned → image', convert: i };
      }
    }
    let x1 = first.x, y1 = first.y, x2 = last.x, y2 = last.y;
    const ang = (Math.atan2(Math.abs(y2 - y1), Math.abs(x2 - x1)) * 180) / Math.PI;
    if (ang <= 10) { const y = (y1 + y2) / 2; y1 = y2 = y; }
    else if (ang >= 80) { const x = (x1 + x2) / 2; x1 = x2 = x; }
    if (opts.snap) { x1 = snapTo(x1, GRID); y1 = snapTo(y1, GRID); x2 = snapTo(x2, GRID); y2 = snapTo(y2, GRID); }
    const r = (v: number) => Math.round(v);
    return { gesture: 'line', label: 'Cleaned → line', shape: { k: 'line', x1: r(x1), y1: r(y1), x2: r(x2), y2: r(y2) } };
  }

  // 3. Arrow: long shaft, short tail turning back.
  const poly = dp(pts, Math.max(6, 0.06 * size));
  if (poly.length === 3 || poly.length === 4) {
    const a = poly[0], b = poly[1], t0 = poly[poly.length - 2], t1 = poly[poly.length - 1];
    const shaft = dist(a, b), tail = dist(t0, t1);
    // A visibly curved shaft is kept as the hand-drawn path (see 6b) instead of being straightened.
    const be = poly.length === 4 ? t0 : b; // end of the body: the whole path before the hook
    const bi = pts.findIndex((q) => q.x === be.x && q.y === be.y);
    const curved = bi > 0 && pts.slice(0, bi + 1).some((q) => segDist(q, a, be) > 0.1 * dist(a, be));
    if (!curved && shaft > 2.2 * tail && shaft > 30 && cosBetween(a, b, t0, t1) < -0.2) {
      let x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y;
      if (opts.snap) { x1 = snapTo(x1, GRID); y1 = snapTo(y1, GRID); x2 = snapTo(x2, GRID); y2 = snapTo(y2, GRID); }
      const r = (v: number) => Math.round(v);
      return { gesture: 'arrow', label: 'Cleaned → arrow', shape: { k: 'line', x1: r(x1), y1: r(y1), x2: r(x2), y2: r(y2), arrow: true } };
    }
  }

  const closed = chord < 0.4 * size;

  // 3b. A curvy path that ends in a short hook back: keep the hand-drawn path and give it an arrowhead.
  // (Checked before the circle test, which would otherwise swallow a shallow arc with a hook.)
  const hook = closed ? -1 : findHook(pts, -0.72);
  if (hook > 4) {
    const tip = pts[hook];
    let x1 = first.x, y1 = first.y, x2 = tip.x, y2 = tip.y;
    if (opts.snap) { x1 = snapTo(x1, GRID); y1 = snapTo(y1, GRID); x2 = snapTo(x2, GRID); y2 = snapTo(y2, GRID); }
    const r = (v: number) => Math.round(v);
    return { gesture: 'arrow', label: 'Cleaned → arrow', shape: { k: 'line', x1: r(x1), y1: r(y1), x2: r(x2), y2: r(y2), arrow: true } };
  }

  // 4/5. An open stroke that is not a line or an arrow is a box or a circle, and the way it starts says which:
  // down and across (an L, a corner, even a curved one) is a box; up and around (a smooth arc) is a circle.
  if (!closed && size >= 24) {
    const cut = Math.min(40, 0.25 * len);
    let acc = 0, k0 = 1;
    while (k0 < pts.length - 1 && acc < cut) { acc += dist(pts[k0], pts[k0 - 1]); k0++; }
    const startUp = pts[k0].y - first.y < -0.1 * Math.abs(pts[k0].x - first.x);
    const c = startUp ? kasa(pts) : null;
    if (c && c.r >= 8 && c.r <= 1.5 * size && maxTurn(poly) < 1.4) {
      let err = 0;
      for (const p of pts) err += Math.abs(Math.hypot(p.x - c.cx, p.y - c.cy) - c.r);
      err /= pts.length * c.r;
      let sweep = 0, prev = Math.atan2(pts[0].y - c.cy, pts[0].x - c.cx);
      for (let i = 1; i < pts.length; i++) {
        const cur = Math.atan2(pts[i].y - c.cy, pts[i].x - c.cx);
        let d = cur - prev;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        sweep += d; prev = cur;
      }
      if (err < 0.2 && Math.abs(sweep) > 0.9) {
        return { gesture: 'circle', label: 'Cleaned → circle', shape: boxShape('ell', { x: c.cx - c.r, y: c.cy - c.r, w: 2 * c.r, h: 2 * c.r }, opts.snap) };
      }
    }
    // Two or more sides' worth of a rectangle, however rough: a box around where the stroke went.
    if (bb.w >= 14 && bb.h >= 14 && (!startUp || maxTurn(poly) >= 1.4) && poly.length <= 6 && bendsOneWay(poly) && chord > 0.3 * size && Math.min(bb.w, bb.h) >= 0.15 * size) {
      return { gesture: 'corner', label: 'Cleaned → box', shape: boxShape('rect', bb, opts.snap) };
    }
  }

  // 6. Closed loop: box / ellipse by filled-area ratio.
  if (closed && bb.w > 12 && bb.h > 12) {
    const ratio = shoelace(pts) / (bb.w * bb.h);
    const sharp = poly.filter((_, i) => i > 0 && i < poly.length - 1 && turnAt(poly, i) > 1.25).length;
    // Boxiness: how much of the stroke runs along long, level or upright sides (a circle only does for a short while, at four spots).
    let axis = 0, tot = 0;
    for (let i = 1; i < poly.length; i++) {
      const l = dist(poly[i - 1], poly[i]), ang = (Math.atan2(Math.abs(poly[i].y - poly[i - 1].y), Math.abs(poly[i].x - poly[i - 1].x)) * 180) / Math.PI;
      tot += l;
      if ((ang < 18 || ang > 72) && l > 0.3 * Math.min(bb.w, bb.h)) axis += l;
    }
    const hug = tot ? axis / tot : 0;
    if (ratio > 0.84 || (sharp >= 3 && ratio > 0.68) || (hug > 0.7 && ratio > 0.6)) return { gesture: 'box', label: 'Cleaned → box', shape: boxShape('rect', bb, opts.snap) };
    if (ratio > 0.5) {
      // A loop that is nearly as wide as tall is meant to be a circle; snapping each edge separately would squash it.
      if (Math.abs(bb.w - bb.h) <= 0.25 * size) {
        const d = (bb.w + bb.h) / 2, cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
        const sb = opts.snap ? snapTo(d, GRID) : d;
        const dd = Math.max(GRID, sb);
        return { gesture: 'ellipse', label: 'Cleaned → circle', shape: boxShape('ell', { x: cx - dd / 2, y: cy - dd / 2, w: dd, h: dd }, false) };
      }
      return { gesture: 'ellipse', label: 'Cleaned → ellipse', shape: boxShape('ell', bb, opts.snap) };
    }
  }

  // 7. Nothing fits neatly. Sketches are rare (that is what Sketch mode and Alt+drag are for), so guess what was meant:
  // a closed blob is a shape, an open wander is a line from where it started to where it ended.
  if (closed && bb.w > 12 && bb.h > 12) {
    return shoelace(pts) / (bb.w * bb.h) > 0.4
      ? { gesture: 'ellipse', label: 'Cleaned → ellipse', shape: boxShape('ell', bb, opts.snap) }
      : { gesture: 'box', label: 'Cleaned → box', shape: boxShape('rect', bb, opts.snap) };
  }
  if (chord >= 20) {
    let x1 = first.x, y1 = first.y, x2 = last.x, y2 = last.y;
    const ang = (Math.atan2(Math.abs(y2 - y1), Math.abs(x2 - x1)) * 180) / Math.PI;
    if (ang <= 12) { const y = (y1 + y2) / 2; y1 = y2 = y; } else if (ang >= 78) { const x = (x1 + x2) / 2; x1 = x2 = x; }
    if (opts.snap) { x1 = snapTo(x1, GRID); y1 = snapTo(y1, GRID); x2 = snapTo(x2, GRID); y2 = snapTo(y2, GRID); }
    const r = (v: number) => Math.round(v);
    return { gesture: 'line', label: 'Cleaned → line', shape: { k: 'line', x1: r(x1), y1: r(y1), x2: r(x2), y2: r(y2) } };
  }
  const simp = dp(pts, 2.5);
  return { gesture: 'free', label: 'Kept as sketch', shape: { k: 'free', pts: simp.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]) } };
}
