import { area, bounds, center, contains, distToLine, lineLabelSpot, textBlock, snapTo, FONT_PX, type Box } from './geom';
import { rotatePt, rotOf } from './rotate';
import { cloneFrame, DEVICES, frameSize, GRID, newId, type Frame, type Role, type Shape } from './types';

export interface El {
  /** Index of the primary shape in frame.shapes. */
  i: number;
  role: Role;
  label: string;
  /** Index of the owned text shape (the label), if any. */
  labelIdx: number | null;
  /** An input's ghost hint (placeholder text inside the box), if any. */
  ghostIdx: number | null;
  hint: string;
  /** Primary-shape index of the smallest enclosing rect, or null. */
  parent: number | null;
  depth: number;
}

export interface Classified {
  /** Non-owned elements ordered top-to-bottom then left-to-right. */
  els: El[];
  byIndex: Map<number, El>;
  /** text index -> owner element index */
  owner: Map<number, number>;
}

export const LABEL_ROLES: Role[] = ['Circle', 'Button', 'Input', 'Card', 'Checkbox', 'Radio', 'Header', 'List item', 'Sidebar', 'Text', 'Paragraph', 'Arrow', 'Connector', 'Image'];

/** A box that may be turned: texts are judged in its own (unturned) frame. */
type TBox = Box & { rot?: number };
const hostBox = (s: Shape): TBox => ({ ...bounds(s), rot: rotOf(s) });
/** A text's box, and how far it moved, once mapped into the frame of a turned box. */
function tbounds(t: Shape, r: TBox): { b: Box; dx: number; dy: number } {
  const b = bounds(t);
  if (!r.rot) return { b, dx: 0, dy: 0 };
  const c = center(b), q = rotatePt(c, { x: r.x + r.w / 2, y: r.y + r.h / 2 }, -r.rot);
  return { b: { ...b, x: b.x + q.x - c.x, y: b.y + q.y - c.y }, dx: q.x - c.x, dy: q.y - c.y };
}

const insideTexts = (frame: Frame, r: TBox): number[] => {
  const out: number[] = [];
  frame.shapes.forEach((s, i) => {
    if (s.k !== 'text' || s.ghost || s.free) return;   // detached text belongs to nothing; a ghost hint belongs to its input; it does not make the box a button
    const b = tbounds(s, r).b, c = center(b);
    // A text belongs to a box when its middle is inside, or when it starts inside and is level with it: a label typed
    // longer than its box still belongs to it, so the box can grow to fit it instead of losing it.
    const level = c.y > r.y && c.y < r.y + r.h;
    if (level && ((c.x > r.x && c.x < r.x + r.w) || (b.x > r.x && b.x < r.x + r.w))) out.push(i);
  });
  return out;
};

/** Nearest text above `r` (within 36px, left edges within 24px), skipping `skip`. */
function labelAbove(frame: Frame, r: TBox, skip: Set<number>): number | null {
  let best: number | null = null, bestGap = Infinity;
  frame.shapes.forEach((s, i) => {
    if (s.k !== 'text' || s.free || skip.has(i)) return;
    const d = tbounds(s, r), gap = r.y - (s.y + d.dy); // baseline above the top edge
    if (gap < -2 || gap > 36 || Math.abs(s.x + d.dx - r.x) > 24) return;
    if (gap < bestGap) { bestGap = gap; best = i; }
  });
  return best;
}

/** A text just outside `r`, above or below it, centred over it (a label the person put there with the arrow keys). */
function labelOutside(frame: Frame, r: TBox, side: 'top' | 'bottom', skip: Set<number>): number | null {
  let best: number | null = null, bestGap = Infinity;
  frame.shapes.forEach((s, i) => {
    if (s.k !== 'text' || s.free || s.ghost || skip.has(i)) return;
    const b = tbounds(s, r).b, cx = b.x + b.w / 2;
    if (cx < r.x - 4 || cx > r.x + r.w + 4) return;
    const gap = side === 'top' ? r.y - (b.y + b.h) : b.y - (r.y + r.h);
    if (gap < -6 || gap > 40) return;
    if (gap < bestGap) { bestGap = gap; best = i; }
  });
  return best;
}

