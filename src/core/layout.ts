import { bounds, lineLabelSpot, textWidth, textBlock, contains, paraHeight, wrapText } from './geom';
import { borderFor, classify, GROUP_PAD, refitBorders, shift, type El } from './semantics';
export { borderFor, GROUP_PAD, refitBorders };
import { cloneFrame, cloneShape, frameSize, GRID, newId, type Frame, type Part, type Shape } from './types';

export type Kind = 'button' | 'input' | 'text' | 'card' | 'image' | 'paragraph' | 'divider' | 'avatar' | 'radio' | 'checkbox' | 'header' | 'list' | 'columns' | 'toolbar' | 'dropdown' | 'search' | 'segmented' | 'badge';

export const KEYWORDS: Record<string, Kind> = {
  button: 'button', input: 'input', text: 'text', h1: 'text', card: 'card', section: 'card',
  image: 'image', img: 'image', paragraph: 'paragraph', p: 'paragraph', divider: 'divider', hr: 'divider',
  avatar: 'avatar', radio: 'radio', checkbox: 'checkbox', header: 'header', nav: 'header', list: 'list', item: 'list',
  columns: 'columns', cols: 'columns', split: 'columns',
  toolbar: 'toolbar', tools: 'toolbar',
  dropdown: 'dropdown', select: 'dropdown', search: 'search',
  segmented: 'segmented', seg: 'segmented', tabs: 'segmented', btngroup: 'segmented', badge: 'badge', tag: 'badge', chip: 'badge',
};

export const ROLE_OF_KIND: Record<Kind, string> = {
  button: 'Button', input: 'Input', text: 'Text', card: 'Card', image: 'Image', paragraph: 'Paragraph',
  divider: 'Divider', avatar: 'Avatar', radio: 'Radio', checkbox: 'Checkbox', header: 'Header', list: 'List item', columns: 'Card', toolbar: 'Button',
  dropdown: 'Input', search: 'Input', segmented: 'Button', badge: 'Button',
};

/** link: the text after "->" in "button Sign in -> 2" (a frame number or caption words), resolved to a frame id later. */
export interface Cell { kind: Kind; label: string; keyword: boolean; link?: string; /** an input's ghost hint: `input Email "you@example.com"` */ hint?: string; /** `image Cockpit {h=320}`: the height to give an image or card */ h?: number }

export const MIN_H = 24, MAX_H = 2000;

/** Split `Email "you@example.com"` into the label and the quoted ghost hint. */
export function splitHint(s: string): { label: string; hint?: string } {
  const m = /^([\s\S]*?)\s*"([^"]*)"\s*$/.exec(s.trim());
  return m ? { label: m[1].trim(), hint: m[2] } : { label: s.trim() };
}

/** First word is a kind keyword -> that kind and the rest as label; otherwise plain text. */
export function parseCell(s: string): Cell {
  let t = s.trim(), link: string | undefined;
  const lm = /^([\s\S]*?)\s*->\s*(\S[\s\S]*)$/.exec(t);
  if (lm) { t = lm[1].trim(); link = lm[2].trim(); }
  let h: number | undefined;
  const hm = /^([\s\S]*?)\s*\{\s*h(?:eight)?\s*[=:]?\s*(\d{1,4})\s*\}\s*$/i.exec(t);
  if (hm) { t = hm[1].trim(); h = Math.max(MIN_H, Math.min(MAX_H, +hm[2])); }
  const withLink = (c: Cell): Cell => ({ ...c, ...(link ? { link } : {}), ...(h !== undefined && (c.kind === 'image' || c.kind === 'card') ? { h } : {}) });
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(t);
  if (m) {
    const kind = KEYWORDS[m[1].toLowerCase()];
    if (kind === 'input' || kind === 'dropdown' || kind === 'search') { const sh = splitHint(m[2] ?? ''); return withLink({ kind, label: sh.label, keyword: true, ...(sh.hint !== undefined ? { hint: sh.hint } : {}) }); }
    if (kind) return withLink({ kind, label: (m[2] ?? '').trim(), keyword: true });
  }
  return withLink({ kind: 'text', label: t, keyword: false });
}

export interface Node { cells: Cell[]; children: Node[]; raw: string }

export function parseOutline(text: string): Node[] {
  const roots: Node[] = [];
  const stack: { level: number; node: Node }[] = [];
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (!line.trim()) continue;
    const lead = /^[ \t]*/.exec(line)![0];
    const level = lead.split('').reduce((n, ch) => n + (ch === '\t' ? 2 : 1), 0) >> 1;
    const content = line.trim();
    const node: Node = { cells: content.split('|').map(parseCell), children: [], raw: content };
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node); else roots.push(node);
    stack.push({ level, node });
  }
  return roots;
}

