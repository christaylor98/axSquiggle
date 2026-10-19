import { bounds, type Box } from './geom';
import { frameSize, GRID, type Frame, type Pt } from './types';

const hits = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Where a new thing of this size can go without landing on anything or running off the frame.
 * With a cursor over the frame: the free spot nearest it (the cursor itself if that is free). Without one: the first free spot reading
 * left to right, top to bottom. A frame with no room left gets the spot just below everything (the frame grows to take it).
 */
export function freeSpotFor(f: Frame, w: number, h: number, near?: Pt | null): Pt {
  const { w: W, h: H } = frameSize(f);
  const items = f.shapes.map(bounds).map((b) => ({ x: b.x - 12, y: b.y - 12, w: b.w + 24, h: b.h + 24 }));
  const M = GRID, step = GRID;
  const maxX = W - w - M, maxY = H - h - M;
  let best: Pt | null = null, bd = Infinity;
  if (maxX >= M && maxY >= M) {
    const aim = near && near.x >= 0 && near.y >= 0 && near.x <= W && near.y <= H ? near : null;
    for (let y = M; y <= maxY; y += step) {
      for (let x = M; x <= maxX; x += step) {
        if (items.some((b) => hits({ x, y, w, h }, b))) continue;
        if (!aim) return { x, y };
        const d = Math.hypot(x - aim.x, y - aim.y);
        if (d < bd) { bd = d; best = { x, y }; }
      }
    }
  }
  if (best) return best;
  const low = f.shapes.length ? Math.max(...f.shapes.map((s) => { const b = bounds(s); return b.y + b.h; })) : 0;
  return { x: M, y: Math.ceil((low + GRID) / GRID) * GRID };
}
