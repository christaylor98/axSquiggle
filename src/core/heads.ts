import type { Shape } from './types';

type Line = Extract<Shape, { k: 'line' }>;
export interface HeadEnd { prop: 'tail' | 'arrow'; glyph: string; word: string; on: boolean }

/**
 * The two ends of a line by where they lie on the page (left then right for a level line, top then bottom for an upright one),
 * each with whether it has an arrowhead. `tail` is the head at the line's start, `arrow` the one at its end.
 */
export function headEnds(s: Line): HeadEnd[] {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, horiz = Math.abs(dx) >= Math.abs(dy);
  const startFirst = horiz ? dx >= 0 : dy >= 0;
  const start: HeadEnd = { prop: 'tail', glyph: '', word: '', on: !!s.tail }, end: HeadEnd = { prop: 'arrow', glyph: '', word: '', on: !!s.arrow };
  const [first, second] = startFirst ? [start, end] : [end, start];
  [first.glyph, second.glyph] = horiz ? ['◂', '▸'] : ['▴', '▾'];
  [first.word, second.word] = horiz ? ['left', 'right'] : ['top', 'bottom'];
  return [first, second];
}

/** Put an arrowhead on, or take it off, at one end. Taking off the last head leaves a connector (still attached and routed), not a divider. */
export function setHead(s: Line, prop: 'tail' | 'arrow', on: boolean): void {
  if (on) s[prop] = true; else delete s[prop];
  if (!s.arrow && !s.tail) s.conn = true; else delete s.conn;
}