/** Nearest text just right of `r`, roughly centred vertically on it. */
function labelRight(frame: Frame, r: TBox, skip: Set<number>): number | null {
  let best: number | null = null, bestGap = Infinity;
  frame.shapes.forEach((s, i) => {
    if (s.k !== 'text' || s.free || skip.has(i)) return;
    const d = tbounds(s, r), b = d.b;
    const gap = s.x + d.dx - (r.x + r.w);
    const cy = b.y + b.h / 2;
    if (gap < -4 || gap > 32 || cy < r.y - 8 || cy > r.y + r.h + 8) return;
    if (gap < bestGap) { bestGap = gap; best = i; }
  });
  return best;
}

export function classify(frame: Frame): Classified {
  const { w: W, h: H } = frameSize(frame);
  const sh = frame.shapes;
  const roles = new Map<number, Role>();
  const claimed = new Set<number>();
  const owner = new Map<number, number>();
  const labelOf = new Map<number, number>();
  const claim = (el: number, text: number | null) => {
    if (text === null) return;
    claimed.add(text); owner.set(text, el); labelOf.set(el, text);
  };

  sh.forEach((s, i) => {
    const b = bounds(s);
    switch (s.k) {
      case 'rect': {
        const inside = insideTexts(frame, hostBox(s));
        const wide = b.w >= 0.75 * W;
        let role: Role;
        if (s.role) role = s.role;   // built from an outline or by an AI: the intent is known, not guessed from the size
        else if (b.w <= 28 && b.h <= 28 && inside.length === 0) role = 'Checkbox';   // a box with words in it is never a tick box
        else if (wide && b.h <= 64 && inside.length === 0 && labelAbove(frame, hostBox(s), new Set()) !== null) role = 'Input';
        else if (wide && b.y <= 0.1 * H + 20 && b.h <= 110) role = 'Header';
        else if (wide && b.h <= 64 && inside.length === 0) role = 'Input'; // empty wide box below the header band
        else if (wide && b.h <= 120) role = 'List item';
        else if (b.h >= 0.45 * H && b.w <= 0.35 * W) role = 'Sidebar';
        else if (b.h <= 64 && inside.length === 1) role = 'Button';
        else if (b.h <= 64 && inside.length === 0) role = 'Input';
        else role = 'Card';
        roles.set(i, role);
        break;
      }
      case 'img': roles.set(i, 'Image'); break;
      case 'tlines': roles.set(i, 'Paragraph'); break;
      case 'line': roles.set(i, s.arrow || s.tail ? 'Arrow' : s.conn ? 'Connector' : 'Divider'); break;
      case 'free': roles.set(i, s.arrow ? 'Arrow' : 'Sketch'); break;
      case 'ell':
        if (s.role) { roles.set(i, s.role); break; }
        roles.set(i, b.w <= 64 && b.h <= 64 && insideTexts(frame, hostBox(s)).length === 0 ? (b.y <= 0.1 * H + 20 && b.w > 28 ? 'Avatar' : 'Radio') : 'Circle');
        break;
    }
  });

  const rectIdx = (role: Role) => [...roles].filter(([, r]) => r === role).map(([i]) => i);
  const firstInside = (i: number) => {
    const ts = insideTexts(frame, hostBox(sh[i])).filter((t) => !claimed.has(t));
    ts.sort((a, b) => sh[a].k === 'text' && sh[b].k === 'text' ? (sh[a] as any).y - (sh[b] as any).y || (sh[a] as any).x - (sh[b] as any).x : 0);
    return ts.length ? ts[0] : null;
  };

  // A text that records which shape or arrow it labels belongs to it wherever either has moved to; only then is anything guessed from distance.
  sh.forEach((t, ti) => {
    if (t.k !== 'text' || !t.of || t.free || t.ghost || claimed.has(ti)) return;
    let best: number | null = null, bd = Infinity;
    sh.forEach((s, i) => {
      if (s.k === 'text' || s.k === 'free' || s.k === 'tlines' || !roles.has(i) || (s as { id?: string }).id !== t.of || labelOf.has(i) || (s.k === 'rect' && s.grp)) return;
      const d = s.k === 'line' ? distToLine(s, center(bounds(t))) : Math.hypot(center(bounds(s)).x - center(bounds(t)).x, center(bounds(s)).y - center(bounds(t)).y);
      if (d < bd) { bd = d; best = i; }
    });
    if (best !== null) claim(best, ti);
  });

  // A box or circle whose label has been placed by hand (lbl) owns that label first, wherever its role would have put it.
  sh.forEach((s, i) => {
    if ((s.k !== 'rect' && s.k !== 'ell') || !s.lbl || (s.k === 'rect' && s.grp)) return;
    const b = bounds(s);
    { const hb = hostBox(s); claim(i, insideTexts(frame, hb).find((t) => !claimed.has(t)) ?? labelOutside(frame, hb, 'top', claimed) ?? labelOutside(frame, hb, 'bottom', claimed)); }
  });
  // An image's description is the text just underneath it (or one typed on it).
  sh.forEach((s, i) => {
    if (s.k !== 'img') return;
    const hb = hostBox(s);
    claim(i, labelOutside(frame, hb, 'bottom', claimed) ?? insideTexts(frame, hb).find((t) => !claimed.has(t)) ?? null);
  });

  for (const i of rectIdx('Button').filter((j) => !labelOf.has(j))) claim(i, insideTexts(frame, hostBox(sh[i])).find((t) => !claimed.has(t)) ?? null);
  for (const role of ['Checkbox', 'Radio'] as Role[]) for (const i of rectIdx(role).filter((j) => !labelOf.has(j))) claim(i, labelRight(frame, hostBox(sh[i]), claimed));
  for (const role of ['Header', 'List item', 'Sidebar'] as Role[]) for (const i of rectIdx(role).filter((j) => !labelOf.has(j))) claim(i, firstInside(i));
  for (const i of rectIdx('Input').filter((j) => !labelOf.has(j)).sort((a, b) => bounds(sh[a]).y - bounds(sh[b]).y)) claim(i, labelAbove(frame, hostBox(sh[i]), claimed));
  // Only choices inside (radios / checkboxes and their labels): a card that also holds inputs or buttons keeps its title inside.
  const holdsChoice = (ci: number) => {
    const inner = [...roles].filter(([j]) => j !== ci && contains(bounds(sh[ci]), bounds(sh[j])));
    return inner.length > 0 && inner.every(([, r]) => r === 'Radio' || r === 'Checkbox');
  };
  // A card of radios / checkboxes is a group: its title is the text on top of it (above the border), not one inside among the options.
  for (const i of rectIdx('Card').filter((j) => !labelOf.has(j)).sort((a, b) => area(bounds(sh[a])) - area(bounds(sh[b])))) {
    claim(i, firstInside(i) ?? (holdsChoice(i) ? labelAbove(frame, hostBox(sh[i]), claimed) : null));
  }

  // Words beside an arrow or connector are its label: the nearest unclaimed text within reach of its path.
  sh.forEach((s, i) => {
    if (s.k !== 'line' || (roles.get(i) !== 'Arrow' && roles.get(i) !== 'Connector') || labelOf.has(i)) return;
    let best: number | null = null, bd = 26;
    sh.forEach((t, ti) => {
      if (t.k !== 'text' || t.free || t.ghost || claimed.has(ti)) return;
      const d = distToLine(s, center(bounds(t)));
      if (d < bd) { bd = d; best = ti; }
    });
    claim(i, best);
  });

  // Ghost hints belong to the smallest input that contains them.
  const ghostOf = new Map<number, number>();
  sh.forEach((s, ti) => {
    if (s.k !== 'text' || !s.ghost) return;
    const m = center(bounds(s));
    let best: number | null = null, ba = Infinity;
    for (const ri of rectIdx('Input')) { const rb = bounds(sh[ri]); if (m.x > rb.x && m.x < rb.x + rb.w && m.y > rb.y && m.y < rb.y + rb.h && area(rb) < ba) { best = ri; ba = area(rb); } }
    if (best !== null && !ghostOf.has(best)) { ghostOf.set(best, ti); claimed.add(ti); owner.set(ti, best); }
  });

  const prim: number[] = [];
  sh.forEach((s, i) => { if (s.k !== 'text' || !claimed.has(i)) prim.push(i); });
  for (const i of prim) if (sh[i].k === 'text') roles.set(i, 'Text');

  const rects = sh.map((s, i) => (s.k === 'rect' ? i : -1)).filter((i) => i >= 0);
  const els: El[] = prim.map((i) => {
    const b = bounds(sh[i]);
    let parent: number | null = null, pa = Infinity;
    for (const r of rects) {
      if (r === i) continue;
      const rb = bounds(sh[r]);
      const ra = area(rb);
      if (ra > area(b) + 1 && ra < pa && contains(rb, b)) { parent = r; pa = ra; }
    }
    const lt = labelOf.get(i) ?? null;
    const t = sh[i].k === 'text' || sh[i].k === 'tlines' ? ((sh[i] as { s?: string }).s ?? '') : lt !== null ? (sh[lt] as { s: string }).s : '';
    const gi = ghostOf.get(i) ?? null;
    return { i, role: roles.get(i)!, label: t, labelIdx: lt, ghostIdx: gi, hint: gi !== null ? (sh[gi] as { s: string }).s : '', parent, depth: 0 };
  });
  const byIndex = new Map(els.map((e) => [e.i, e]));
  for (const e of els) { let d = 0, p = e.parent; while (p !== null && d < 20) { d++; p = byIndex.get(p)?.parent ?? null; } e.depth = d; }
  // Tree order: top-to-bottom, left-to-right among siblings, and every container directly followed by what it contains.
  const reading = (a: El, b: El) => {
    const ba = bounds(sh[a.i]), bb = bounds(sh[b.i]);
    return Math.abs(ba.y - bb.y) > 6 ? ba.y - bb.y : ba.x - bb.x;
  };
  const kids = new Map<number | null, El[]>();
  for (const e of els) { const k = kids.get(e.parent) ?? []; k.push(e); kids.set(e.parent, k); }
  const ordered: El[] = [];
  const walk = (p: number | null) => { for (const e of (kids.get(p) ?? []).sort(reading)) { ordered.push(e); walk(e.i); } };
  walk(null);
  // A parent that is somehow not in the list must not drop its children.
  if (ordered.length !== els.length) { const seen = new Set(ordered); for (const e of els.sort(reading)) if (!seen.has(e)) ordered.push(e); }
  return { els: ordered, byIndex, owner };
}

