/** One row of the shortcut palette: an action (with its key), a "/" stamp, or one of the board's saved parts. */
export interface PalItem {
  kind: 'action' | 'stamp' | 'part';
  key?: string;
  /** What is shown and matched: "Flow" for an action, "/radio" for a stamp or part. */
  label: string;
  hint: string;
  /** Short names for a stamp (/rb for /radio). */
  also?: string[];
}

/**
 * The rows that match what was typed in the palette's search box, best first.
 *   ""         everything
 *   "/ra"      only "/" commands (stamps and parts), name before short name before description
 *   "grid"     any row whose label or description contains it, label matches first
 */
export function filterItems<T extends PalItem>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const slash = q.startsWith('/');
  const pool = slash ? items.filter((i) => i.kind !== 'action') : items;
  const t = slash ? q.slice(1) : q;
  const rank = (i: PalItem): number => {
    const name = i.label.replace(/^\//, '').toLowerCase(), also = (i.also ?? []).map((a) => a.toLowerCase());
    if (name.startsWith(t)) return 0;
    if (also.some((a) => a.startsWith(t))) return 1;
    if (name.includes(t) || also.some((a) => a.includes(t))) return 2;
    if (t.length >= 3 && i.hint.toLowerCase().includes(t)) return 3;   // descriptions only count once there is enough to match on
    return 4;
  };
  return pool.map((i, n) => ({ i, r: t ? rank(i) : 0, n })).filter((x) => x.r < 4).sort((a, b) => a.r - b.r || a.n - b.n).map((x) => x.i);
}