interface Ctx { W: number; phone: boolean }
interface Built { shapes: Shape[]; h: number; /** y offset of the primary shape inside the block */ py: number }

const PAD = 16;
const t = (s: string, x: number, y: number): Shape => ({ k: 'text', s, x: Math.round(x), y: Math.round(y) });

/** Height a (possibly multi-line) label needs beside its control: at least `min`, plus any extra lines. */
const labelH = (label: string, min: number) => (label ? Math.max(min, Math.round(textBlock(label).h + 6)) : min);

export function makeElement(kind: Kind, label: string, x: number, y: number, w: number, ctx: Ctx, hint = '', height?: number): Built {
  const ih = ctx.phone ? 48 : 44;
  switch (kind) {
    case 'input': case 'dropdown': case 'search':
    {
      // A dropdown shows its current choice with a chevron; a search box is a field that says Search.
      if (kind === 'dropdown') hint = (hint || 'Select') + '   \u25BE';
      if (kind === 'search') { hint = label || hint || 'Search'; label = ''; }
      // The label sits above the box; the ghost hint (placeholder) greyed inside it.
      const by = label ? y + 22 : y, ghost: Shape[] = hint ? [{ k: 'text', x: x + 12, y: by + Math.round(ih / 2) + 6, s: hint, ghost: true }] : [];
      return { shapes: [{ k: 'rect', x, y: by, w, h: ih, role: 'Input' }, ...(label ? [t(label, x, y + 14)] : []), ...ghost], h: (label ? 22 : 0) + ih, py: label ? 22 : 0 };
    }
    case 'button': {
      const text = label || 'Button';
      const bh = ctx.phone ? 48 : 40;
      const bw = Math.ceil((textWidth(text) + 48) / GRID) * GRID;
      return { shapes: [{ k: 'rect', x, y, w: bw, h: bh, role: 'Button' }, t(text, x + (bw - textWidth(text)) / 2, y + bh / 2 + 6)], h: bh, py: 0 };
    }
    case 'text': {
      // Body text wraps at the width it has (a narrow column, a card), instead of running out of its box.
      const wrapped = label && textWidth(label) > w ? wrapText(label, w).join('\n') : label;
      return { shapes: [t(wrapped || 'Text', x, y + 16)], h: wrapped ? Math.max(24, Math.round(textBlock(wrapped).h + 6)) : 24, py: 0 };
    }
    case 'card': { const h = height ?? 160; return { shapes: label ? [{ k: 'rect', x, y, w, h, role: 'Card' }, t(label, x + PAD, y + 32)] : [{ k: 'rect', x, y, w, h, role: 'Card' }], h, py: 0 }; } // >120 so a wide card is not a List item
    case 'image': { const h = height ?? (ctx.phone ? 140 : 160); return { shapes: [{ k: 'img', x, y, w, h }, ...(label ? [t(label, x + (w - textWidth(label)) / 2, y + h + 22)] : [])], h: label ? h + 30 : h, py: 0 }; }   // its description sits underneath
    case 'paragraph': { const h = label ? paraHeight(label, w) : 60; return { shapes: [label ? { k: 'tlines', x, y, w, h, s: label } : { k: 'tlines', x, y, w, h }], h, py: 0 }; }
    case 'divider': return { shapes: [{ k: 'line', x1: x, y1: y + 8, x2: x + w, y2: y + 8 }], h: 16, py: 8 };
    case 'avatar': return { shapes: [{ k: 'ell', x, y, w: 40, h: 40, role: 'Avatar' }], h: 40, py: 0 };
    case 'radio': return { shapes: [{ k: 'ell', x, y: y + 2, w: 20, h: 20, role: 'Radio' }, ...(label ? [t(label, x + 28, y + 17)] : [])], h: labelH(label, 24), py: 2 };
    case 'checkbox': return { shapes: [{ k: 'rect', x, y: y + 2, w: 20, h: 20, role: 'Checkbox' }, ...(label ? [t(label, x + 28, y + 17)] : [])], h: labelH(label, 24), py: 2 };
    case 'header': return { shapes: [{ k: 'rect', x, y, w, h: 56, role: 'Header' }, ...(label ? [t(label, x + PAD, y + 34)] : [])], h: 56, py: 0 };
    case 'badge': { const text = label || 'Tag', bw = Math.max(36, Math.ceil(textWidth(text) + 20)); return { shapes: [{ k: 'rect', x, y, w: bw, h: 28, role: 'Button', sm: true }, t(text, x + 10, y + 20)], h: 28, py: 0 }; }
    case 'columns': case 'toolbar': case 'segmented': return { shapes: [], h: 0, py: 0 }; // layout instructions, handled by layoutNodes
    case 'list': { const h = Math.max(56, labelH(label, 0) + 26); return { shapes: [{ k: 'rect', x, y, w, h, role: 'List item' }, ...(label ? [t(label, x + PAD, y + 34)] : [])], h, py: 0 }; }
  }
}

