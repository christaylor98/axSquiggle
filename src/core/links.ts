import { toLocal } from './rotate';
import { bounds, area } from './geom';
import { classify } from './semantics';
import type { Board, Frame, Pt, Shape } from './types';

/** Elements that can lead somewhere (lines and sketches are decoration). */
export const linkable = (s: Shape): s is Extract<Shape, { link?: string }> =>
  s.k === 'rect' || s.k === 'ell' || s.k === 'img' || s.k === 'tlines' || s.k === 'text';

/** Point every linkable shape in `idxs` at frame `id` (or clear the link when id is null). Returns how many changed. */
export function setLinks(frame: Frame, idxs: number[], id: string | null): number {
  let n = 0;
  for (const i of idxs) {
    const s = frame.shapes[i];
    if (!s || !linkable(s)) continue;
    if (id) s.link = id; else delete s.link;
    n++;
  }
  return n;
}

/**
 * Turn the "@target" placeholders the outline syntax leaves ("button Sign in -> 2") into frame ids.
 * A target is a 1-based frame number or part of a caption. Returns the targets that matched nothing (their links are dropped).
 */
export function resolveLinks(frame: Frame, frames: Frame[]): string[] {
  const bad: string[] = [];
  for (const s of frame.shapes) {
    if (!linkable(s) || !s.link?.startsWith('@')) continue;
    const raw = s.link.slice(1).trim();
    const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
    const hit = Number.isFinite(n) ? frames[n - 1] : frames.find((f) => f.caption.toLowerCase().includes(raw.toLowerCase()) && raw);
    if (hit) s.link = hit.id; else { delete s.link; bad.push(raw); }
  }
  return bad;
}

/** Remove every link that points at a frame (used when that frame is deleted). */
export function dropLinksTo(b: Board, id: string): void {
  for (const f of b.frames) for (const s of f.shapes) if (linkable(s) && s.link === id) delete s.link;
}

export interface LinkInfo { from: number; idx: number; role: string; label: string; to: number | null; toId: string }

/** Every link on the board with the frame it comes from and goes to (to = null if the target no longer exists). */
export function linksOf(b: Board): LinkInfo[] {
  const out: LinkInfo[] = [];
  b.frames.forEach((f, fi) => {
    const c = classify(f);
    f.shapes.forEach((s, i) => {
      if (!linkable(s) || !s.link) return;
      const el = c.byIndex.get(i);
      const to = b.frames.findIndex((g) => g.id === s.link);
      out.push({ from: fi, idx: i, role: el?.role ?? 'Text', label: el?.label ?? '', to: to >= 0 ? to : null, toId: s.link });
    });
  });
  return out;
}

/** Topmost-smallest linked shape under a point (what a click-through would follow), or null. */
export function linkAt(f: Frame, p: Pt, tol = 4): number | null {
  let best: number | null = null, bestA = Infinity;
  f.shapes.forEach((s, i) => {
    if (!linkable(s) || !s.link) return;
    const b = bounds(s), q = toLocal(s, p);
    if (q.x < b.x - tol || q.x > b.x + b.w + tol || q.y < b.y - tol || q.y > b.y + b.h + tol) return;
    const a = Math.max(1, area(b));
    if (a <= bestA) { best = i; bestA = a; }
  });
  return best;
}
