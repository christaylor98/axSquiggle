// Drag a box round a four-box diagram and count how often arrows jump (run: npx tsx scripts/jitter.ts)
import { connect } from '../src/core/connect';
import { newFrame } from '../src/core/types';
const f = newFrame();
f.shapes.push({ k: 'rect', x: 100, y: 100, w: 140, h: 70 } as any, { k: 'rect', x: 500, y: 100, w: 140, h: 70 } as any, { k: 'rect', x: 500, y: 420, w: 140, h: 70 } as any, { k: 'rect', x: 100, y: 420, w: 140, h: 70 } as any);
const links: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0]];
links.forEach(() => f.shapes.push({ k: 'line', x1: 0, y1: 0, x2: 0, y2: 0, arrow: true } as any));
const go = () => links.forEach(([a, b], i) => connect(f, 4 + i, a, b));
go();
const shape = (i: number) => { const l = f.shapes[4 + i] as any; return { s: [l.x1, l.y1], v: l.via ?? [], e: [l.x2, l.y2] }; };
// move rect 1 along a smooth path in the open space right of rect 0 (never overlapping others), 3px steps
let prev = links.map((_, i) => shape(i)); let events = 0; const out: string[] = [];
for (let t = 0; t <= 200; t++) {
  const x = 320 + 300 * (0.5 + 0.5 * Math.sin(t / 15)), y = 90 + 240 * (0.5 + 0.5 * Math.sin(t / 23));
  const r = f.shapes[1] as any; r.x = Math.round(x); r.y = Math.round(y);
  go();
  const cur = links.map((_, i) => shape(i));
  cur.forEach((c, i) => {
    const p = prev[i]; const dist = Math.hypot(c.s[0] - p.s[0], c.s[1] - p.s[1]) + Math.hypot(c.e[0] - p.e[0], c.e[1] - p.e[1]);
    const stepMove = Math.hypot(r.x - (r._px ?? r.x), r.y - (r._py ?? r.y));
    if (c.v.length !== p.v.length || dist > 30) { events++; if (out.length < 14) out.push(`t=${t} L${links[i]} bends ${p.v.length}->${c.v.length} ends moved ${Math.round(dist)}  rect1@${r.x},${r.y}\n   ${JSON.stringify(p)}\n   ${JSON.stringify(c)}`); }
  });
  prev = cur;
}
console.log('events', events); console.log(out.join('\n'));