const FOLD_KINDS: Kind[] = ['radio', 'checkbox', 'list'];
function foldSubLabels(n: Node): Node {
  const c = n.cells[0];
  // Plain text indented under an input is its ghost hint (placeholder).
  if (n.cells.length === 1 && n.children.length && c.kind === 'input' && n.children.every((ch) => ch.cells.length === 1 && !ch.cells[0].keyword && !ch.children.length)) {
    return { ...n, cells: [{ ...c, hint: c.hint ?? n.children.map((ch) => ch.cells[0].label).join(' ') }], children: [] };
  }
  if (n.cells.length !== 1 || !n.children.length || !FOLD_KINDS.includes(c.kind)) return n;
  if (!n.children.every((ch) => ch.cells.length === 1 && !ch.cells[0].keyword && !ch.children.length)) return n;
  const label = [c.label, ...n.children.map((ch) => '  ' + ch.cells[0].label)].join('\n');
  return { ...n, cells: [{ ...c, label }], children: [] };
}

/** Lay out nodes top to bottom; each node is a row of cells or a card with children. */
/** A row of buttons too long for the width wraps onto further lines (a toolbar never runs off the edge). */
function wrapButtonRow(n: Node, w: number): Node[] {
  if (n.cells.length < 2 || n.children.length || !n.cells.every((c) => c.kind === 'button')) return [n];
  const need = (c: Cell) => Math.ceil((textBlock(c.label || 'Button').w + 48) / GRID) * GRID;
  const widest = Math.max(...n.cells.map(need));
  const perLine = Math.max(1, Math.floor((w + PAD) / (widest + PAD)));   // buttons in a row share one width, so the widest label sets how many fit
  if (n.cells.length <= perLine) return [n];
  const out: Node[] = [];
  for (let i = 0; i < n.cells.length; i += perLine) out.push({ ...n, cells: n.cells.slice(i, i + perLine), raw: n.raw });
  return out;
}

