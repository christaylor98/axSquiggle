import { describe, expect, it } from 'vitest';
import { connect, endsOf, nearestTarget } from '../src/core/connect';
import { shapeSVG } from '../src/core/exporters';
import { linePts } from '../src/core/geom';
import { validateBoard } from '../src/core/model';
import { cloneFrame, cloneShape, newFrame, type Frame } from '../src/core/types';

const A = { k: 'rect', x: 40, y: 200, w: 120, h: 80 } as const;
const B = { k: 'rect', x: 560, y: 200, w: 120, h: 80 } as const;
const C = { k: 'rect', x: 300, y: 180, w: 120, h: 120 } as const;
const arrow = (x1: number, y1: number, x2: number, y2: number) => ({ k: 'line', x1, y1, x2, y2, arrow: true }) as const;
const frame = (...shapes: Frame['shapes']) => { const f = newFrame(); f.shapes.push(...shapes.map(cloneShape)); return f; };

describe('arrow attachment', () => {
  it('finds the nearest shape by outline distance', () => {
    const f = frame(A, C, B);
    expect(nearestTarget(f, { x: 180, y: 240 })).toBe(0);
    expect(nearestTarget(f, { x: 540, y: 240 })).toBe(2);
    expect(nearestTarget(f, { x: 480, y: 500 })).toBeNull();
  });

  it('snaps to the facing sides and stays straight when the way is clear', () => {
    const f = frame(A, B, arrow(180, 240, 540, 240));
    connect(f, 2, 0, 1);
    const l = f.shapes[2] as { x1: number; x2: number; via?: unknown };
    expect([l.x1, l.x2]).toEqual([160, 560]);
    expect(l.via).toBeUndefined();
  });

  it('flows around an item in the way, orthogonally, clear of its outline', () => {
    const f = frame(A, C, B, arrow(180, 240, 540, 240));
    connect(f, 3, 0, 2);
    const ln = f.shapes[3] as Extract<Frame['shapes'][number], { k: 'line' }>;
    const pts = linePts(ln);
    expect(pts.length).toBeGreaterThan(2);
    for (let i = 1; i < pts.length; i++) expect(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y).toBe(true);
    for (let x = 300; x <= 420; x += 5) {
      // no vertex path crosses the card (checked on every segment sample)
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        if (Math.min(a.x, b.x) <= x && x <= Math.max(a.x, b.x)) {
          const y = a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x || 1);
          expect(y <= 180 || y >= 300).toBe(true);
        }
      }
    }
  });

  it('re-straightens once the obstacle is gone and remembers its ends', () => {
    const f = frame(A, C, B, arrow(160, 240, 560, 240));
    expect(endsOf(f, 3)).toEqual([0, 2]);
    connect(f, 3, 0, 2);
    expect((f.shapes[3] as { via?: unknown }).via).toBeDefined();
    (f.shapes[1] as { y: number }).y = 400;
    connect(f, 3, 0, 2);
    expect((f.shapes[3] as { via?: unknown }).via).toBeUndefined();
  });

  it('keeps waypoints through clone, JSON validation and export', () => {
    const f = frame(A, C, B, arrow(180, 240, 540, 240));
    connect(f, 3, 0, 2);
    const via = (f.shapes[3] as { via?: number[][] }).via!;
    expect((cloneFrame(f).shapes[3] as { via?: number[][] }).via).toEqual(via);
    const board = validateBoard(JSON.parse(JSON.stringify({ frames: [f] })));
    expect((board!.frames[0].shapes[3] as { via?: number[][] }).via).toEqual(via);
    const svg = shapeSVG(f.shapes[3], 'sans-serif');
    expect(svg.match(/L/g)!.length).toBeGreaterThanOrEqual(via.length + 1);
  });
});