/** Shapes that travel with element `i`: itself, its owned label and (for containers) everything inside it. */
export function moveGroup(frame: Frame, c: Classified, i: number): Set<number> {
  const el = c.byIndex.get(i);
  const set = new Set<number>([i]);
  if (el?.labelIdx != null) set.add(el.labelIdx);
  if (el?.ghostIdx != null) set.add(el.ghostIdx);
  if (el && (el.role === 'Card' || el.role === 'Sidebar' || el.role === 'List item')) {
    const b = bounds(frame.shapes[i]);
    frame.shapes.forEach((s, j) => { if (j !== i && contains(b, bounds(s))) set.add(j); });
  }
  return set;
}

/** Move an element with its owned label and (for containers) everything inside it. */
export function moveElement(frame: Frame, c: Classified, i: number, dx: number, dy: number): void {
  for (const j of moveGroup(frame, c, i)) shift(frame, j, dx, dy);
}

export function shift(frame: Frame, j: number, dx: number, dy: number): void {
  const s = frame.shapes[j];
  if (s.k === 'line') { s.x1 += dx; s.x2 += dx; s.y1 += dy; s.y2 += dy; if (s.via) s.via = s.via.map(([x, y]) => [x + dx, y + dy]); }
  else if (s.k === 'free') s.pts = s.pts.map(([x, y]) => [x + dx, y + dy]);
  else { s.x += dx; s.y += dy; }
}