function layoutNodes(nodes: Node[], x: number, y: number, w: number, ctx: Ctx, gap: number, primaries: number[][], shapes: Shape[]): number {
  nodes = nodes.flatMap((n) => wrapButtonRow(n, w));
  let cy = y;
  // A run of two or more radio (or checkbox) lines is one group: remember where it started and box it when it ends.
  let run: { kind: Kind; start: number; count: number } | null = null;
  const flush = () => {
    if (run && run.count >= 2) shapes.push(borderFor(shapes.slice(run.start)));
    run = null;
  };
  nodes.forEach((n0, ni) => {
    // Plain text lines indented under a radio / checkbox / list item are its sub-labels, not nested elements.
    const n = foldSubLabels(n0);
    if (ni > 0) cy += gap;
    const only = n.cells.length === 1 && !n.children.length ? n.cells[0].kind : null;
    if (run && only !== run.kind) flush();
    if (n.cells[0].kind === 'toolbar' || n.cells[0].kind === 'segmented') {
      const seg = n.cells[0].kind === 'segmented';   // a button group: the buttons touch
      // "toolbar Find | All keys | Flow F": compact buttons sized to their labels, in a row that wraps only when it must.
      const bh = ctx.phone ? 36 : 28, sp = seg ? 0 : 6;
      // Every cell is a button label taken verbatim (so "Text T" stays "Text T", not the keyword "text"); "-> N" links it.
      const parts = n.raw.split('|').map((p, i) => (i === 0 ? p.trim().replace(/^(toolbar|tools|segmented|seg|tabs|btngroup)\b\s*/i, '') : p.trim()));
      const cells = parts.map((p) => { const m = /^([\s\S]*?)\s*->\s*(\S[\s\S]*)$/.exec(p); return { label: (m ? m[1] : p).trim(), link: m ? m[2].trim() : undefined }; }).filter((c) => c.label);
      const labels = cells.map((c) => c.label);
      let cx = x, line = cy;
      const prim: number[] = [];
      labels.forEach((label, ci) => {
        const bw = Math.max(36, Math.ceil(textWidth(label) + 20));
        if (cx > x && cx + bw > x + w) { cx = x; line += bh + 6; }
        const link = cells[ci].link;
        prim.push(shapes.length);
        shapes.push({ k: 'rect', x: cx, y: line, w: bw, h: bh, role: 'Button', sm: true, ...(link ? { link: '@' + link } : {}) }, t(label, cx + 10, line + bh / 2 + 6));
        cx += bw + sp;
      });
      primaries.push(prim);
      cy = line + bh;
      return;
    }
    if (n.cells.length === 1 && n.cells[0].kind === 'columns' && n.children.length) {
      // "columns" lays its children side by side ("columns 1:3" sets the widths); cards in the row stretch to the tallest.
      const k = n.children.length, label = n.cells[0].label.trim();
      const given = /^\d+(\.\d+)?(:\d+(\.\d+)?)+$/.test(label) ? label.split(':').map(Number) : [];
      const weights = given.length === k ? given : n.children.map(() => 1);
      const total = weights.reduce((a, b) => a + b, 0), avail = w - PAD * (k - 1);
      const spans: { cardIdx: number | null }[] = [];
      let cx = x, endMax = cy;
      n.children.forEach((child, ci) => {
        const colW = Math.floor((avail * weights[ci]) / total), sub: number[][] = [];
        endMax = Math.max(endMax, layoutNodes([child], cx, cy, colW, ctx, gap, sub, shapes));
        spans.push({ cardIdx: child.children.length && child.cells.length === 1 ? (sub[0]?.[0] ?? null) : null });
        primaries.push(...sub);
        cx += colW + PAD;
      });
      for (const s of spans) if (s.cardIdx !== null && shapes[s.cardIdx].k === 'rect') (shapes[s.cardIdx] as { h: number }).h = endMax - cy;
      cy = endMax;
      return;
    }
    if (n.children.length && n.cells.length === 1) {
      const c = n.cells[0];
      const title = c.kind === 'card' ? c.label : n.raw;
      // A card holding only radios / checkboxes is just their group: the title sits above the group's border, with no second box.
      const folded = n.children.map(foldSubLabels);
      if (c.kind === 'card' && folded.every((ch) => ch.cells.length === 1 && !ch.children.length && GROUPED_KINDS.includes(ch.cells[0].kind))) {
        const top = title ? 36 : 0;
        if (title) shapes.push(t(title, x, cy + 20));
        const sub: number[][] = [];
        const end = layoutNodes(folded, x + GROUP_PAD, cy + top + GROUP_PAD, w - 2 * GROUP_PAD, ctx, PAD, sub, shapes);
        primaries.push(...sub);
        cy = end + GROUP_PAD;
        return;
      }
      const rectIdx = shapes.length;
      shapes.push(c.link ? { k: 'rect', x, y: cy, w, h: 0, link: '@' + c.link, role: 'Card' } : { k: 'rect', x, y: cy, w, h: 0, role: 'Card' });
      let inner = cy + PAD;
      if (title) { shapes.push(t(title, x + PAD, cy + 32)); inner = cy + 32 + PAD; }
      const end = layoutNodes(n.children, x + PAD, inner, w - 2 * PAD, ctx, PAD, [], shapes);
      (shapes[rectIdx] as { h: number }).h = end + PAD - cy;
      primaries.push([rectIdx]);
      cy = end + PAD;
      return;
    }
    if (only && GROUPED_KINDS.includes(only)) { if (run) run.count++; else run = { kind: only, start: shapes.length, count: 1 }; }
    const cw = Math.floor((w - PAD * (n.cells.length - 1)) / n.cells.length);
    let rowH = 0;
    const prim: number[] = [];
    n.cells.forEach((c, ci) => {
      const cx = x + ci * (cw + PAD);
      const b = makeElement(c.kind, c.label, cx, cy, n.cells.length === 1 ? w : cw, ctx, c.hint ?? '', c.h);
      if (c.link && b.shapes[0] && b.shapes[0].k !== 'line') (b.shapes[0] as { link?: string }).link = '@' + c.link;
      prim.push(shapes.length);
      shapes.push(...b.shapes);
      rowH = Math.max(rowH, b.h);
    });
    primaries.push(prim);
    cy += rowH;
  });
  flush();
  return cy;
}

