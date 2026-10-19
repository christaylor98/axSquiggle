import { describe, expect, it } from 'vitest';
import { recognize, type Gesture } from '../src/core/recognize';
import type { Pt, Shape } from '../src/core/types';

// Deterministic PRNG so the 300 runs are reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type R = () => number;
const between = (r: R, a: number, b: number) => a + r() * (b - a);

/** Sample a polyline every ~4px and add +-3px uniform noise per point. */
function stroke(path: Pt[], r: R, noise = 3): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(d / 4));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out.map((p) => ({ x: p.x + between(r, -noise, noise), y: p.y + between(r, -noise, noise) }));
}
const arcPts = (cx: number, cy: number, rad: number, a0: number, a1: number): Pt[] => {
  const n = Math.max(8, Math.round((Math.abs(a1 - a0) * rad) / 4));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return { x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) };
  });
};
const P = (x: number, y: number): Pt => ({ x, y });
const rot = (pts: Pt[], a: number, ox: number, oy: number) =>
  pts.map((p) => ({ x: ox + (p.x - ox) * Math.cos(a) - (p.y - oy) * Math.sin(a), y: oy + (p.x - ox) * Math.sin(a) + (p.y - oy) * Math.cos(a) }));

interface Case { name: string; min?: number; /* runs that must pass (default all): the sloppy cases push noise to where a few are honestly ambiguous */ gen: (r: R) => { pts: Pt[]; shapes?: Shape[] }; check: (res: ReturnType<typeof recognize>, shapes: Shape[]) => boolean }
const kindIs = (g: Gesture, k?: string) => (res: ReturnType<typeof recognize>) => !!res && res.gesture === g && (k === undefined || res.shape?.k === k);

