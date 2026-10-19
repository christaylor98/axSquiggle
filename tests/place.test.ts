import { describe, expect, it } from 'vitest';
import { freeSpotFor } from '../src/core/place';
import { cloneShape, newFrame, type Shape } from '../src/core/types';

const frame = (...shapes: Shape[]) => { const f = newFrame(); f.shapes.push(...shapes.map(cloneShape)); return f; };

describe('free spot for a new stamp', () => {
  it('uses the cursor spot when it is free, and the nearest free one when it is not', () => {
    const f = frame({ k: 'rect', x: 100, y: 100, w: 200, h: 100 });
    expect(freeSpotFor(f, 100, 60, { x: 500, y: 300 })).toEqual({ x: 500, y: 300 });
    const p = freeSpotFor(f, 100, 60, { x: 150, y: 130 });
    expect(p.x + 100 <= 88 || p.x >= 312 || p.y + 60 <= 88 || p.y >= 212).toBe(true); // clear of the rect and its margin
  });
  it('without a cursor takes the first free space, never off the frame', () => {
    const f = frame({ k: 'rect', x: 20, y: 20, w: 400, h: 560 });
    const p = freeSpotFor(f, 260, 120);
    expect(p.x).toBeGreaterThanOrEqual(420);
    expect(p.x + 260).toBeLessThanOrEqual(960);
    expect(p.y + 120).toBeLessThanOrEqual(600);
  });
  it('a full frame gets the spot under everything', () => {
    const f = frame({ k: 'rect', x: 0, y: 0, w: 960, h: 600 });
    expect(freeSpotFor(f, 260, 120).y).toBeGreaterThanOrEqual(600);
  });
});