/** Fresh copies of a part's shapes with its top-left at (x, y), pulled back inside the frame if it would overhang. */
export function instantiate(part: Part, x: number, y: number, W?: number): Shape[] {
  const ox = W ? Math.max(GRID, Math.min(x, W - part.w - GRID)) : x;
  const tmp: Frame = { id: '', device: 'desktop', caption: '', shapes: part.shapes.map(cloneShape), notes: [] };
  tmp.shapes.forEach((_, j) => shift(tmp, j, ox, y));
  // Arrows in a copy are new arrows: fresh ids, with their labels pointing at the copies.
  const ids = new Map<string, string>();
  for (const sh of tmp.shapes) if ('id' in sh && sh.id) { const n = newId('a'); ids.set(sh.id, n); sh.id = n; }
  for (const sh of tmp.shapes) if (sh.k === 'text' && sh.of) { const n = ids.get(sh.of); if (n) sh.of = n; else delete sh.of; }
  return tmp.shapes;
}

/** Kinds that are entered one after another (Enter adds the next) and that radios/checkboxes group into a bordered set. */
export const CHAIN_KINDS: Kind[] = ['radio', 'checkbox', 'list'];
export const GROUPED_KINDS: Kind[] = ['radio', 'checkbox'];

/** Everything the slash command can make, for the pop-up list that appears when you type "/". */
export const STAMP_HELP: { name: string; also: string[]; hint: string }[] = [
  { name: 'radio', also: ['rb'], hint: 'radio buttons: /radio Contact by: Email, SMS (title optional; Enter adds the next)' },
  { name: 'checkbox', also: ['cb', 'check', 'tick'], hint: 'checkboxes: /cb Notify me: News, Offers (title optional; Enter adds the next)' },
  { name: 'button', also: ['btn'], hint: 'buttons side by side: /btn Save, Cancel' },
  { name: 'input', also: ['field'], hint: 'a labelled text field: /field Email' },
  { name: 'dropdown', also: ['select'], hint: 'a dropdown list: /dropdown Country "Pick one"' },
  { name: 'search', also: [], hint: 'a search box: /search or /search Find anything' },
  { name: 'segmented', also: ['seg', 'tabs', 'btngroup'], hint: 'a button group or tabs: /tabs Day, Week, Month' },
  { name: 'badge', also: ['tag', 'chip'], hint: 'a small pill: /badge New, Paid' },
  { name: 'text', also: [], hint: 'a line of text' },
  { name: 'card', also: ['box', 'section'], hint: 'a titled box: /card Details' },
  { name: 'header', also: ['nav', 'title', 'h'], hint: 'full-width top bar: /header Dashboard' },
  { name: 'list', also: ['item', 'row'], hint: 'list rows: /list Invoice 1042 (Enter adds the next)' },
  { name: 'image', also: ['img', 'pic', 'photo'], hint: 'an image placeholder' },
  { name: 'paragraph', also: ['para', 'p'], hint: 'body text lines (type the words in the Outline)' },
  { name: 'avatar', also: [], hint: 'a person icon' },
  { name: 'divider', also: ['hr', 'line'], hint: 'a horizontal rule' },
];

/** The stamps and saved parts whose name (or short name) matches what has been typed after the "/", best matches first (your parts lead). */
export function slashMatches(query: string, parts?: Record<string, Part>): { name: string; also: string[]; hint: string }[] {
  const q = query.trim().toLowerCase();
  const mine = Object.entries(parts ?? {}).map(([name, p]) => ({ name, also: [] as string[], hint: p.note || `your saved part, ${Math.round(p.w)}×${Math.round(p.h)}` }));
  const all = [...mine, ...STAMP_HELP];   // your own parts first: they are the ones easiest to forget
  if (!q) return all;
  // Best first: the name itself starts with it, then a short name does, then it appears somewhere (including the description).
  const rank = (s: { name: string; also: string[]; hint: string }) =>
    s.name.startsWith(q) ? 0 : s.also.some((n) => n.startsWith(q)) ? 1 : s.name.includes(q) || s.also.some((n) => n.includes(q)) || s.hint.toLowerCase().includes(q) ? 2 : 3;
  return all.map((s, i) => ({ s, r: rank(s), i })).filter((x) => x.r < 3).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.s);
}

/** "/radio Email, SMS" -> { kind, labels }. Unknown names give kind null; non-stamps give null. */
export function parseStamp(text: string, parts?: Record<string, Part>): { word: string; kind: Kind | 'part' | null; labels: string[] } | null {
  const m = /^\/\s*(\S+)\s*([\s\S]*)$/.exec(text.trim());
  if (!m) return null;
  const word = m[1].toLowerCase();
  const kind = parts?.[word] ? 'part' : ALIASES[word] ?? KEYWORDS[word] ?? null;
  const labels = m[2].split(',').map((l) => l.trim());
  if (labels.length > 1 && labels.every((l) => !l)) labels.length = 1;
  return { word, kind, labels };
}

