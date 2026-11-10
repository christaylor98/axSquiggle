import { connect } from './connect';
import { lineLabelSpot, textWidth, wrapText } from './geom';
import { newId, TONES, type Frame, type Shape, type Tone } from './types';

/**
 * A diagram written as text: boxes in groups, arrows between them. It lays itself out (each group a band, boxes left to right,
 * wrapping) and routes every arrow around the boxes, so a map or a process can be drawn, and redrawn, by editing a few lines.
 *
 *   diagram
 *     group Products & apps
 *       axChat "● 296 commits · 4 d"
 *       axFlow
 *     group Data
 *       axVerity
 *     axFlow -> axVerity : stores runs in it
 *     axChat ~> axVerity
 *
 * `->` is an arrow (depends on, leads to), `~>` a dashed one (related), `--` a plain connector. Text after ` : ` is the
 * arrow's label (why). A quoted string after a box name is its second line; {hot} {warm} {cold} {green} {amber} {red} after it
 * fills the box, so how alive or how healthy reads at a glance. A box named only in an arrow is still drawn.
 */
export interface DNode { name: string; sub?: string; tone?: Tone }
export interface DGroup { title: string; nodes: DNode[] }
export interface DEdge { a: string; b: string; kind: 'arrow' | 'related' | 'plain'; label?: string }
export interface Diagram { groups: DGroup[]; edges: DEdge[] }

const EDGE = /^(.+?)\s*(->|~>|--)\s*(.+?)(?:\s+:\s+(.+))?$/;
const NODE = /^(.+?)(?:\s+"([^"]*)")?$/;

export function parseDiagram(text: string): Diagram {
  const groups: DGroup[] = [];
  const edges: DEdge[] = [];
  const loose: DGroup = { title: '', nodes: [] };
  const seen = new Set<string>();
  let cur: DGroup | null = null, curIndent = -1;
  const add = (g: DGroup, n: DNode) => { if (!g.nodes.some((m) => m.name === n.name)) { seen.add(n.name); g.nodes.push(n); } };
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    if (!raw.trim()) continue;
    const ind = /^ */.exec(raw.replace(/\t/g, '  '))![0].length, line = raw.trim();
    if (cur && ind <= curIndent) cur = null;
    const gm = /^group(?:\s+(.*))?$/i.exec(line);
    if (gm) { cur = { title: (gm[1] ?? '').trim(), nodes: [] }; curIndent = ind; groups.push(cur); continue; }
    const em = EDGE.exec(line);
    if (em) { edges.push({ a: em[1].trim(), b: em[3].trim(), kind: em[2] === '->' ? 'arrow' : em[2] === '~>' ? 'related' : 'plain', ...(em[4] ? { label: em[4].trim() } : {}) }); continue; }
    const tm = /\s*\{(\w+)\}\s*$/.exec(line), tone = tm && (TONES as readonly string[]).includes(tm[1].toLowerCase()) ? tm[1].toLowerCase() as Tone : undefined;
    const nm = NODE.exec(tone ? line.slice(0, tm!.index) : line)!;
    add(cur ?? loose, { name: nm[1].trim(), ...(nm[2] !== undefined ? { sub: nm[2] } : {}), ...(tone ? { tone } : {}) });
  }
  for (const e of edges) for (const n of [e.a, e.b]) if (!seen.has(n)) add(loose, { name: n });
  if (loose.nodes.length) groups.unshift(loose);
  return { groups, edges };
}

const GAP_X = 16, GAP_Y = 48, BAND = 30, MIN_W = 150, COL_GAP = 56, STACK_GAP = 14, LINE = 20;

/** A box's text: its name, then its second line wrapped to the box width. */
const boxText = (n: DNode, bw: number) => [n.name, ...(n.sub ? wrapText(n.sub, bw - 20) : [])];
const boxH = (lines: number) => Math.max(44, 14 + lines * LINE + 10);

/**
 * Shapes for a diagram whose top-left is (x, y) and width w. Returns them and the height used.
 * The first line of the text may be `across`: then each group is a column, left to right, its boxes stacked down it
 * (a landscape map: foundations on the left, outcomes on the right). Otherwise each group is a band, boxes left to right.
 */
