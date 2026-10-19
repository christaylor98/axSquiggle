import { describe, expect, it } from 'vitest';
import { shapeSVG } from '../src/core/exporters';
import { validateShape } from '../src/core/model';
import { groupCenter, rotatePt, rotateShapes, rotOf, snapAngle, toLocal } from '../src/core/rotate';
import { linkAt } from '../src/core/links';
import { newFrame, type Shape } from '../src/core/types';

const frame = (...shapes: Shape[]) => { const f = newFrame(); f.shapes.push(...shapes); return f; };

describe('turning shapes', () => {
  it('clicks to every 45 degrees when close, and is free otherwise', () => {
    expect(snapAngle(40)).toBe(45);
    expect(snapAngle(93)).toBe(90);
    expect(snapAngle(-52)).toBe(-45);
    expect(snapAngle(63.4)).toBe(63.4);
    expect(snapAngle(180 + 5)).toBe(180);
  });

  it('turns a box about the group centre and keeps its own angle', () => {
    const f = frame({ k: 'rect', x: 0, y: 0, w: 100, h: 40 }, { k: 'rect', x: 200, y: 0, w: 100, h: 40 });
    const c = groupCenter(f, [0, 1]);
    expect(c).toEqual({ x: 150, y: 20 });
    rotateShapes(f, [0, 1], c, 90);
    const a = f.shapes[0] as { x: number; y: number; rot?: number }, b = f.shapes[1] as { x: number; y: number; rot?: number };
    expect(a.rot).toBe(90); expect(b.rot).toBe(90);
    expect(a.x + 50).toBeCloseTo(150, 0);        // box 0's centre ended up above the pivot (x), 100 up from it
    expect(a.y + 20).toBeCloseTo(20 - 100, 0);
    expect(b.y + 20).toBeCloseTo(20 + 100, 0);
    rotateShapes(f, [0, 1], c, -90);
    expect(rotOf(f.shapes[0])).toBe(0);
    expect((f.shapes[0] as { x: number }).x).toBe(0);
  });

  it('moves the points of a line and a sketch, and turns text', () => {
    const f = frame({ k: 'line', x1: 0, y1: 0, x2: 100, y2: 0, arrow: true }, { k: 'free', pts: [[0, 0], [100, 0]] }, { k: 'text', x: 0, y: 18, s: 'Hello' });
    rotateShapes(f, [0, 1, 2], { x: 50, y: 0 }, 90);
    const l = f.shapes[0] as { x1: number; y1: number; x2: number; y2: number };
    expect([l.x1, l.y1, l.x2, l.y2]).toEqual([50, -50, 50, 50]);
    expect(((f.shapes[1] as { pts: number[][] }).pts)[1]).toEqual([50, 50]);
    expect(rotOf(f.shapes[2])).toBe(90);
  });

  it('hit tests and links see the turned box, not its old one', () => {
    const box: Shape = { k: 'rect', x: 0, y: 0, w: 200, h: 20, rot: 90, link: 'f2' };
    const f = frame(box);
    // Turned 90 degrees about (100,10) it stands upright: x 90..110, y -90..110.
    expect(linkAt(f, { x: 100, y: 90 })).toBe(0);
    expect(linkAt(f, { x: 10, y: 10 })).toBeNull();
    expect(toLocal(box, { x: 100, y: 90 }).x).toBeCloseTo(180, 5);
    expect(rotatePt({ x: 1, y: 0 }, { x: 0, y: 0 }, 90).y).toBeCloseTo(1, 5);
  });

  it('draws as a rotated group in SVG and survives validation', () => {
    const svg = shapeSVG({ k: 'rect', x: 0, y: 0, w: 100, h: 40, rot: 45 }, 'sans');
    expect(svg).toContain('rotate(45 50 20)');
    expect(shapeSVG({ k: 'rect', x: 0, y: 0, w: 100, h: 40 }, 'sans')).not.toContain('rotate');
    expect((validateShape({ k: 'rect', x: 0, y: 0, w: 10, h: 10, rot: 45 }) as { rot?: number }).rot).toBe(45);
    expect((validateShape({ k: 'text', x: 0, y: 10, s: 'a', rot: -90 }) as { rot?: number }).rot).toBe(-90);
    expect((validateShape({ k: 'rect', x: 0, y: 0, w: 10, h: 10, rot: 9999 }) as { rot?: number }).rot).toBeUndefined();
  });
});