/** Short names for the stamp command (/cb, /rb, /btn ...), on top of the outline keywords. */
export const ALIASES: Record<string, Kind> = {
  cb: 'checkbox', check: 'checkbox', tick: 'checkbox', rb: 'radio', btn: 'button', field: 'input', pic: 'image', photo: 'image', dd: 'dropdown',
  h: 'header', title: 'header', para: 'paragraph', line: 'divider', row: 'list', box: 'card',
};
const STAMP_W: Partial<Record<Kind, number>> = { input: 260, dropdown: 260, search: 260, card: 280, image: 200, paragraph: 300, divider: 240, list: 280, header: 0 };

/**
 * "/radio Email, SMS" typed at a spot on the canvas: the shapes for that element(s) with their top-left at (x, y).
 * Comma-separated labels make a stack (a row for buttons). Returns null for an unknown name.
 */
export function stampFromText(text: string, x: number, y: number, ctx: { W: number; phone: boolean }, parts?: Record<string, Part>): { shapes: Shape[]; kind: Kind | 'part' } | null {
  const m = /^\/\s*(\S+)\s*([\s\S]*)$/.exec(text.trim());
  if (!m) return null;
  const word = m[1].toLowerCase();
  if (parts?.[word]) return { shapes: instantiate(parts[word], x, y, ctx.W), kind: 'part' };
  const kind = ALIASES[word] ?? KEYWORDS[word];
  if (!kind) return null;
  // "/radio Contact by: Email, SMS": a title before the colon sits above the group's border.
  const tm = GROUPED_KINDS.includes(kind) ? /^([^,:]+):\s*([\s\S]*)$/.exec(m[2]) : null;
  const title = tm ? tm[1].trim() : '';
  const labels = (tm ? tm[2] : m[2]).split(',').map((l) => l.trim());
  if (labels.length > 1 && labels.every((l) => !l)) labels.length = 1;
  const shapes: Shape[] = [];
  let cx = x, cy = y + (title ? 36 : 0);
  if (kind === 'segmented') {
    // A button group: compact buttons that touch, sized to their labels.
    const bh = ctx.phone ? 36 : 28;
    for (const label of labels.filter(Boolean).slice(0, 12)) {
      const bw = Math.max(36, Math.ceil(textWidth(label) + 20));
      shapes.push({ k: 'rect', x: cx, y: cy, w: bw, h: bh, role: 'Button', sm: true }, t(label, cx + 10, cy + bh / 2 + 6));
      cx += bw;
    }
    return { shapes, kind };
  }
  for (const label of labels.slice(0, 12)) {
    const wide = kind === 'header';
    const w = wide ? ctx.W - 2 * GRID : STAMP_W[kind] ?? 200;
    const sh = kind === 'input' || kind === 'dropdown' ? splitHint(label) : { label, hint: undefined as string | undefined };
    const b = makeElement(kind, sh.label, wide ? GRID : cx, cy, w, ctx, sh.hint ?? '');
    shapes.push(...b.shapes);
    if (kind === 'button' || kind === 'badge') cx = Math.max(...b.shapes.map((s) => (s.k === 'rect' ? s.x + s.w : 0))) + 16;
    else cy += b.h + 10;
  }
  // Two or more radios / checkboxes are a group: give it a border.
  if (GROUPED_KINDS.includes(kind) && labels.slice(0, 12).length >= 2) shapes.unshift(borderFor(shapes));
  if (title) shapes.unshift(t(title, x, y + 20));
  return { shapes, kind };
}

export interface BuildResult { frame: Frame; added: number[]; /** primary shape index of the last placed element */ anchor: number | null }