const setText = (frame: Frame, idx: number | null, x: number, y: number) => {
  if (idx === null) return;
  const t = frame.shapes[idx];
  if (t.k === 'text') { t.x = Math.round(x); t.y = Math.round(y); }
};

/** Smart sizing: roles decide sizes, labels and alignment. Returns a new frame. */
/** Space between a group's contents and its border. */
export const GROUP_PAD = 10;

/** A rectangle drawn around a set of shapes: the border of a radio / checkbox group, or of any selection. */
export function borderFor(shapes: Shape[]): Shape {
  const bs = shapes.map(bounds);
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  const r = Math.max(...bs.map((b) => b.x + b.w)), btm = Math.max(...bs.map((b) => b.y + b.h));
  return { k: 'rect', x: Math.round(x - GROUP_PAD), y: Math.round(y - GROUP_PAD), w: Math.round(r - x + 2 * GROUP_PAD), h: Math.round(btm - y + 2 * GROUP_PAD), grp: true };
}

/** Re-fit every group border to what is inside it (after a label got longer, a row was added or one was removed). */
export function refitBorders(f: Frame): void {
  const c = classify(f);
  f.shapes.forEach((s, i) => {
    if (s.k !== 'rect' || !s.grp) return;
    const kids = c.els.filter((e) => e.parent === i);
    if (!kids.length) return;
    const b = borderFor(kids.flatMap((e) => [f.shapes[e.i], ...(e.labelIdx !== null ? [f.shapes[e.labelIdx]] : [])])) as typeof s;
    s.x = b.x; s.y = b.y; s.w = b.w; s.h = b.h;
  });
}