describe('paragraph justification', () => {
  it('lines sit left, centred or right in the paragraph width, and survive validation and SVG', async () => {
    const { justifyDx } = await import('../src/core/geom');
    expect(justifyDx('abc', 400)).toBe(0);
    const c = justifyDx('abc', 400, 'center'), r = justifyDx('abc', 400, 'right');
    expect(c).toBeGreaterThan(0); expect(r).toBeCloseTo(2 * c, 5);
    expect((validateShape({ k: 'tlines', x: 0, y: 0, w: 300, h: 60, s: 'hello', al: 'center' }) as { al?: string }).al).toBe('center');
    expect(shapeSVG({ k: 'tlines', x: 10, y: 0, w: 300, h: 60, s: 'hello', al: 'right' }, 'sans')).toMatch(/<text x="(\d{3})/);
    expect(shapeSVG({ k: 'tlines', x: 10, y: 0, w: 300, h: 60, s: 'hello' }, 'sans')).toContain('<text x="10"');
  });

  it('lines sit at the top, middle or bottom of a taller paragraph box', async () => {
    const { paragraphDy } = await import('../src/core/geom');
    expect(paragraphDy(2, 200)).toBe(0);
    const mid = paragraphDy(2, 200, 'middle'), bot = paragraphDy(2, 200, 'bottom');
    expect(mid).toBeGreaterThan(0); expect(bot).toBeCloseTo(2 * mid, 5);
    expect(paragraphDy(5, 60, 'bottom')).toBe(0);                       // no room to move: stays put
    const y = (av?: 'middle' | 'bottom') => Number(/y="(-?[\d.]+)"/.exec(shapeSVG({ k: 'tlines', x: 0, y: 0, w: 300, h: 200, s: 'hello', av }, 'sans'))![1]);
    expect(y('middle')).toBeGreaterThan(y()); expect(y('bottom')).toBeGreaterThan(y('middle'));
    expect((validateShape({ k: 'tlines', x: 0, y: 0, w: 300, h: 60, s: 'hi', av: 'bottom' }) as { av?: string }).av).toBe('bottom');
  });

  it('a double-headed arrow draws, exports and validates both heads', async () => {
    const { classify } = await import('../src/core/semantics');
    const one = shapeSVG({ k: 'line', x1: 0, y1: 50, x2: 200, y2: 50, arrow: true }, 'sans');
    const both = shapeSVG({ k: 'line', x1: 0, y1: 50, x2: 200, y2: 50, arrow: true, tail: true }, 'sans');
    expect(both.length).toBeGreaterThan(one.length);
    expect(both).toMatch(/M[\d.]+ [\d.]+L0 50L/);                 // a head whose tip is the start point
    expect((validateShape({ k: 'line', x1: 0, y1: 0, x2: 10, y2: 10, tail: true }) as { tail?: boolean }).tail).toBe(true);
    const f = frame({ k: 'line', x1: 0, y1: 50, x2: 200, y2: 50, tail: true });
    expect(classify(f).els[0].role).toBe('Arrow');                   // a head at the start alone still makes it an arrow
  });

  it('an arrow with its heads taken off is a connector, not a divider', async () => {
    const { classify } = await import('../src/core/semantics');
    const { isConnector } = await import('../src/core/types');
    const f = frame({ k: 'line', x1: 0, y1: 50, x2: 200, y2: 50, conn: true });
    expect(classify(f).els[0].role).toBe('Connector');
    expect(isConnector(f.shapes[0])).toBe(true);
    expect(isConnector({ k: 'line', x1: 0, y1: 0, x2: 9, y2: 9 })).toBe(false);          // a plain line stays a divider
    expect((validateShape({ k: 'line', x1: 0, y1: 0, x2: 10, y2: 10, conn: true }) as { conn?: boolean }).conn).toBe(true);
  });
});

describe('arrowhead boxes in the outline', () => {
  it('name the ends by where they lie, and taking the last head off leaves a connector', async () => {
    const { headEnds, setHead } = await import('../src/core/heads');
    const right = { k: 'line', x1: 0, y1: 0, x2: 100, y2: 5, arrow: true } as const;
    expect(headEnds(right).map((h) => [h.word, h.prop, h.on])).toEqual([['left', 'tail', false], ['right', 'arrow', true]]);
    const left = { k: 'line', x1: 100, y1: 0, x2: 0, y2: 5, arrow: true } as const;       // drawn right to left: its end is the left one
    expect(headEnds(left).map((h) => [h.word, h.prop])).toEqual([['left', 'arrow'], ['right', 'tail']]);
    const up = { k: 'line', x1: 0, y1: 100, x2: 3, y2: 0, arrow: true } as const;
    expect(headEnds(up).map((h) => h.word)).toEqual(['top', 'bottom']);
    const ln = { ...right };
    setHead(ln as never, 'arrow', false);
    expect(ln).toMatchObject({ conn: true });
    setHead(ln as never, 'tail', true);
    expect((ln as { conn?: boolean }).conn).toBeUndefined();
  });
});