/** Place the outline text under `anchor` (an element's primary shape index) or below the lowest shape. */
export function buildFromText(frame: Frame, text: string, anchor: number | null): BuildResult {
  const nodes = parseOutline(text);
  const f = cloneFrame(frame);
  if (!nodes.length) return { frame: f, added: [], anchor };
  const { w: W } = frameSize(f);
  const ctx: Ctx = { W, phone: f.device === 'phone' };
  const margin = GRID;
  let x = margin, y = margin, w = W - 2 * margin;
  const c = classify(f);
  const a = anchor !== null ? c.byIndex.get(anchor) : undefined;
  if (a) {
    const ab = bounds(f.shapes[a.i]);
    x = ab.x;
    y = ab.y + ab.h + PAD;
    const pb = a.parent !== null ? bounds(f.shapes[a.parent]) : null;
    w = (pb ? pb.x + pb.w - PAD : W - margin) - x;
    if (a.role === 'Input' || a.role === 'Checkbox' || a.role === 'Radio') y = Math.max(y, ab.y + ab.h + PAD);
  } else if (f.shapes.length) {
    y = Math.max(...f.shapes.map((s) => { const b = bounds(s); return b.y + b.h; })) + PAD;
  }
  const newShapes: Shape[] = [];
  const prims: number[][] = [];
  const end = layoutNodes(nodes, x, y, w, ctx, PAD, prims, newShapes);
  const dh = end - y + PAD;
  if (a) {
    const ab = bounds(f.shapes[a.i]);
    for (const s of f.shapes) {
      const b = bounds(s);
      if (b.y >= y - 4) {
        if (s.k === 'line') { s.y1 += dh; s.y2 += dh; if (s.via) s.via = s.via.map(([vx, vy]) => [vx, vy + dh]); } else if (s.k === 'free') s.pts = s.pts.map(([px, py]) => [px, py + dh]);
        else s.y += dh;
      }
    }
    for (const s of f.shapes) if (s.k === 'rect' && s.y < y - 4 && contains(bounds(s), ab) && s !== f.shapes[a.i]) s.h += dh;
  }
  const base = f.shapes.length;
  f.shapes.push(...newShapes);
  refitBorders(f);
  const last = prims[prims.length - 1];
  return { frame: f, added: newShapes.map((_, i) => base + i), anchor: base + last[last.length - 1] };
}

// ---------- outline row edits ----------

/** Set (or create) the label of an element in the right place for its role. */
/** Height a row of this role takes for a label: a radio/checkbox/text row, or a list item whose box grows with its lines. */
function rowHeight(role: string, label: string): number {
  const blk = label ? textBlock(label).h : 0;
  return role === 'List item' ? Math.max(56, Math.round(blk + 26)) : Math.max(24, Math.round(blk + 6));
}

/** After a label gained or lost lines: grow/shrink its row and move everything below (and any border around it) by the difference. */
function reflowRow(f: Frame, el: El, oldText: string, newText: string) {
  const shape = f.shapes[el.i];
  const d = rowHeight(el.role, newText) - rowHeight(el.role, oldText);
  if (!d || !['Radio', 'Checkbox', 'List item', 'Text'].includes(el.role)) return;
  const b = bounds(shape);
  const top = el.role === 'Text' ? b.y : b.y, bottom = top + rowHeight(el.role, oldText);
  if (el.role === 'List item' && shape.k === 'rect') shape.h += d;
  const own = new Set<number>([el.i, ...(el.labelIdx !== null ? [el.labelIdx] : [])]);
  f.shapes.forEach((o, j) => {
    if (own.has(j)) return;
    const ob = bounds(o);
    if (o.k === 'rect' && contains(ob, b) && ob.h > b.h) { o.h += d; return; }  // a border or card around this row grows with it
    if (ob.y >= bottom - 4) {
      if (o.k === 'line') { o.y1 += d; o.y2 += d; if (o.via) o.via = o.via.map(([vx, vy]) => [vx, vy + d]); }
      else if (o.k === 'free') o.pts = o.pts.map(([px, py]) => [px, py + d]);
      else o.y += d;
    }
  });
}