const RUNS = 300;
export const cases: Case[] = [
  {
    name: 'box',
    gen: (r) => {
      const x = between(r, 100, 500), y = between(r, 80, 300), w = between(r, 70, 300), h = between(r, 50, 200);
      const path = [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h), P(x + between(r, -3, 3), y + between(r, 0, 8))];
      return { pts: stroke(path, r) };
    },
    check: kindIs('box', 'rect'),
  },
  {
    name: 'L',
    gen: (r) => {
      const x = between(r, 100, 500), y = between(r, 80, 300), w = between(r, 80, 260), h = between(r, Math.max(60, 0.3 * w), 180); // arms within the 25% ratio
      return { pts: stroke([P(x, y), P(x, y + h), P(x + w, y + h)], r) };
    },
    check: kindIs('corner', 'rect'),
  },
  {
    name: 'corner',
    gen: (r) => {
      const x = between(r, 100, 500), y = between(r, 80, 300), w = between(r, 80, 260), h = between(r, Math.max(60, 0.3 * w), 180); // arms within the 25% ratio
      return { pts: stroke([P(x, y + h), P(x, y), P(x + w, y)], r) };
    },
    check: kindIs('corner', 'rect'),
  },
  {
    name: 'full circle',
    gen: (r) => {
      const rad = between(r, 30, 110), a0 = between(r, 0, 6.28);
      return { pts: stroke(arcPts(between(r, 200, 500), between(r, 150, 300), rad, a0, a0 + 6.28 + between(r, 0.05, 0.3)), r) };
    },
    check: kindIs('ellipse', 'ell'),
  },
  // Up and around is a circle; the way a stroke starts decides it. A clockwise arc starting at angle a heads up when cos(a) < 0.
  ...[90, 120, 180].map((deg): Case => ({
    name: `${deg}° arc up and around`,
    gen: (r) => {
      const rad = between(r, 50, 100), a0 = between(r, Math.PI / 2 + 0.6, (3 * Math.PI) / 2 - 0.6);
      return { pts: stroke(arcPts(between(r, 200, 500), between(r, 150, 300), rad, a0, a0 + (deg * Math.PI) / 180), r) };
    },
    check: kindIs('circle', 'ell'),
  })),
  // Down and across is a box, even when it is a curve.
  ...[90, 120].map((deg): Case => ({
    name: `${deg}° arc down and across`,
    gen: (r) => {
      const rad = between(r, 50, 100), a0 = between(r, -Math.PI / 2 + 0.7, Math.PI / 2 - 0.7);
      return { pts: stroke(arcPts(between(r, 200, 500), between(r, 150, 300), rad, a0, a0 + (deg * Math.PI) / 180), r) };
    },
    check: kindIs('corner', 'rect'),
  })),
  {
    name: 'sloppy box (rounded corners, a gap where it closes, wobbly)', min: 290,
    gen: (r) => {
      const x = between(r, 100, 500), y = between(r, 80, 300), w = between(r, 80, 300), h = between(r, 60, 200), c = Math.min(w, h) * 0.18;
      const path = [P(x + c, y), P(x + w - c, y), P(x + w, y + c), P(x + w, y + h - c), P(x + w - c, y + h), P(x + c, y + h), P(x, y + h - c), P(x, y + 0.25 * h)];
      return { pts: stroke(path, r, 5) };
    },
    check: kindIs('box', 'rect'),
  },
  {
    name: 'sloppy circle (wobbly, does not quite close)', min: 290,
    gen: (r) => {
      const rad = between(r, 30, 110), a0 = between(r, 0, 6.28);
      return { pts: stroke(arcPts(between(r, 200, 500), between(r, 150, 300), rad, a0, a0 + 5.6 + between(r, 0, 0.5)), r, 5) };
    },
    check: (res) => !!res && (res.gesture === 'ellipse' || res.gesture === 'circle') && res.shape?.k === 'ell',
  },
  {
    name: 'wonky arrow (wobbly bowed shaft, rough hook at the end)', min: 285,
    gen: (r) => {
      const x = between(r, 60, 300), y = between(r, 80, 300), len = between(r, 90, 330), a = between(r, -3, 3);
      const bow = between(r, -0.12, 0.12) * len, n = Math.round(len / 4);
      const ux = Math.cos(a), uy = Math.sin(a);
      const shaft = Array.from({ length: n + 1 }, (_, i) => { const t = i / n, off = bow * Math.sin(Math.PI * t) + 5 * Math.sin(t * 11); return P(x + len * t * ux - off * uy, y + len * t * uy + off * ux); });
      const tip = shaft[shaft.length - 1], hookLen = between(r, 14, 32), back = a + Math.PI + between(r, 0.4, 1.1) * (r() < 0.5 ? 1 : -1);
      const hook = [P(tip.x + hookLen * Math.cos(back), tip.y + hookLen * Math.sin(back))];
      return { pts: stroke([...shaft, ...hook], r, 2) };
    },
    check: kindIs('arrow', 'line'),
  },
  {
    name: 'line',
    gen: (r) => {
      const x = between(r, 50, 400), y = between(r, 50, 300), len = between(r, 80, 350), a = between(r, 0.2, 1.3);
      return { pts: stroke([P(x, y), P(x + len * Math.cos(a), y + len * Math.sin(a))], r) };
    },
    check: kindIs('line', 'line'),
  },
  {
    name: 'horizontal line',
    gen: (r) => {
      const x = between(r, 50, 400), y = between(r, 50, 300), len = between(r, 80, 350);
      return { pts: stroke([P(x, y), P(x + len, y + between(r, -6, 6))], r) };
    },
    check: (res) => !!res && res.gesture === 'line' && res.shape?.k === 'line' && res.shape.y1 === res.shape.y2,
  },
  {
    name: 'vertical line',
    gen: (r) => {
      const x = between(r, 50, 400), y = between(r, 50, 300), len = between(r, 80, 280);
      return { pts: stroke([P(x, y), P(x + between(r, -5, 5), y + len)], r) };
    },
    check: (res) => !!res && res.gesture === 'line' && res.shape?.k === 'line' && res.shape.x1 === res.shape.x2,
  },
  {
    name: 'arrow',
    gen: (r) => {
      const x = between(r, 50, 300), y = between(r, 80, 300), len = between(r, 100, 300), a = between(r, -0.5, 0.5);
      const tip = P(x + len * Math.cos(a), y + len * Math.sin(a));
      const back = a + Math.PI + (r() < 0.5 ? 1 : -1) * between(r, 0.5, 0.75);
      const barb = between(r, 28, 42);
      return { pts: stroke([P(x, y), tip, P(tip.x + barb * Math.cos(back), tip.y + barb * Math.sin(back))], r) };
    },
    check: (res) => !!res && res.gesture === 'arrow' && res.shape?.k === 'line' && res.shape.arrow === true,
  },
  {
    name: 'zigzag → tlines',
    gen: (r) => {
      const x = between(r, 100, 400), y = between(r, 80, 250), w = between(r, 80, 300), h = between(r, 30, 90);
      const passes = 5 + Math.floor(r() * 4); // 5 passes = 4 reversals
      const path: Pt[] = [P(x, y)];
      for (let i = 0; i < passes; i++) path.push(P(i % 2 === 0 ? x + w : x, y + (h * (i + 1)) / passes));
      return { pts: stroke(path, r) };
    },
    check: kindIs('paragraph', 'tlines'),
  },
  {
    name: 'zigzag over rect → delete',
    gen: (r) => {
      const x = between(r, 100, 400), y = between(r, 80, 250), w = between(r, 100, 300), h = between(r, 60, 160);
      const shapes: Shape[] = [{ k: 'rect', x, y, w, h }, { k: 'rect', x: 700, y: 400, w: 100, h: 60 }];
      const passes = 6;
      const path: Pt[] = [P(x + 4, y + 4)];
      for (let i = 0; i < passes; i++) path.push(P(i % 2 === 0 ? x + w - 4 : x + 4, y + 4 + ((h - 8) * (i + 1)) / passes));
      return { pts: stroke(path, r), shapes };
    },
    check: (res) => !!res && res.gesture === 'erase' && res.remove === 0,
  },
  {
    name: 'diagonal in rect → image',
    gen: (r) => {
      const x = between(r, 100, 400), y = between(r, 80, 250), w = between(r, 120, 300), h = between(r, 80, 200);
      const shapes: Shape[] = [{ k: 'rect', x, y, w, h }];
      const j = () => between(r, -10, 10);
      const flip = r() < 0.5, rev = r() < 0.5;
      let a = flip ? P(x + w + j(), y + j()) : P(x + j(), y + j());
      let b = flip ? P(x + j(), y + h + j()) : P(x + w + j(), y + h + j());
      if (rev) [a, b] = [b, a];
      return { pts: stroke([a, b], r), shapes };
    },
    check: (res) => !!res && res.gesture === 'image' && res.convert === 0,
  },
  {
    name: 'wavy stroke → a clean line (sketches are the exception)',
    gen: (r) => {
      const x = between(r, 50, 300), y = between(r, 100, 300), w = between(r, 180, 320), amp = between(r, 20, 40), periods = 2 + Math.floor(r() * 2);
      const n = Math.round(w / 4);
      const path = Array.from({ length: n + 1 }, (_, i) => P(x + (w * i) / n, y + amp * Math.sin((2 * Math.PI * periods * i) / n)));
      return { pts: stroke(path, r) };
    },
    check: kindIs('line', 'line'),
  },
];

