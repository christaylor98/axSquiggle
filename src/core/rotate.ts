import { bounds, center } from './geom';
import type { Frame, Pt, Shape } from './types';

/** Boxes and text turn about their centre (`rot`, degrees clockwise); lines and sketches just move their points. */
export const rotOf = (s: Shape): number => (s.k === 'rect' || s.k === 'ell' || s.k === 'img' || s.k === 'tlines' || s.k === 'text' ? s.rot ?? 0 : 0);

const RAD = Math.PI / 180;
export function rotatePt(p: Pt, c: Pt, deg: number): Pt {
  const a = deg * RAD, cs = Math.cos(a), sn = Math.sin(a), dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cs - dy * sn, y: c.y + dx * sn + dy * cs };
}

/** A point in the frame, expressed in the shape's own (unturned) coordinates: for hit tests against its box. */
export function toLocal(s: Shape, p: Pt): Pt {
  const r = rotOf(s);
  return r ? rotatePt(p, center(bounds(s)), -r) : p;
}

/** Click to every `step` degrees: within `tol` of one it lands exactly, otherwise the angle is free. */
export function snapAngle(deg: number, step = 45, tol = 11): number {
  const n = Math.round(deg / step) * step;
  return Math.abs(deg - n) <= tol ? n : deg;
}

const norm = (d: number) => { let r = d % 360; if (r > 180) r -= 360; if (r <= -180) r += 360; return Math.round(r * 100) / 100; };

/** Turn these shapes together by `deg` (clockwise) about `c`. Each box keeps its own turn plus the group's. */
export function rotateShapes(f: Frame, idxs: number[], c: Pt, deg: number): void {
  for (const i of idxs) {
    const s = f.shapes[i];
    if (!s) continue;
    if (s.k === 'line') {
      const a = rotatePt({ x: s.x1, y: s.y1 }, c, deg), b = rotatePt({ x: s.x2, y: s.y2 }, c, deg);
      s.x1 = Math.round(a.x); s.y1 = Math.round(a.y); s.x2 = Math.round(b.x); s.y2 = Math.round(b.y);
      if (s.via) s.via = s.via.map(([x, y]) => { const q = rotatePt({ x, y }, c, deg); return [Math.round(q.x), Math.round(q.y)]; });
    } else if (s.k === 'free') {
      s.pts = s.pts.map(([x, y]) => { const q = rotatePt({ x, y }, c, deg); return [Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10]; });
    } else {
      const b = bounds(s), mid = rotatePt(center(b), c, deg);
      if (s.k === 'text') { s.x = Math.round(mid.x - b.w / 2); s.y = Math.round(mid.y - b.h / 2 + (s.y - b.y)); }
      else { s.x = Math.round(mid.x - s.w / 2); s.y = Math.round(mid.y - s.h / 2); }
      const r = norm((s.rot ?? 0) + deg);
      if (r) s.rot = r; else delete s.rot;
    }
  }
}

/** Centre of the box that holds all of these shapes (unturned), the pivot for turning them as one. */
export function groupCenter(f: Frame, idxs: number[]): Pt {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of idxs) { const b = bounds(f.shapes[i]); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}
