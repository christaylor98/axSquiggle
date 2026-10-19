import { bounds, center, contains, linePts, type Box } from './geom';
import { rotatePt, rotOf } from './rotate';
import { frameSize, type Frame, type Pt, type Shape } from './types';

type LineShape = Extract<Shape, { k: 'line' }>;

/** Shapes an arrow can attach to or must flow around. */
const solid = (s: Shape) => s.k === 'rect' || s.k === 'ell' || s.k === 'img' || s.k === 'tlines' || s.k === 'text';

const GAP = 26;      // arrows leave and enter a shape square-on for this far, so the head sits on a straight run
const MARGIN = 10;   // clearance kept around items the route flows past
const TURN = 40;     // cost of a bend, so routes prefer few corners
export const ATTACH_NEAR = 56;

/** The box a turned shape is measured by: a quarter turn just swaps its sides; any other turn leaves `rot` to be applied about the centre. */
function frameOf(s: Shape): { b: Box; rot: number } {
  const b = bounds(s), r = rotOf(s), q = ((r % 180) + 180) % 180;
  if (q === 0) return { b, rot: 0 };
  if (q === 90) { const c = center(b); return { b: { x: c.x - b.h / 2, y: c.y - b.w / 2, w: b.h, h: b.w }, rot: 0 }; }
  return { b, rot: r };
}
/** What a shape fills on the page (the box round its turned outline), for things that must flow past it. */
function worldBox(s: Shape): Box {
  const { b, rot } = frameOf(s);
  if (!rot) return b;
  const c = center(b), ps = [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x, y: b.y + b.h }, { x: b.x + b.w, y: b.y + b.h }].map((q) => rotatePt(q, c, rot));
  const x0 = Math.min(...ps.map((q) => q.x)), y0 = Math.min(...ps.map((q) => q.y));
  return { x: x0, y: y0, w: Math.max(...ps.map((q) => q.x)) - x0, h: Math.max(...ps.map((q) => q.y)) - y0 };
}

/** Distance from p to the shape's box: outside distance, or (inside) distance to the nearest edge. */
function edgeDist(p: Pt, b: Box): number {
  const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w)), dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h));
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
  return Math.min(p.x - b.x, b.x + b.w - p.x, p.y - b.y, b.y + b.h - p.y);
}

/** The shape nearest to a point (by distance to its outline), or null when nothing is within `near`. */
export function nearestTarget(f: Frame, p0: Pt, near = ATTACH_NEAR, skip: number[] = [], inside = false): number | null {
  let best: number | null = null, bd = near;
  f.shapes.forEach((s, i) => {
    if (!solid(s) || skip.includes(i)) return;
    let p = p0;
    const b = bounds(s), r = rotOf(s);
    if (r) p = rotatePt(p, center(b), -r);   // measure in the shape's own (unturned) frame
    // A circle's outline is well inside its box at the diagonals, so measure to the curve or an arrow on the angle would count as detached.
    const d = s.k === 'ell' ? Math.abs(Math.hypot((p.x - b.x - b.w / 2) / (b.w / 2 || 1), (p.y - b.y - b.h / 2) / (b.h / 2 || 1)) - 1) * Math.min(b.w, b.h) / 2 : edgeDist(p, b);
    if (d < bd) { bd = d; best = i; }
  });
  if (best === null && inside) { // an end dropped in the middle of something still means that thing: the smallest one holding it
    let ba = Infinity;
    f.shapes.forEach((s, i) => {
      if (!solid(s) || skip.includes(i)) return;
      const b = bounds(s), a = b.w * b.h, p = rotOf(s) ? rotatePt(p0, center(b), -rotOf(s)) : p0;
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h && a < ba) { ba = a; best = i; }
    });
  }
  return best;
}

const SLOT = 24;   // spacing of attachment points along a side: bigger shapes get more of them
const INSET = 10;  // nearest a point sits to a corner

/** Attachment points along one side (from lo to hi): one at the middle of a small side, more as it grows. */
export function slots(lo: number, hi: number): number[] {
  const len = hi - lo;
  if (len < 2 * INSET + SLOT) return [lo + len / 2];
  const n = Math.floor((len - 2 * INSET) / SLOT) + 1;
  return Array.from({ length: n }, (_, k) => lo + INSET + (k * (len - 2 * INSET)) / (n - 1));
}