/** Put a box's or circle's label where the person asked: above or below it (outside), or inside left, right or centred. */
function placeLabel(f: Frame, c: Classified, e: El, host: Extract<Shape, { k: 'rect' | 'ell' }>, fixed = false): void {
  const t = f.shapes[e.labelIdx!];
  if (t.k !== 'text') return;
  const pl = host.lbl!, lj = host.lj ?? 'center', outside = pl === 'top' || pl === 'bottom';
  const r = host, ell = host.k === 'ell';
  const inset = ell ? Math.max(14, Math.round(r.h * 0.18)) : 10;   // clear of the border (and of a circle's curve)
  const nat = textBlock(t.s).w;
  let blk = textBlock(t.s);
  if (outside) {
    // Above or underneath: wrap to the shape's width (never narrower than a short phrase); the shape is not touched.
    const avail = Math.max(r.w, 80);
    if (nat > avail) { t.wrap = Math.round(avail); blk = textBlock(t.s, t.wrap); } else delete t.wrap;
  } else {
    // Inside: wrap to what the shape can hold, and only grow the shape when the wrapped words still do not fit.
    for (let pass = 0; pass < 4; pass++) {
      const availW = Math.max(40, ell ? r.w * 0.72 : r.w - 28), availH = ell ? r.h * 0.72 : r.h - 2 * inset;
      if (nat > availW) { t.wrap = Math.round(availW); blk = textBlock(t.s, t.wrap); } else { delete t.wrap; blk = textBlock(t.s); }
      if (fixed || (blk.h <= availH && r.w >= (ell ? 56 : 68))) break;   // a shape being resized keeps its size: the words overflow
      if (ell) { const g = Math.max(blk.h / availH, 1.08); r.w = Math.ceil(r.w * g); r.h = Math.ceil(r.h * g); }   // a circle grows evenly, staying round
      else { r.h = Math.max(r.h, Math.ceil(blk.h + 2 * inset)); r.w = Math.max(r.w, 68); }
    }
  }
  if (lj === 'left') delete t.al; else t.al = lj;   // several lines line up the way the label is justified
  const last = blk.h - FONT_PX * 1.1;
  if (pl === 'top' && host.y < 34 + last) moveElement(f, c, e.i, 0, 34 + last - host.y);   // room above for it, as for a group title
  const pad = outside ? 0 : 14;
  const x = lj === 'left' ? r.x + pad : lj === 'right' ? r.x + r.w - pad - blk.w : r.x + (r.w - blk.w) / 2;
  const y = pl === 'top' ? r.y - 8 - last
    : pl === 'bottom' ? r.y + r.h + FONT_PX + 6
    : pl === 'inTop' ? r.y + inset + FONT_PX * 0.8
    : pl === 'inBottom' ? r.y + r.h - inset - blk.h + FONT_PX * 0.8
    : r.y + r.h / 2 + 6 - last / 2;
  setText(f, e.labelIdx, x, y);
}

