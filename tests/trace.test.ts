import { describe, expect, it } from 'vitest';
import { traceImage, type Raster } from '../src/core/trace';
import type { Pt } from '../src/core/types';

let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/** A white sheet with uneven lighting and paper grain, onto which strokes are inked with a wobbly pen. */
function sheet(w: number, h: number, strokes: Pt[][], thick = 2.5, jitter = 0.8): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const light = 235 + 15 * (x / w) - 20 * (y / h) + (rnd() - 0.5) * 8; // gradient + grain
    const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = light; data[i + 3] = 255;
  }
  const dot = (cx: number, cy: number) => {
    for (let dy = -thick; dy <= thick; dy++) for (let dx = -thick; dx <= thick; dx++) {
      if (dx * dx + dy * dy > thick * thick / 1.4) continue;
      const x = Math.round(cx + dx), y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 55;
    }
  };
  for (const s of strokes) for (let k = 1; k < s.length; k++) {
    const a = s[k - 1], b = s[k], n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
    for (let t = 0; t <= n; t++) dot(a.x + ((b.x - a.x) * t) / n + (rnd() - 0.5) * jitter, a.y + ((b.y - a.y) * t) / n + (rnd() - 0.5) * jitter);
  }
  return { width: w, height: h, data };
}
const P = (x: number, y: number): Pt => ({ x, y });
const boxStrokes = (x: number, y: number, w: number, h: number) => [[P(x, y), P(x + w, y)], [P(x + w, y - 4), P(x + w, y + h + 4)], [P(x + w + 4, y + h), P(x, y + h)], [P(x, y + h + 4), P(x, y - 4)]];
const loop = (cx: number, cy: number, r: number) => Array.from({ length: 49 }, (_, i) => P(cx + r * Math.cos((i / 48) * 6.28), cy + r * Math.sin((i / 48) * 6.28)));
/** Scribbled "handwriting": a row of small squiggles. */
const scrawl = (x: number, y: number, glyphs: number) => Array.from({ length: glyphs }, (_, g) => [P(x + g * 24, y + 16), P(x + g * 24 + 6, y), P(x + g * 24 + 12, y + 16), P(x + g * 24 + 18, y + 2)]);
/** Back-and-forth scribble with rounded turns, as a hand really makes it. */
const zigzag = (x: number, y: number, w: number, rows: number, gap: number) => {
  const pts: Pt[] = [P(x, y)];
  for (let r = 0; r < rows; r++) {
    const right = r % 2 === 0, x1 = right ? x + w : x, yy = y + r * gap;
    pts.push(P(x1, yy));
    if (r < rows - 1) for (let a = 0; a <= 8; a++) { const t = (a / 8) * Math.PI; pts.push(P(x1 + (right ? 1 : -1) * Math.sin(t) * (gap / 2), yy + (1 - Math.cos(t)) * (gap / 2))); }
  }
  return pts;
};

describe('image tracing', () => {
  it('turns a photographed sketch into boxes, circles, arrows, paragraphs and text placeholders', () => {
    const strokes = [
      ...boxStrokes(100, 100, 300, 160),                       // card drawn as four separate lines
      ...boxStrokes(130, 200, 120, 40),                        // a button inside it
      ...scrawl(150, 212, 3),                                  // handwriting inside the button
      loop(560, 160, 60),                                      // a circle
      [P(440, 330), P(700, 330)], [P(700, 330), P(672, 314)], [P(700, 330), P(672, 346)],   // arrow with a V head
      zigzag(100, 340, 300, 5, 30),                            // scribbled paragraph
    ];
    const r = traceImage(sheet(960, 600, strokes));
    expect(r.device).toBe('desktop');
    const rects = r.shapes.filter((s) => s.k === 'rect') as { x: number; y: number; w: number; h: number }[];
    const near = (a: number, b: number, t = 26) => Math.abs(a - b) <= t;
    expect(rects.some((s) => near(s.x, 100) && near(s.y, 100) && near(s.w, 300) && near(s.h, 160))).toBe(true);
    expect(rects.some((s) => near(s.x, 130) && near(s.y, 200) && near(s.w, 120) && near(s.h, 40))).toBe(true);
    const ells = r.shapes.filter((s) => s.k === 'ell') as { x: number; y: number; w: number; h: number }[];
    expect(ells.some((s) => near(s.x + s.w / 2, 560) && near(s.y + s.h / 2, 160) && near(s.w, 120, 30))).toBe(true);
    expect(r.shapes.some((s) => s.k === 'line' && s.arrow)).toBe(true);
    expect(r.shapes.some((s) => s.k === 'tlines')).toBe(true);
    expect(r.shapes.some((s) => s.k === 'text')).toBe(true);        // the handwriting inside the button
    expect(r.texts).toBeGreaterThan(0);
  });

  it('picks the phone frame for a portrait image and ignores an empty sheet', () => {
    const r = traceImage(sheet(390, 780, [...boxStrokes(40, 60, 300, 50)]));
    expect(r.device).toBe('phone');
    expect(r.shapes.some((s) => s.k === 'rect')).toBe(true);
    expect(traceImage(sheet(960, 600, [])).shapes).toEqual([]);
  });

  it('copes with a large photo (downscales) and a small ring that is a radio button', () => {
    const big = sheet(1920, 1200, [loop(300, 300, 22), ...scrawl(360, 285, 4)].map((s) => s.map((p) => P(p.x * 2, p.y * 2))), 5);
    const r = traceImage(big);
    expect(r.shapes.length).toBeGreaterThan(0);
  });
});
