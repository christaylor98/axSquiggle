import { endsOf } from './connect';
import { bounds } from './geom';
import { ALIASES, KEYWORDS } from './layout';
import { classify, moveGroup, shift } from './semantics';
import { cloneShape, type Frame, type Part, type Shape } from './types';

/** Names a part may not take: they already mean something to the stamp command and the outline. */
const RESERVED = new Set([...Object.keys(KEYWORDS), ...Object.keys(ALIASES)]);

/** Normalise a typed name to a slug (lowercase letters, digits, - and _); null if unusable or reserved. */
export function partName(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/[\s]+/g, '-').replace(/[^a-z0-9_-]/g, '').replace(/^[-_]+/, '').slice(0, 24);
  return s && !RESERVED.has(s) ? s : null;
}

/** The shapes that travel with these elements (labels, container contents, arrows wired between them). */
function groupOf(frame: Frame, idxs: number[]): Set<number> {
  const c = classify(frame), group = new Set<number>();
  for (const i of idxs) for (const j of moveGroup(frame, c, i)) group.add(j);
  frame.shapes.forEach((s, i) => {
    if (s.k !== 'line' || !(s.arrow || s.tail || s.conn) || group.has(i)) return;
    const [a, b] = endsOf(frame, i);
    if (a !== null && b !== null && group.has(a) && group.has(b)) group.add(i);
  });
  return group;
}

/** Top-left corner of what a copy of these elements would contain (where a paste puts it back). */
export function selectionOrigin(frame: Frame, idxs: number[]): { x: number; y: number } | null {
  const g = groupOf(frame, idxs);
  if (!g.size) return null;
  const bs = [...g].map((i) => bounds(frame.shapes[i]));
  return { x: Math.min(...bs.map((b) => b.x)), y: Math.min(...bs.map((b) => b.y)) };
}

/**
 * Capture the selected elements (with their labels, container contents and the arrows wired between them)
 * as a part positioned relative to its own top-left. Links to frames are dropped: they belong to one board.
 */
export function makePart(frame: Frame, idxs: number[]): Part | null {
  const group = groupOf(frame, idxs);
  if (!group.size) return null;
  const boxes = [...group].map((i) => bounds(frame.shapes[i]));
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  const w = Math.max(...boxes.map((b) => b.x + b.w)) - x, h = Math.max(...boxes.map((b) => b.y + b.h)) - y;
  const tmp: Frame = { ...frame, shapes: [...group].sort((a, b) => a - b).map((i) => cloneShape(frame.shapes[i])), notes: [] };
  tmp.shapes.forEach((s, j) => { shift(tmp, j, -x, -y); delete (s as { link?: string }).link; });
  return { w: Math.round(w), h: Math.round(h), shapes: tmp.shapes.map(roundShape) };
}

function roundShape(s: Shape): Shape {
  const r = (v: number) => Math.round(v * 10) / 10;
  if (s.k === 'line') return { ...s, x1: r(s.x1), y1: r(s.y1), x2: r(s.x2), y2: r(s.y2), ...(s.via ? { via: s.via.map(([a, b]) => [r(a), r(b)]) } : {}) };
  if (s.k === 'free') return { ...s, pts: s.pts.map(([a, b]) => [r(a), r(b)]) };
  if (s.k === 'text') return { ...s, x: r(s.x), y: r(s.y) };
  return { ...s, x: r(s.x), y: r(s.y), w: r(s.w), h: r(s.h) };
}