/** `fixed`: a shape the person is resizing; it keeps exactly the size they gave it (words overflow rather than grow it). */
/** Put each arrow's label back on its run (cheap: for when arrows were just re-routed, e.g. while a shape is dragged). */
/** Which text is each arrow's label (arrow index -> text index)? Ask BEFORE the arrows are re-routed: afterwards the words are no longer near them. */
export function arrowLabelOwners(f: Frame): Map<number, number> {
  const out = new Map<number, number>();
  for (const e of classify(f).els) if (e.labelIdx !== null && f.shapes[e.i].k === 'line') out.set(e.i, e.labelIdx);
  return out;
}
export function placeArrowLabels(f: Frame, owners: Map<number, number> = arrowLabelOwners(f)): void {
  for (const [li, ti] of owners) {
    const ln = f.shapes[li], t = f.shapes[ti];
    if (ln?.k === 'line' && t?.k === 'text') { const sp = lineLabelSpot(ln, t.s); setText(f, ti, sp.x, sp.y); }
  }
}

export function smartSize(frame: Frame, fixed: number | null = null): Frame {
  const f = cloneFrame(frame);
  const { w: W } = frameSize(f);
  const phone = f.device === 'phone';
  const c = classify(f);
  const rectOf = (i: number) => f.shapes[i] as Extract<Frame['shapes'][number], { k: 'rect' }>;
  const lbl = (e: El) => (e.labelIdx !== null ? (f.shapes[e.labelIdx] as { s: string }) : null);
  // Work on a turned shape's label in the shape's own frame: turn it back first, and (at the end) turn it forward again.
  // Without this a label that is not re-placed by its role would be turned a little further on every pass.
  const turnLabel = (e: El, sign: 1 | -1) => {
    const host = f.shapes[e.i], t = e.labelIdx !== null ? f.shapes[e.labelIdx] : null, r = rotOf(host);
    if (!t || t.k !== 'text' || host.k === 'line' || !r) return;
    const b = bounds(t), c0 = center(b), q = rotatePt(c0, center(bounds(host)), sign * r);
    t.x = Math.round(t.x + q.x - c0.x); t.y = Math.round(t.y + q.y - c0.y);
    if (sign === 1) t.rot = r; else delete t.rot;
  };
  for (const e of c.els) turnLabel(e, -1);
  // Make each label remember what it labels (so moving things never loosens it), and keep ids unique (a pasted copy gets its own).
  {
    const idOf = (sh: Shape) => (sh as { id?: string }).id;
    const seen = new Set<string>();
    const owns = (i: number) => { const o = c.byIndex.get(i), id = idOf(f.shapes[i]); return !!id && o?.labelIdx != null && (f.shapes[o.labelIdx] as { of?: string }).of === id; };
    f.shapes.forEach((s, i) => { const id = idOf(s); if (id && owns(i)) seen.add(id); });   // what a label points at keeps its id
    f.shapes.forEach((s, i) => { const id = idOf(s); if (id && !owns(i)) { if (seen.has(id)) delete (s as { id?: string }).id; else seen.add(id); } });
    for (const e of c.els) {
      const host = f.shapes[e.i];
      if (e.labelIdx === null || host.k === 'text' || host.k === 'free' || host.k === 'tlines' || (host.k === 'rect' && host.grp)) continue;
      const t = f.shapes[e.labelIdx];
      if (t.k !== 'text') continue;
      if (!host.id) { let id; do id = newId('a'); while (seen.has(id)); host.id = id; seen.add(id); }
      t.of = host.id;
    }
  }

  // Compact (toolbar) buttons hug their labels, which changes their widths: remember the gap each had to its right-hand neighbour so the row can be re-spaced after.
  const smRows: { e: El; gap: number }[][] = [];
  {
    const sm = c.els.filter((e) => e.role === 'Button' && rectOf(e.i).sm && e.i !== fixed).sort((a, b) => rectOf(a.i).y - rectOf(b.i).y || rectOf(a.i).x - rectOf(b.i).x);
    for (const e of sm) {
      const row = smRows.find((r) => r[0].e.parent === e.parent && Math.abs(rectOf(r[0].e.i).y - rectOf(e.i).y) <= 3);
      if (row) row.push({ e, gap: 0 }); else smRows.push([{ e, gap: 0 }]);
    }
    for (const row of smRows) {
      row.sort((a, b) => rectOf(a.e.i).x - rectOf(b.e.i).x);
      row.forEach((m, k) => { m.gap = k < row.length - 1 ? Math.max(0, rectOf(row[k + 1].e.i).x - (rectOf(m.e.i).x + rectOf(m.e.i).w)) : 0; });
    }
  }
  for (const e of c.els) {
    if (e.i === fixed) continue;
    if (e.role === 'Header') {
      const r = rectOf(e.i);
      r.x = GRID; r.w = W - 2 * GRID;
    } else if (e.role === 'Button') {
      const r = rectOf(e.i), t = lbl(e), base = r.sm ? (phone ? 36 : 28) : phone ? 48 : 40;
      const blk = t ? textBlock(t.s) : null;
      if (r.sm) { r.h = base; if (blk) r.w = Math.max(36, Math.ceil(blk.w + 20)); continue; }   // compact toolbar buttons hug their label
      r.h = blk ? Math.max(base, Math.ceil((blk.h + 20) / GRID) * GRID) : base;   // extra lines make the button taller
      if (blk && !r.lbl) r.w = Math.min(Math.max(snapTo(r.w, GRID), Math.ceil((blk.w + 48) / GRID) * GRID), Math.max(r.w, W - GRID - r.x));
    } else if (e.role === 'Card' || e.role === 'List item' || e.role === 'Sidebar') {
      // A title never spills out of its box: widen the box to hold it (within the frame margins).
      const r = rectOf(e.i), t = lbl(e);
      if (t && !r.grp && !r.lbl) { const need = Math.ceil((textBlock(t.s).w + 32) / GRID) * GRID; if (need > r.w) r.w = Math.min(need, Math.max(r.w, W - GRID - r.x)); }
    } else if (e.role === 'Input') {
      rectOf(e.i).h = phone ? 48 : 44;
    }
  }

  // Re-space each row of compact buttons from its first button, keeping the gaps it had: a button that grew never lands on the next one.
  for (const row of smRows) {
    for (let k = 1; k < row.length; k++) {
      const prev = rectOf(row[k - 1].e.i), cur = rectOf(row[k].e.i), want = prev.x + prev.w + row[k - 1].gap;
      if (cur.x !== want) moveElement(f, c, row[k].e.i, want - cur.x, 0);
    }
  }

  // Same-role rects in one column: align left edges (within 18px) and equalise widths (within 20%).
  for (const role of ['Input', 'Button', 'Card', 'List item'] as Role[]) {
    const members = c.els.filter((e) => e.role === role && !(role === 'Button' && rectOf(e.i).sm)).sort((a, b) => rectOf(a.i).x - rectOf(b.i).x);   // compact buttons are items in a row, not a column
    const clusters: El[][] = [];
    for (const m of members) {
      const cl = clusters[clusters.length - 1];
      if (cl && rectOf(m.i).x - rectOf(cl[cl.length - 1].i).x <= 18) cl.push(m); else clusters.push([m]);
    }
    for (const cl of clusters) {
      if (cl.length < 2) continue;
      const left = Math.min(...cl.map((m) => rectOf(m.i).x));
      const maxW = Math.max(...cl.map((m) => rectOf(m.i).w));
      for (const m of cl) {
        const r = rectOf(m.i);
        if (r.x !== left) moveElement(f, c, m.i, left - r.x, 0);
        if ((maxW - r.w) / maxW <= 0.2) r.w = maxW;
      }
    }
  }

  // Buttons side by side (a toolbar, OK / Cancel) are one size: the widest label sets the width. Neighbours that would now touch are re-spaced.
  {
    const btns = c.els.filter((e) => e.role === 'Button' && !rectOf(e.i).sm).sort((a, b) => rectOf(a.i).y - rectOf(b.i).y || rectOf(a.i).x - rectOf(b.i).x);
    const rows: El[][] = [];
    for (const b of btns) {
      const row = rows.find((r) => r[0].parent === b.parent && Math.abs(rectOf(r[0].i).y - rectOf(b.i).y) <= 6);
      if (row) row.push(b); else rows.push([b]);
    }
    for (const row of rows) {
      if (row.length < 2) continue;
      row.sort((a, b) => rectOf(a.i).x - rectOf(b.i).x);
      const wmax = Math.max(...row.map((e) => rectOf(e.i).w));
      row.forEach((e) => { rectOf(e.i).w = wmax; });
      let overlap = false;
      for (let k = 1; k < row.length; k++) if (rectOf(row[k - 1].i).x + wmax + 8 > rectOf(row[k].i).x) overlap = true;
      if (overlap) for (let k = 1; k < row.length; k++) { const dx = rectOf(row[k - 1].i).x + wmax + 16 - rectOf(row[k].i).x; moveElement(f, c, row[k].i, dx, 0); }
      // never past the frame's right margin: tighten the gaps (a drawn row that cannot fit is left to the person)
      const last = rectOf(row[row.length - 1].i), over = last.x + last.w - (W - GRID);
      if (over > 0 && row.length > 1) { const shiftBy = Math.min(over / (row.length - 1), 16); row.forEach((e, k) => { if (k) moveElement(f, c, e.i, -shiftBy * k, 0); }); }
    }
  }

  // Radios and checkboxes in a column share a left edge (so a stack reads as a stack).
  for (const role of ['Radio', 'Checkbox'] as Role[]) {
    const members = c.els.filter((e) => e.role === role).sort((a, b) => bounds(f.shapes[a.i]).x - bounds(f.shapes[b.i]).x);
    const clusters: El[][] = [];
    for (const m of members) {
      const cl = clusters[clusters.length - 1];
      if (cl && bounds(f.shapes[m.i]).x - bounds(f.shapes[cl[cl.length - 1].i]).x <= 18 && cl[0].parent === m.parent) cl.push(m); else clusters.push([m]);
    }
    for (const cl of clusters) {
      if (cl.length < 2) continue;
      const left = Math.min(...cl.map((m) => bounds(f.shapes[m.i]).x));
      for (const m of cl) { const dx = left - bounds(f.shapes[m.i]).x; if (dx) moveElement(f, c, m.i, dx, 0); }
    }
  }

  const choicesOnly = (ci: number) => {
    const inner = c.els.filter((k) => k.i !== ci && contains(bounds(f.shapes[ci]), bounds(f.shapes[k.i])));
    return inner.length > 0 && inner.every((k) => k.role === 'Radio' || k.role === 'Checkbox');
  };
  // Label placement last, once geometry is final.
  for (const e of c.els) {
    if (e.ghostIdx !== null) { const r = rectOf(e.i); setText(f, e.ghostIdx, r.x + 12, r.y + r.h / 2 + 6); }
    if (e.labelIdx === null) continue;
    const r = rectOf(e.i);
    const host = f.shapes[e.i];
    if (host.k === 'line') { const t = f.shapes[e.labelIdx]; if (t.k === 'text') { const sp = lineLabelSpot(host, t.s); setText(f, e.labelIdx, sp.x, sp.y); } continue; }
    if (host.k === 'img') { placeLabel(f, c, e, { ...host, lbl: 'bottom', lj: 'center' } as never); continue; }   // the description sits centred underneath
    if ((host.k === 'rect' || host.k === 'ell') && host.lbl && !(host.k === 'rect' && host.grp)) { placeLabel(f, c, e, host, e.i === fixed); continue; }
    if (e.role === 'Button') { const blk = textBlock(lbl(e)!.s), last = blk.h - FONT_PX * 1.1; setText(f, e.labelIdx, r.x + (r.w - blk.w) / 2, r.y + r.h / 2 + 6 - last / 2); }
    else if (e.role === 'Input') setText(f, e.labelIdx, r.x, r.y - 8);
    else if (e.role === 'Header') setText(f, e.labelIdx, r.x + 16, r.y + r.h / 2 + 6);
    else if (e.role === 'Card' && choicesOnly(e.i)) {
      // Titles of choice groups sit on top of the border; make room above the card if it is at the very top.
      if (r.y < 34) moveElement(f, c, e.i, 0, 34 - r.y);
      setText(f, e.labelIdx, r.x, r.y - 8);
    }
  }
  refitBorders(f);
  // A turned shape carries its label round with it: place it in the shape's own frame (above), then turn it about the shape's centre.
  for (const e of c.els) turnLabel(e, 1);
  // The frame grows to hold its content (a long page) and shrinks back to the device size when the content is smaller.
  const { h: baseH } = DEVICES[f.device];
  const bottom = f.shapes.reduce((m, sh) => { const b = bounds(sh); return Math.max(m, b.y + b.h); }, 0) + GRID;
  if (bottom > baseH) f.h = Math.ceil(bottom / GRID) * GRID; else delete f.h;
  return f;
}