export function buildDiagram(text: string, x: number, y: number, w: number): { shapes: Shape[]; h: number } {
  const first = text.split('\n')[0].trim().toLowerCase();
  const across = first === 'across' || first === 'lr';
  const d = parseDiagram(across ? text.split('\n').slice(1).join('\n') : text);
  const shapes: Shape[] = [];
  const box = new Map<string, number>();   // node name -> index of its rect in `shapes`
  const place = (n: DNode, bx: number, by: number, bw: number, bh: number, lines: string[]) => {
    const id = newId('d');
    if (!box.has(n.name)) box.set(n.name, shapes.length);
    shapes.push({ k: 'rect', x: bx, y: by, w: bw, h: bh, role: 'Card', id, dg: true, ...(n.tone ? { tone: n.tone } : {}) });
    shapes.push({ k: 'text', x: bx + 10, y: by + 26, s: lines.join('\n'), of: id });
  };
  let cy = y, bottom = y;
  if (across) {
    const n = Math.max(1, d.groups.length);
    const cw = Math.floor((w - (n - 1) * COL_GAP) / n);
    d.groups.forEach((g, gi) => {
      const cx = x + gi * (cw + COL_GAP);
      let yy = y;
      if (g.title) { shapes.push({ k: 'text', x: cx, y: yy + 18, s: g.title, free: true }); yy += BAND; }
      for (const node of g.nodes) {
        const lines = boxText(node, cw), bh = boxH(lines.length);
        place(node, cx, yy, cw, bh, lines);
        yy += bh + STACK_GAP;
      }
      bottom = Math.max(bottom, yy - STACK_GAP);
    });
  } else {
    // With no arrows to route, rows sit close; a group with few boxes shares the full width between them.
    const gy = d.edges.length ? GAP_Y : STACK_GAP;
    const cap = Math.max(1, Math.floor((w + GAP_X) / (MIN_W + GAP_X)));
    for (const g of d.groups) {
      const perRow = Math.max(1, Math.min(cap, d.edges.length ? 5 : g.nodes.length));
      const bw = Math.floor((w - (perRow - 1) * GAP_X) / perRow);
      if (g.title) { shapes.push({ k: 'text', x, y: cy + 18, s: g.title, free: true }); cy += BAND; }
      const bh = Math.max(...g.nodes.map((nd) => boxH(boxText(nd, bw).length)), 44);
      g.nodes.forEach((nd, k) => {
        const col = k % perRow, row = Math.floor(k / perRow);
        place(nd, x + col * (bw + GAP_X), cy + row * (bh + gy), bw, bh, boxText(nd, bw));
      });
      cy += Math.ceil(g.nodes.length / perRow) * (bh + gy);
    }
    bottom = cy - gy;
  }
  const h = Math.max(44, bottom - y + 20);
  // Route every edge around the boxes, on a scratch frame holding only the diagram.
  const scratch: Frame = { id: 'scratch', device: 'desktop', caption: '', shapes, notes: [], h: Math.min(4000, y + h + 200) };
  for (const e of d.edges) {
    const ia = box.get(e.a), ib = box.get(e.b);
    if (ia === undefined || ib === undefined || ia === ib) continue;
    const ra = shapes[ia] as Extract<Shape, { k: 'rect' }>, rb = shapes[ib] as Extract<Shape, { k: 'rect' }>;
    const ln: Extract<Shape, { k: 'line' }> = { k: 'line', x1: ra.x + ra.w / 2, y1: ra.y + ra.h / 2, x2: rb.x + rb.w / 2, y2: rb.y + rb.h / 2 };
    if (e.kind === 'arrow' || e.kind === 'related') ln.arrow = true;
    if (e.kind === 'related') ln.dash = true;
    if (e.kind === 'plain') ln.conn = true;
    shapes.push(ln);
    connect(scratch, shapes.length - 1, ia, ib);
    if (e.label) {
      const id = newId('l'); ln.id = id;
      const spot = lineLabelSpot(ln, e.label);
      shapes.push({ k: 'text', x: Math.round(spot.x), y: Math.round(spot.y), s: e.label, of: id });
    }
  }
  return { shapes, h };
}

/** Width a diagram box would need for its longest name (for callers that want to warn about clipping). */
export const longestName = (text: string) => Math.max(0, ...parseDiagram(text).groups.flatMap((g) => g.nodes.map((n) => textWidth(n.name))));