describe('sketched arrows', () => {
  it('a curved path ending in a hook becomes a clean arrow; as a sketch it keeps its shape and gains an arrowhead', async () => {
    const { recognize } = await import('../src/core/recognize');
    // A smooth S-curve left to right, then a short hook back from the tip.
    const pts = [] as { x: number; y: number }[];
    for (let x = 100; x <= 400; x += 4) pts.push({ x, y: 300 + 60 * Math.sin(((x - 100) / 300) * Math.PI) });
    const tip = pts[pts.length - 1], prev = pts[pts.length - 6];
    const back = Math.atan2(prev.y - tip.y, prev.x - tip.x) + 0.5; // back along the path, opened out ~30 degrees
    for (let i = 1; i <= 8; i++) pts.push({ x: tip.x + i * 4 * Math.cos(back), y: tip.y + i * 4 * Math.sin(back) });
    const clean = recognize(pts, [], { snap: true });
    expect(clean?.gesture).toBe('arrow');
    expect(clean?.shape?.k).toBe('line');
    const r = recognize(pts, [], { snap: true, sketch: true });
    expect(r?.gesture).toBe('arrow');
    expect(r?.shape?.k).toBe('free');
    expect((r?.shape as { arrow?: boolean }).arrow).toBe(true);
  });

  it('draws and exports the arrowhead on a sketched path', async () => {
    const { pathHead } = await import('../src/core/exporters');
    const s = { k: 'free', pts: [[0, 0], [20, 0], [40, 0], [60, 0]], arrow: true } as const;
    const [ax, ay, bx, by] = pathHead(s.pts as unknown as number[][]);
    expect(ax).toBeLessThan(60); expect(bx).toBeLessThan(60);
    expect(Math.sign(ay)).toBe(-Math.sign(by));
    expect(shapeSVG(s as never, 'x').match(/M/g)!.length).toBe(2);
    expect(cloneShape(s as never)).toEqual(s);
  });
});

describe('small arrowhead hooks', () => {
  it('reads a short hook on a long straight shaft as an arrow, at any slope', async () => {
    const { recognize } = await import('../src/core/recognize');
    for (const [ang, hookLen] of [[0, 24], [0, 16], [0.4, 20], [-0.6, 24], [Math.PI / 2, 22]] as const) {
      const pts = [] as { x: number; y: number }[];
      for (let d = 0; d <= 375; d += 4) pts.push({ x: 100 + d * Math.cos(ang), y: 300 + d * Math.sin(ang) });
      const tip = pts[pts.length - 1], back = ang + Math.PI - 0.5;
      for (let d = 4; d <= hookLen; d += 4) pts.push({ x: tip.x + d * Math.cos(back), y: tip.y + d * Math.sin(back) });
      const r = recognize(pts, [], { snap: false });
      expect(r?.gesture, `angle ${ang} hook ${hookLen}`).toBe('arrow');
      expect((r?.shape as { arrow?: boolean }).arrow).toBe(true);
    }
  });

  it('does not turn a plain straight line or a wavy stroke into an arrow', async () => {
    const { recognize } = await import('../src/core/recognize');
    const line = Array.from({ length: 95 }, (_, i) => ({ x: 100 + i * 4, y: 300 + Math.sin(i) * 1.5 }));
    expect(recognize(line, [], { snap: false })?.gesture).toBe('line');
  });
});

describe('attachment points', () => {
  it('big sides offer more slots than small ones', async () => {
    const { slots } = await import('../src/core/connect');
    expect(slots(0, 30).length).toBe(1);
    expect(slots(0, 120).length).toBeGreaterThan(slots(0, 60).length);
  });
  it('an arrow between offset shapes picks the slot facing the other, so it can run straight', async () => {
    const { attachPoint } = await import('../src/core/connect');
    const a = attachPoint({ x: 0, y: 0, w: 100, h: 200 }, { x: 300, y: 150 });
    expect(a.n).toEqual({ x: 1, y: 0 });
    expect(Math.abs(a.p.y - 150)).toBeLessThan(13);
  });
});

it('an arrow to an ellipse ends on its curve, not its bounding box', async () => {
  const { attachPoint } = await import('../src/core/connect');
  const b = { x: 0, y: 0, w: 200, h: 100 };
  const { p } = attachPoint(b, { x: 400, y: 20 }, true);
  const k = ((p.x - 100) / 100) ** 2 + ((p.y - 50) / 50) ** 2;
  expect(k).toBeCloseTo(1, 5);
});

