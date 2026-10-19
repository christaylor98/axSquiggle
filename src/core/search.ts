import { classify } from './semantics';
import type { Board } from './types';

export interface Hit {
  frame: number;
  /** Shape to select, or null for a caption / note match (the frame itself). */
  idx: number | null;
  kind: 'element' | 'caption' | 'note';
  role: string;
  text: string;
}

/**
 * Find a query across every frame: element labels and paragraph copy, element kinds ("button" lists the buttons),
 * frame captions and review notes. Case-insensitive; every word must match (in any order).
 */
export function searchBoard(b: Board, query: string, limit = 60): Hit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const all = (hay: string) => words.every((w) => hay.includes(w));
  const hits: Hit[] = [];
  b.frames.forEach((f, fi) => {
    if (f.caption && all(f.caption.toLowerCase())) hits.push({ frame: fi, idx: null, kind: 'caption', role: 'Caption', text: f.caption });
    for (const e of classify(f).els) {
      if (all(`${e.role} ${e.label} ${e.hint}`.toLowerCase())) hits.push({ frame: fi, idx: e.i, kind: 'element', role: e.role, text: e.hint ? `${e.label} (“${e.hint}”)` : e.label });
    }
    for (const n of f.notes) if (all(n.text.toLowerCase())) hits.push({ frame: fi, idx: null, kind: 'note', role: 'Note', text: n.text });
  });
  return hits.slice(0, limit);
}