describe('recognizer', () => {
  for (const c of cases) {
    it(`${c.name}: ${c.min ?? RUNS}/${RUNS} correct`, () => {
      const r = rng(c.name.length * 7919 + 13 + Number(process.env.SEED_OFFSET ?? 0) * 104729);
      let ok = 0;
      const bad: string[] = [];
      for (let i = 0; i < RUNS; i++) {
        const { pts, shapes = [] } = c.gen(r);
        const res = recognize(pts, shapes, { snap: false });
        if (c.check(res, shapes)) ok++;
        else if (bad.length < 3) bad.push(res ? res.gesture : 'null');
      }
      console.log(`ACCURACY ${c.name} ${ok}/${RUNS}${bad.length ? ' wrong->' + bad.join(',') : ''}`);
      expect(ok).toBeGreaterThanOrEqual(c.min ?? RUNS);
    });
  }

  it('keeps a stroke exactly as drawn in sketch mode', () => {
    const pts = Array.from({ length: 60 }, (_, i) => P(100 + i * 5, 200 + 30 * Math.sin(i / 4)));
    expect(recognize(pts, [], { snap: true })?.shape?.k).toBe('line');
    expect(recognize(pts, [], { snap: true, sketch: true })?.shape?.k).toBe('free');
  });

  it('ignores strokes shorter than 8px', () => {
    expect(recognize([P(0, 0), P(3, 3), P(5, 4)], [], { snap: true })).toBeNull();
  });

  it('snaps recognized boxes to the 20px grid', () => {
    const pts = stroke([P(103, 98), P(297, 98), P(297, 203), P(103, 203), P(103, 100)], rng(1), 1);
    const res = recognize(pts, [], { snap: true });
    expect(res?.shape).toEqual({ k: 'rect', x: 100, y: 100, w: 200, h: 100 });
  });
});