it('picks the neatest side pair: into the top of a destination that sits below, not its far side', () => {
  const src = { k: 'rect', x: 40, y: 40, w: 120, h: 60 } as const;
  const dst = { k: 'rect', x: 300, y: 300, w: 120, h: 60 } as const;
  const wall = { k: 'rect', x: 180, y: 120, w: 100, h: 100 } as const;
  const f = frame(src, dst, wall, arrow(100, 70, 360, 330));
  connect(f, 3, 0, 1);
  const pts = linePts(f.shapes[3] as Extract<Frame['shapes'][number], { k: 'line' }>);
  const end = pts[pts.length - 1], prev = pts[pts.length - 2];
  expect(end.y).toBe(300);          // lands on the top edge
  expect(prev.x).toBe(end.x);       // coming straight down onto it
  expect(pts.length).toBe(3); // one bend
});

it('an arrow into a circle runs along the line through its centre', () => {
  const circ = { k: 'ell', x: 300, y: 200, w: 100, h: 100 } as const;
  const src = { k: 'rect', x: 40, y: 40, w: 80, h: 40 } as const;
  const f = frame(src, circ, arrow(100, 60, 330, 230));
  connect(f, 2, 0, 1);
  const l = f.shapes[2] as { x2: number; y2: number; via?: unknown };
  expect(Math.hypot(l.x2 - 350, l.y2 - 250)).toBeCloseTo(50, 0);   // on the curve
  expect(l.via).toBeUndefined();
});

it('a routed arrow into a circle finishes with one straight run on the angle', () => {
  const src = { k: 'rect', x: 40, y: 40, w: 100, h: 60 } as const;
  const circ = { k: 'ell', x: 400, y: 300, w: 100, h: 100 } as const;
  const wall = { k: 'rect', x: 180, y: 20, w: 40, h: 140 } as const;
  const f = frame(src, circ, wall, arrow(140, 70, 420, 330));
  connect(f, 3, 0, 1);
  const pts = linePts(f.shapes[3] as Extract<Frame['shapes'][number], { k: 'line' }>);
  const a = pts[pts.length - 2], e = pts[pts.length - 1];
  expect(Math.hypot(e.x - 450, e.y - 350)).toBeCloseTo(50, 0);      // ends on the curve
  expect((a.x - e.x) * (450 - e.x) + (a.y - e.y) * (350 - e.y)).toBeLessThan(0); // approach points at the centre
  expect(a.x !== e.x && a.y !== e.y).toBe(true);                    // and it is angled, not a right-angle lead-in
});

describe('line hops', () => {
  it('a later line arcs over an earlier one it crosses, and not over a T-junction', async () => {
    const { lineHops, lineD } = await import('../src/core/exporters');
    const v = { k: 'line', x1: 100, y1: 20, x2: 100, y2: 180 } as const;
    const h = { k: 'line', x1: 0, y1: 100, x2: 200, y2: 100, arrow: true } as const;
    const t = { k: 'line', x1: 150, y1: 100, x2: 150, y2: 180 } as const; // starts on the run: a T, no hop
    const hp = lineHops(frame(v, h, t));
    expect(hp.get(1)).toEqual([{ seg: 0, x: 100, y: 100 }]);
    expect(hp.get(0)).toBeUndefined();
    expect(hp.get(2)).toBeUndefined();
    expect(lineD(h as never, hp.get(1))).toContain('A6 6 0 0 1 106 100');
  });
  it('a vertical run hops sideways over a horizontal one drawn before it', async () => {
    const { lineHops, lineD } = await import('../src/core/exporters');
    const h = { k: 'line', x1: 0, y1: 100, x2: 200, y2: 100 } as const;
    const v = { k: 'line', x1: 100, y1: 20, x2: 100, y2: 180, arrow: true } as const;
    const hp = lineHops(frame(h, v));
    expect(hp.get(1)).toEqual([{ seg: 0, x: 100, y: 100 }]);
    expect(lineD(v as never, hp.get(1))).toContain('L100 94A6 6 0 0 1 100 106');
  });
});

it('an arrow ending on the diagonal of a circle is still attached to it', () => {
  const circ = { k: 'ell', x: 300, y: 200, w: 100, h: 100 } as const;
  const f = frame({ k: 'rect', x: 40, y: 40, w: 80, h: 40 }, circ, arrow(100, 60, 330, 230));
  connect(f, 2, 0, 1);
  expect(endsOf(f, 2)).toEqual([0, 1]);
  f.shapes[1] = { ...circ, x: 330, y: 260 };
  connect(f, 2, 0, 1);
  expect(endsOf(f, 2)).toEqual([0, 1]);
});