const snap = (vals: number[], v: number) => vals.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best));
/** Like snap, but an arrow keeps the slot it already had (`held`, where it sat along the side) until another is clearly nearer: no flicker between two slots while a shape is dragged. */
const snapHeld = (vals: number[], v: number, held?: number) => {
  const nearest = snap(vals, v);
  if (held === undefined) return nearest;
  const keep = snap(vals, held);
  return Math.abs(keep - v) <= Math.abs(nearest - v) + SLOT * 0.5 ? keep : nearest;
};
/** Where each arrow end last sat on its shape (side and distance along it), per frame: the memory behind snapHeld. */
const STICK = 12;   // an arrow prefers the side it already leaves by: a nearly-as-good side must beat it by this much to take over
const lastSlot = new Map<string, { side: Side; off: number }>();

type Side = 'r' | 'l' | 'b' | 't' | 'o'; // 'o' = outward from the centre (ellipses)
const SIDES: Side[] = ['r', 'l', 'b', 't'];
const RADIAL: Side[] = ['o'];
const NORMAL: Record<Exclude<Side, 'o'>, Pt> = { r: { x: 1, y: 0 }, l: { x: -1, y: 0 }, b: { x: 0, y: 1 }, t: { x: 0, y: -1 } };

/** The side of `b` that faces `toward`. */
function facing(b: Box, toward: Pt): Side {
  const dx = toward.x - (b.x + b.w / 2), dy = toward.y - (b.y + b.h / 2);
  if (Math.abs(dx) / Math.max(1, b.w / 2) >= Math.abs(dy) / Math.max(1, b.h / 2)) return dx >= 0 ? 'r' : 'l';
  return dy >= 0 ? 'b' : 't';
}

/** The attachment point on one side of `b` (the slot nearest `toward`; on the curve for an ellipse), plus the outward normal. */
function onSide(b: Box, side: Side, toward: Pt, ell: boolean, rot = 0, held?: number): { p: Pt; n: Pt } {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, ctr = { x: cx, y: cy };
  if (side === 'o') { // a ray from the centre toward the other end, out through the curve (or the turned outline)
    const t = rot ? rotatePt(toward, ctr, -rot) : toward;
    const dx = t.x - cx, dy = t.y - cy, len = Math.hypot(dx, dy) || 1;
    const k = ell ? 1 / Math.sqrt((dx / (b.w / 2)) ** 2 + (dy / (b.h / 2)) ** 2 || 1) : 1 / (Math.max(Math.abs(dx) / (b.w / 2), Math.abs(dy) / (b.h / 2)) || 1);
    const p = { x: cx + dx * k, y: cy + dy * k }, n = { x: cx + dx / len, y: cy + dy / len };
    if (!rot) return { p, n: { x: dx / len, y: dy / len } };
    const pw = rotatePt(p, ctr, rot), nw = rotatePt(n, ctr, rot);
    return { p: pw, n: { x: nw.x - cx, y: nw.y - cy } };
  }
  const n = NORMAL[side as Exclude<Side, 'o'>];
  if (side === 'r' || side === 'l') {
    const y = snapHeld(slots(b.y, b.y + b.h), toward.y, held === undefined ? undefined : b.y + held);
    const ex = ell ? (b.w / 2) * Math.sqrt(Math.max(0, 1 - ((y - cy) / (b.h / 2)) ** 2)) : b.w / 2; // an ellipse's edge, not its box
    return { p: { x: cx + n.x * ex, y }, n };
  }
  const x = snapHeld(slots(b.x, b.x + b.w), toward.x, held === undefined ? undefined : b.x + held);
  const ey = ell ? (b.h / 2) * Math.sqrt(Math.max(0, 1 - ((x - cx) / (b.w / 2)) ** 2)) : b.h / 2;
  return { p: { x, y: cy + n.y * ey }, n };
}

/** The attachment point on the side of `b` that faces `toward`. */
export function attachPoint(b: Box, toward: Pt, radial = false, ell = radial, rot = 0): { p: Pt; n: Pt } {
  return onSide(b, radial ? 'o' : facing(b, toward), toward, ell, rot);
}