export function setLabel(frame: Frame, el: El, text: string): Frame {
  const f = cloneFrame(frame);
  const s = f.shapes[el.i];
  if (el.role === 'Text' && s.k === 'text') { const old = s.s; s.s = text; reflowRow(f, el, old, text); refitBorders(f); return f; }
  if (s.k === 'tlines') {
    // Paragraph copy lives on the shape itself; fit its height to the copy and move whatever sits below by the same amount.
    if (text) s.s = text; else delete s.s;
    const need = text ? paraHeight(text, s.w) : 60, old = s.h;
    if (need !== old) {   // fit the copy exactly: grow or shrink, and move what is below by the difference
      const bottom = s.y + old;
      s.h = need;
      for (const o of f.shapes) {
        if (o === s) continue;
        const ob = bounds(o);
        if (ob.y >= bottom - 4) {
          if (o.k === 'line') { o.y1 += need - old; o.y2 += need - old; if (o.via) o.via = o.via.map(([vx, vy]) => [vx, vy + need - old]); }
          else if (o.k === 'free') o.pts = o.pts.map(([px, py]) => [px, py + need - old]);
          else o.y += need - old;
        }
      }
    }
    return f;
  }
  if (el.labelIdx !== null) {
    const l = f.shapes[el.labelIdx];
    if (l.k === 'text') { const old = l.s; l.s = text; reflowRow(f, el, old, text); refitBorders(f); }
    return f;
  }
  if (!text) return f;
  if (s.k === 'line') { const sp = lineLabelSpot(s, text); f.shapes.push(t(text, Math.round(sp.x), Math.round(sp.y))); return f; }
  const b = bounds(s);
  const mid = b.y + b.h / 2 + 6;
  let pos: [number, number];
  switch (el.role) {
    case 'Button': pos = [b.x + (b.w - textWidth(text)) / 2, mid]; break;
    case 'Input': pos = [b.x, b.y - 8]; break;
    case 'Card': case 'Sidebar': pos = [b.x + PAD, b.y + 32]; break;
    case 'Checkbox': case 'Radio': pos = [b.x + b.w + 8, mid]; break;
    case 'Header': case 'List item': pos = [b.x + PAD, mid]; break;
    case 'Image': pos = [b.x + (b.w - textWidth(text)) / 2, b.y + b.h + 24]; break;
    default: return f;
  }
  f.shapes.push(t(text, pos[0], pos[1]));
  return f;
}

/** Keyword at the start of `text` that maps to a role different from the element's current one. */
export function kindChange(el: El, text: string): Cell | null {
  const c = parseCell(text);
  if (!c.keyword) return null;
  return ROLE_OF_KIND[c.kind] !== el.role ? c : null;
}

/** Convert an element in place to another kind; returns the new frame and the element's new index. */
export function convertElement(frame: Frame, el: El, cell: Cell): { frame: Frame; index: number } {
  const f = cloneFrame(frame);
  const { w: W } = frameSize(f);
  const ctx: Ctx = { W, phone: f.device === 'phone' };
  const b = bounds(f.shapes[el.i]);
  const wide = cell.kind === 'header';
  const x = wide ? GRID : b.x;
  const w = wide ? W - 2 * GRID : Math.max(b.w, 40);
  const built = makeElement(cell.kind, cell.label, x, 0, w, ctx, cell.kind === 'input' ? (cell.hint ?? el.hint) : '');
  const dy = b.y - built.py;
  for (const s of built.shapes) {
    if (s.k === 'line') { s.y1 += dy; s.y2 += dy; if (s.via) s.via = s.via.map(([vx, vy]) => [vx, vy + dy]); } else if (s.k === 'text' || s.k !== 'free') s.y += dy;
  }
  const slots: (Shape | null)[] = f.shapes.slice();
  const [prim, ...rest] = built.shapes;
  const ghosts = rest.filter((s) => s.k === 'text' && s.ghost), extras = rest.filter((s) => !(s.k === 'text' && s.ghost));
  slots[el.i] = prim;
  if (el.labelIdx !== null) slots[el.labelIdx] = extras.shift() ?? null;
  if (el.ghostIdx !== null) slots[el.ghostIdx] = ghosts.shift() ?? null;
  extras.push(...ghosts);
  const out: Shape[] = [];
  let index = 0;
  slots.forEach((s, i) => { if (s) { if (i === el.i) index = out.length; out.push(s); } });
  out.push(...extras);
  f.shapes = out;
  return { frame: f, index };
}

export function deleteShapes(frame: Frame, idxs: number[]): Frame {
  const f = cloneFrame(frame);
  const drop = new Set(idxs);
  f.shapes = f.shapes.filter((_, i) => !drop.has(i));
  return f;
}

export function deleteElement(frame: Frame, el: El): Frame {
  return deleteShapes(frame, [el.i, ...(el.labelIdx !== null ? [el.labelIdx] : []), ...(el.ghostIdx !== null ? [el.ghostIdx] : [])]);
}

/** Set, change or clear an input's ghost hint (the greyed placeholder inside the box). */
export function setHint(frame: Frame, el: El, text: string): Frame {
  const f = cloneFrame(frame);
  const r = f.shapes[el.i];
  if (r.k !== 'rect') return f;
  const t = text.trim();
  if (el.ghostIdx !== null) {
    if (t) (f.shapes[el.ghostIdx] as { s: string }).s = t;
    else f.shapes.splice(el.ghostIdx, 1);
  } else if (t) f.shapes.push({ k: 'text', x: r.x + 12, y: r.y + Math.round(r.h / 2) + 6, s: t, ghost: true });
  return f;
}