describe('hop choice', () => {
  it('arrows hop by default, dividers do not, and the hop flag overrides either', async () => {
    const { lineHops } = await import('../src/core/exporters');
    const v = { k: 'line', x1: 100, y1: 20, x2: 100, y2: 180 } as const;
    const hz = { k: 'line', x1: 0, y1: 100, x2: 200, y2: 100 } as const;
    expect(lineHops(frame(v, hz)).size).toBe(0);                                  // two dividers: nobody hops
    expect(lineHops(frame(v, { ...hz, arrow: true })).get(1)?.length).toBe(1);    // arrow over divider
    expect(lineHops(frame({ ...v, arrow: true }, hz)).get(0)?.length).toBe(1);    // earlier arrow hops over a later divider
    expect(lineHops(frame(v, { ...hz, hop: true })).get(1)?.length).toBe(1);      // divider switched on
    expect(lineHops(frame(v, { ...hz, arrow: true, hop: false })).size).toBe(0);  // arrow switched off
  });
});

describe('hops over shape edges', () => {
  it('an arrow crossing a box edge arcs over it, and one that ends on the edge does not', async () => {
    const { lineHops } = await import('../src/core/exporters');
    const box = { k: 'rect', x: 100, y: 50, w: 100, h: 100 } as const;
    const through = { k: 'line', x1: 20, y1: 100, x2: 300, y2: 100, arrow: true } as const;   // crosses the left and right edges
    expect(lineHops(frame(box, through)).get(1)?.map((h) => h.x).sort((a, b) => a - b)).toEqual([100, 200]);
    const ends = { k: 'line', x1: 20, y1: 100, x2: 100, y2: 100, arrow: true } as const;       // stops on the left edge
    expect(lineHops(frame(box, ends)).size).toBe(0);
    expect(lineHops(frame(box, { ...through, arrow: false })).size).toBe(0);                  // a divider does not hop
    const circ = { k: 'ell', x: 100, y: 50, w: 100, h: 100 } as const;
    expect(lineHops(frame(circ, through)).get(1)?.length).toBe(2);
  });
});

describe('an arrow back into the same shape', () => {
  it('leaves one side and enters an adjacent one, all outside the shape', () => {
    for (const k of ['rect', 'ell'] as const) {
      const f = newFrame();
      f.shapes.push({ k, x: 200, y: 200, w: 120, h: 80 } as any, { k: 'line', x1: 320, y1: 220, x2: 280, y2: 200, arrow: true } as any);
      connect(f, 1, 0, 0);
      const ln = f.shapes[1] as any;
      const pts = linePts(ln);
      expect(pts.length).toBeGreaterThanOrEqual(4);
      expect(Math.hypot(ln.x2 - ln.x1, ln.y2 - ln.y1)).toBeGreaterThan(25);
      for (let i = 1; i < pts.length - 1; i++) {
        const q = pts[i];
        expect(q.x <= 200 || q.x >= 320 || q.y <= 200 || q.y >= 280).toBe(true);
      }
    }
  });
});

describe('turned shapes', () => {
  it('attach on the turned outline', () => {
    // a 120x40 bar turned 90 degrees stands upright: an arrow from the left meets its (now tall) left edge
    const f = frame({ k: 'rect', x: 400, y: 200, w: 120, h: 40, rot: 90 } as any, { k: 'rect', x: 40, y: 200, w: 80, h: 40 }, arrow(120, 220, 400, 220));
    connect(f, 2, 1, 0);
    const ln = f.shapes[2] as any;
    expect(ln.x2).toBeCloseTo(440, -1);   // the bar's turned left edge: centre 460 - 20
    // a square turned 45 degrees: the arrow ends on the diamond's corner/edge, not at the old box side
    const g = frame({ k: 'rect', x: 400, y: 200, w: 80, h: 80, rot: 45 } as any, { k: 'rect', x: 40, y: 220, w: 80, h: 40 }, arrow(120, 240, 400, 240));
    connect(g, 2, 1, 0);
    const l2 = g.shapes[2] as any;
    expect(Math.abs(l2.x2 - (440 - 40 * Math.SQRT2))).toBeLessThan(3);   // the diamond's left corner, not the old box side at 400
  });
});