const inflate = (b: Box, m: number): Box => ({ x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m });
const inside = (p: Pt, b: Box) => p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h;

function segBlocked(a: Pt, c: Pt, obs: Box[]): boolean {
  // Sample densely: segments are short and boxes are large, so this is exact enough and simple.
  const n = Math.max(2, Math.ceil(Math.hypot(c.x - a.x, c.y - a.y) / 4));
  for (let i = 0; i <= n; i++) {
    const p = { x: a.x + ((c.x - a.x) * i) / n, y: a.y + ((c.y - a.y) * i) / n };
    if (obs.some((o) => inside(p, o))) return true;
  }
  return false;
}

/** Orthogonal route from s to e around obstacles (Dijkstra over the grid of obstacle-edge coordinates); null if none. */
function route(s: Pt, e: Pt, obs: Box[], W: number, H: number): Pt[] | null {
  const xsSet = new Set<number>([s.x, e.x, 4, W - 4]), ysSet = new Set<number>([s.y, e.y, 4, H - 4]);
  for (const o of obs) { xsSet.add(o.x); xsSet.add(o.x + o.w); ysSet.add(o.y); ysSet.add(o.y + o.h); }
  const xs = [...xsSet].filter((v) => v >= 0 && v <= W).sort((a, b) => a - b);
  const ys = [...ysSet].filter((v) => v >= 0 && v <= H).sort((a, b) => a - b);
  const nx = xs.length, ny = ys.length;
  const at = (i: number, j: number): Pt => ({ x: xs[i], y: ys[j] });
  const free = (i: number, j: number) => !obs.some((o) => inside(at(i, j), o));
  const si = xs.indexOf(s.x), sj = ys.indexOf(s.y), ei = xs.indexOf(e.x), ej = ys.indexOf(e.y);
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const key = (i: number, j: number, d: number) => (j * nx + i) * 5 + d;
  const dist = new Map<number, number>(), prev = new Map<number, number>();
  const open: [number, number, number, number][] = [[0, si, sj, 4]]; // cost, i, j, dir (4 = none)
  dist.set(key(si, sj, 4), 0);
  let goal = -1;
  while (open.length) {
    open.sort((a, b) => a[0] - b[0]);
    const [c, i, j, d] = open.shift()!;
    if (c > (dist.get(key(i, j, d)) ?? Infinity)) continue;
    if (i === ei && j === ej) { goal = key(i, j, d); break; }
    for (let nd = 0; nd < 4; nd++) {
      const ni = i + DIRS[nd][0], nj = j + DIRS[nd][1];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny || !free(ni, nj)) continue;
      if (segBlocked(at(i, j), at(ni, nj), obs)) continue;
      const len = Math.hypot(xs[ni] - xs[i], ys[nj] - ys[j]);
      const nc = c + len + (d !== 4 && d !== nd ? TURN : 0);
      const k = key(ni, nj, nd);
      if (nc < (dist.get(k) ?? Infinity)) { dist.set(k, nc); prev.set(k, key(i, j, d)); open.push([nc, ni, nj, nd]); }
    }
  }
  if (goal < 0) return null;
  const pts: Pt[] = [];
  for (let k: number | undefined = goal; k !== undefined; k = prev.get(k)) {
    const cell = Math.floor(k / 5);
    pts.push(at(cell % nx, Math.floor(cell / nx)));
  }
  pts.reverse();
  return pts.filter((p, i) => i === 0 || i === pts.length - 1 || !((pts[i - 1].x === p.x && p.x === pts[i + 1].x) || (pts[i - 1].y === p.y && p.y === pts[i + 1].y)));
}

const bends = (pts: Pt[]) => pts.reduce((n, p, i) => n + (i > 0 && i < pts.length - 1 && (p.x - pts[i - 1].x) * (pts[i + 1].y - p.y) !== (p.y - pts[i - 1].y) * (pts[i + 1].x - p.x) ? 1 : 0), 0);
const pathLen = (pts: Pt[]) => pts.reduce((n, p, i) => n + (i ? Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;

/** Cheap guess at how awkward a pair of sides is (stubs out of each, bends needed), to pick which few to route for real. */
function guess(s0: Pt, n0: Pt, e0: Pt, n1: Pt): number {
  const d1 = n0, d2 = { x: -n1.x, y: -n1.y }, dx = e0.x - s0.x, dy = e0.y - s0.y, dl = { x: dx, y: dy };
  const par = dot(d1, d2);
  let b: number;
  if (par === 1) b = dot(dl, d1) > 0 ? (dx === 0 || dy === 0 ? 0 : 2) : 4;
  else if (par === -1) b = 2 + (dot(dl, d1) > 0 ? 0 : 2);
  else b = dot(dl, d1) > 0 && dot(dl, d2) > 0 ? 1 : 3;
  return Math.abs(dx) + Math.abs(dy) + b * TURN;
}

/**
 * Attach an arrow to the shapes at its ends (either may be null = free end) and route it around everything else.
 * Every side of each shape is a candidate; the pair that gives the neatest path wins (fewest bends, shortest), which is
 * often not the side that faces the other shape. Straight when the way is clear.
 */

const LOOP = 30;   // how far a loop back into the same shape stands off from it
/** An arrow from a shape back into itself: out of one side, round the corner, into the adjacent side, all outside the shape. */
function selfLoop(b: Box, ell: boolean, p1: Pt, p2: Pt, obs: Box[]): { start: Pt; end: Pt; via: Pt[] } {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, ax = b.w / 2, ay = b.h / 2;
  const dX = Math.min(34, Math.max(10, b.w * 0.3)), dY = Math.min(34, Math.max(10, b.h * 0.3));
  const offX = ell ? ax * 0.42 : ax - dX, offY = ell ? ay * 0.42 : ay - dY;
  // a point on the right/left side (sy = which half) or the top/bottom side (sx = which half), and its outward normal
  const sideV = (sx: number, sy: number) => { const y = cy + sy * offY, x = cx + sx * (ell ? ax * Math.sqrt(Math.max(0, 1 - (offY / ay) ** 2)) : ax); return { p: { x, y }, n: { x: sx, y: 0 } }; };
  const sideH = (sx: number, sy: number) => { const x = cx + sx * offX, y = cy + sy * (ell ? ay * Math.sqrt(Math.max(0, 1 - (offX / ax) ** 2)) : ay); return { p: { x, y }, n: { x: 0, y: sy } }; };
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const corners = [{ sx: 1, sy: -1 }, { sx: 1, sy: 1 }, { sx: -1, sy: 1 }, { sx: -1, sy: -1 }]   // top-right first: the usual place for a loop
    .map((k, i) => ({ ...k, d: Math.hypot(mid.x - (cx + k.sx * ax), mid.y - (cy + k.sy * ay)) + i }))
    .sort((u, v) => u.d - v.d);
  let first: { start: Pt; end: Pt; via: Pt[] } | null = null;
  for (const k of corners) {
    const V = sideV(k.sx, k.sy), H = sideH(k.sx, k.sy);
    // leave by whichever of the two sides the drawn start is nearer to
    const startV = Math.hypot(p1.x - V.p.x, p1.y - V.p.y) <= Math.hypot(p1.x - H.p.x, p1.y - H.p.y);
    const A = startV ? V : H, B = startV ? H : V;
    const oa = { x: A.p.x + A.n.x * LOOP, y: A.p.y + A.n.y * LOOP }, ob = { x: B.p.x + B.n.x * LOOP, y: B.p.y + B.n.y * LOOP };
    const corner = { x: A.n.x !== 0 ? oa.x : ob.x, y: A.n.y !== 0 ? oa.y : ob.y };
    const r = { start: A.p, end: B.p, via: [oa, corner, ob] };
    const pts = [r.start, ...r.via, r.end];
    first ??= r;
    if (!pts.some((q, i) => i > 0 && segBlocked(pts[i - 1], q, obs))) return r;
  }
  return first!;
}

export function connect(f: Frame, idx: number, a: number | null, b: number | null): void {
  const ln = f.shapes[idx] as LineShape;
  if (!ln || ln.k !== 'line') return;
  const p1: Pt = { x: ln.x1, y: ln.y1 }, p2: Pt = { x: ln.x2, y: ln.y2 };
  const fa0 = a !== null ? frameOf(f.shapes[a]) : null, fb0 = b !== null ? frameOf(f.shapes[b]) : null;
  const ba = fa0 ? fa0.b : null, bb = fb0 ? fb0.b : null, ra = fa0?.rot ?? 0, rb = fb0?.rot ?? 0;
  const la = a !== null && f.shapes[a].k === 'ell', lb = b !== null && f.shapes[b].k === 'ell';   // true ellipses
  const ea = la || ra !== 0, eb = lb || rb !== 0;   // ends that leave on a ray from the centre: circles, and anything turned off the square
  const c = (x: Box) => ({ x: x.x + x.w / 2, y: x.y + x.h / 2 });

  // Obstacles: every solid thing except the two targets, whatever contains them, and whatever they contain.
  const { w: W, h: H } = frameSize(f);
  const tb = [a, b].filter((x): x is number => x !== null).map((i) => worldBox(f.shapes[i]));
  const obs: Box[] = [];
  f.shapes.forEach((s, i) => {
    if (i === a || i === b || !solid(s)) return;
    const sb = worldBox(s);
    if (tb.some((t) => contains(sb, t) || contains(t, sb))) return;
    obs.push(inflate(sb, MARGIN));
  });

  if (a !== null && a === b && ba) {   // back into the same shape
    const lp = selfLoop(worldBox(f.shapes[a]), la && ra === 0, p1, p2, obs);
    delete ln.via;
    ln.x1 = Math.round(lp.start.x); ln.y1 = Math.round(lp.start.y); ln.x2 = Math.round(lp.end.x); ln.y2 = Math.round(lp.end.y);
    ln.via = lp.via.map((q) => [Math.round(q.x), Math.round(q.y)]);
    return;
  }

  const keyA = `${f.id}|${idx}|a`, keyB = `${f.id}|${idx}|b`;
  const heldFor = (key: string, side: Side) => { const m = lastSlot.get(key); return m && m.side === side ? m.off : undefined; };
  type Cand = { A: { p: Pt; n: Pt } | null; B: { p: Pt; n: Pt } | null; est: number; sa: Side | null; sb: Side | null };
  const cands: Cand[] = [];
  const fa = ba && !ea ? facing(ba, bb ? c(bb) : p2) : null, fb = bb && !eb ? facing(bb, ba ? c(ba) : p1) : null;
  for (const sa of ba ? (ea ? RADIAL : SIDES) : [null]) {
    const A = ba && sa ? onSide(ba, sa, bb ? c(bb) : p2, la, ra, ra || la ? undefined : heldFor(keyA, sa)) : null;
    for (const sb of bb ? (eb ? RADIAL : SIDES) : [null]) {
      const B = bb && sb ? onSide(bb, sb, A && !ea ? A.p : ba ? c(ba) : p1, lb, rb, rb || lb ? undefined : heldFor(keyB, sb)) : null;
      const st = A ? { x: A.p.x + A.n.x * GAP, y: A.p.y + A.n.y * GAP } : p1, en = B ? { x: B.p.x + B.n.x * GAP, y: B.p.y + B.n.y * GAP } : p2;
      const n0 = A ? A.n : { x: 0, y: 0 }, n1 = B ? B.n : { x: 0, y: 0 };
      const est = A && B ? guess(st, n0, en, n1) : Math.abs(en.x - st.x) + Math.abs(en.y - st.y);
      cands.push({ A, B, sa, sb, est: est + (sa && fa && sa !== fa ? 6 : 0) + (sb && fb && sb !== fb ? 6 : 0) - (sa && lastSlot.get(keyA)?.side === sa ? STICK : 0) - (sb && lastSlot.get(keyB)?.side === sb ? STICK : 0) });
    }
  }
  // A route never cuts across the shapes it joins: their outlines are walls too (unless one holds the other).
  const own = ba && bb && (contains(ba, bb) || contains(bb, ba)) ? [] : tb.map((t) => inflate(t, 4));
  cands.sort((x, y) => x.est - y.est);

  let best: { start: Pt; end: Pt; via: Pt[]; cost: number; sa?: Side | null; sb?: Side | null } | null = null;
  for (const { A, B, sa, sb } of cands.slice(0, 4)) {
    const start = A ? A.p : p1, end = B ? B.p : p2;
    const outward = (!A || dot({ x: end.x - start.x, y: end.y - start.y }, A.n) > 0) && (!B || dot({ x: start.x - end.x, y: start.y - end.y }, B.n) > 0);
    if (outward && !segBlocked(start, end, obs)) {
      const cost = Math.hypot(end.x - start.x, end.y - start.y);
      if (!best || cost < best.cost) best = { start, end, via: [], cost, sa, sb };
      continue;
    }
    for (const gap of [GAP, 16, 8]) {
      // An angled (circle) end gets a longer run so it reads as a line on the angle, not a short stub before the first turn.
      const ga = A && A.n.x !== 0 && A.n.y !== 0 ? gap * 2.5 : gap, gb = B && B.n.x !== 0 && B.n.y !== 0 ? gap * 2.5 : gap;
      const s0 = A ? { x: start.x + A.n.x * ga, y: start.y + A.n.y * ga } : start;
      const e0 = B ? { x: end.x + B.n.x * gb, y: end.y + B.n.y * gb } : end;
      const r = route(s0, e0, [...obs, ...own], W, H);
      if (!r) continue;
      const path = [start, ...r, end];
      const cost = pathLen(path) + TURN * bends(path);
      if (!best || cost < best.cost) best = { start, end, via: r, cost, sa, sb };
      break;
    }
  }
  if (!best) { // nothing routes: fall back to the plain straight arrow between the facing sides
    const A = ba ? attachPoint(ba, bb ? c(bb) : p2, ea, la, ra) : null, B = bb ? attachPoint(bb, A && !ea ? A.p : ba ? c(ba) : p1, eb, lb, rb) : null;
    best = { start: A ? A.p : p1, end: B ? B.p : p2, via: [], cost: 0 };
  }
  // Into a circle, one straight run on the angle beats a right angle followed by a lead-in: aim from the earliest bend that can see it.
  if (eb && bb && best.via.length) {
    for (let i = 0; i < best.via.length; i++) {
      const q = onSide(bb, 'o', best.via[i], lb, rb).p;
      if (!segBlocked(best.via[i], q, obs)) { best = { ...best, via: best.via.slice(0, i + 1), end: q }; break; }
    }
  }
  if (ea && ba && best.via.length) {
    for (let j = best.via.length - 1; j >= 0; j--) {
      const q = onSide(ba, 'o', best.via[j], la, ra).p;
      if (!segBlocked(q, best.via[j], obs)) { best = { ...best, via: best.via.slice(j), start: q }; break; }
    }
  }
  // Remember where each end sat along its side, so the next call can hold on to the slot.
  const remember = (key: string, bx: Box | null, side: Side | null | undefined, p: Pt) => {
    if (!bx || !side || side === 'o') lastSlot.delete(key); else lastSlot.set(key, { side, off: side === 'l' || side === 'r' ? p.y - bx.y : p.x - bx.x });
  };
  remember(keyA, ba, best.sa, best.start); remember(keyB, bb, best.sb, best.end);
  delete ln.via;
  ln.x1 = Math.round(best.start.x); ln.y1 = Math.round(best.start.y); ln.x2 = Math.round(best.end.x); ln.y2 = Math.round(best.end.y);
  const all = [best.start, ...best.via, best.end];
  const bent = best.via.filter((p) => { const i = all.indexOf(p); return (p.x - all[i - 1].x) * (all[i + 1].y - p.y) !== (p.y - all[i - 1].y) * (all[i + 1].x - p.x); });
  const via = bent.map((p) => [Math.round(p.x), Math.round(p.y)]);
  // A waypoint that merely repeats an end is noise (free ends route from the end itself).
  if (via.length && via[0][0] === ln.x1 && via[0][1] === ln.y1) via.shift();
  if (via.length && via[via.length - 1][0] === ln.x2 && via[via.length - 1][1] === ln.y2) via.pop();
  if (via.length) ln.via = via;
}

/** Shapes at an arrow's two ends (null when an end is free). Call before moving things to remember what is attached. */
export function endsOf(f: Frame, idx: number): [number | null, number | null] {
  const ln = f.shapes[idx] as LineShape;
  const pts = linePts(ln);
  return [nearestTarget(f, pts[0], 12), nearestTarget(f, pts[pts.length - 1], 12)];
}
