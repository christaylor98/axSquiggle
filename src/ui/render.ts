import { rotOf, rotatePt } from '../core/rotate';
import { bounds, center, justifyDx, linePts, paragraphDy, PARA_LINE, SUB_PX, textLines, wrapText, type Box } from '../core/geom';
import { arrowHead, avatarGlyphs, freePath, HAND_FONT, lineD, lineHops, pathHead, tlineCount, type Hop } from '../core/exporters';
import { frameSize, GRID, type Frame, type Note, type Pt, type Shape } from '../core/types';
import type { Classified } from '../core/semantics';

export interface Theme { paper: string; ink: string; grey: string; grid: string; accent: string }
export const LIGHT: Theme = { paper: '#ffffff', ink: '#1f2328', grey: '#9aa0a6', grid: 'rgba(0,0,0,.16)', accent: '#e8590c' };
export const DARK: Theme = { paper: '#1c1f24', ink: '#e8e8e8', grey: '#6f757c', grid: 'rgba(255,255,255,.16)', accent: '#ff8a3d' };
export const currentTheme = (): Theme => (window.matchMedia('(prefers-color-scheme: dark)').matches ? DARK : LIGHT);

export interface DrawOpts {
  scale: number;
  theme: Theme;
  grid?: boolean;
  classified?: Classified | null; // draws role tags when present
  sel?: number | null;
  more?: number[];      // extra selected shapes (multi-select)
  frameNo?: (id: string) => number | null; // frame id -> 1-based number, so link badges can say where they lead
  play?: boolean;       // click-through: hint every link, hide editing furniture
  marquee?: Box | null; // rubber-band rectangle while dragging
  hover?: number | null;
  ghost?: Pt[] | null;
  ghostColor?: string;
  pins?: boolean;
  focus?: number[];
  focusBox?: Box | null;
  handles?: boolean;
  turn?: boolean;       // Shift held: the corners of the selection are turn handles (little turn arrows)
}

const imgCache = new Map<string, HTMLImageElement>();
export function bgImage(f: Frame, onLoad: () => void): HTMLImageElement | null {
  if (!f.bg) return null;
  const key = f.bg.length + f.bg.slice(-64);
  let im = imgCache.get(key);
  if (!im) {
    im = new Image();
    im.onload = onLoad;
    im.src = f.bg;
    imgCache.set(key, im);
    if (imgCache.size > 20) imgCache.delete(imgCache.keys().next().value!);
  }
  return im.complete && im.naturalWidth ? im : null;
}

const picCache = new Map<string, HTMLImageElement>();
const picWaiting = new Map<string, Set<() => void>>();   // everything that drew the picture before it loaded (the canvas, thumbnails) wants a redraw
let picLoad: () => void = () => {};
/** The picture an Image element shows (null until it has loaded; the redraw callback of the frame being drawn is called then). */
function picOf(src: string): HTMLImageElement | null {
  let im = picCache.get(src);
  if (!im) {
    im = new Image(); im.onload = () => { for (const fn of picWaiting.get(src) ?? []) fn(); picWaiting.delete(src); }; im.src = src;
    picCache.set(src, im);
    if (picCache.size > 40) picCache.delete(picCache.keys().next().value!);
  }
  if (im.complete && im.naturalWidth) return im;
  (picWaiting.get(src) ?? picWaiting.set(src, new Set()).get(src)!).add(picLoad);
  return null;
}

/** Turn the canvas about a shape's centre while `fn` draws it (a no-op for shapes that are not turned). */
function turned(ctx: CanvasRenderingContext2D, s: Shape, fn: () => void) {
  const r = rotOf(s);
  if (!r) { fn(); return; }
  const c = center(bounds(s));
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate((r * Math.PI) / 180); ctx.translate(-c.x, -c.y);
  fn();
  ctx.restore();
}

export function drawShape(ctx: CanvasRenderingContext2D, s: Shape, t: Theme, hops?: Hop[]) {
  turned(ctx, s, () => drawShapeRaw(ctx, s, t, hops));
}

function drawShapeRaw(ctx: CanvasRenderingContext2D, s: Shape, t: Theme, hops?: Hop[]) {
  ctx.strokeStyle = t.ink; ctx.fillStyle = t.ink; ctx.lineWidth = 2.25; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (s.k) {
    case 'rect': ctx.roundRect(s.x, s.y, s.w, s.h, 3); ctx.stroke(); break;
    case 'ell': ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.abs(s.w / 2), Math.abs(s.h / 2), 0, 0, Math.PI * 2); ctx.stroke(); break;
    case 'img': {
      const pic = s.src ? picOf(s.src) : null;
      if (s.src) {   // a real picture: fills the box (cropped to fit, never squashed), no crossed placeholder
        ctx.save(); ctx.beginPath(); ctx.roundRect(s.x, s.y, s.w, s.h, 3); ctx.clip();
        if (pic) { const k = Math.max(s.w / pic.naturalWidth, s.h / pic.naturalHeight), iw = pic.naturalWidth * k, ih = pic.naturalHeight * k; ctx.drawImage(pic, s.x + (s.w - iw) / 2, s.y + (s.h - ih) / 2, iw, ih); }
        else { ctx.fillStyle = t.grey; ctx.globalAlpha = 0.25; ctx.fillRect(s.x, s.y, s.w, s.h); }
        ctx.restore();
        ctx.beginPath(); ctx.roundRect(s.x, s.y, s.w, s.h, 3); ctx.stroke(); break;
      }
      ctx.roundRect(s.x, s.y, s.w, s.h, 3);
      ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + s.w, s.y + s.h);
      ctx.moveTo(s.x + s.w, s.y); ctx.lineTo(s.x, s.y + s.h);
      ctx.stroke(); break;
    }
    case 'tlines': {
      if (s.s) {
        // Real paragraph copy: wrapped hand-lettered text, clipped to its box.
        ctx.save();
        ctx.beginPath(); ctx.rect(s.x, s.y, s.w, s.h); ctx.clip();
        ctx.font = `18px ${HAND_FONT}`; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = t.ink;
        { const ls = wrapText(s.s, s.w), dy = paragraphDy(ls.length, s.h, s.av); ls.forEach((ln, i) => ctx.fillText(ln, s.x + justifyDx(ln, s.w, s.al), s.y + dy + 18 + i * PARA_LINE)); }
        ctx.restore();
        break;
      }
      const n = tlineCount(s.h);
      ctx.strokeStyle = t.grey;
      for (let i = 0; i < n; i++) {
        const y = s.y + (s.h * (i + 0.5)) / n;
        ctx.moveTo(s.x, y); ctx.lineTo(s.x + (i === n - 1 && n > 1 ? s.w * 0.6 : s.w), y);
      }
      ctx.stroke(); break;
    }
    case 'line':
      { const lp = linePts(s); ctx.stroke(new Path2D(lineD(s, hops))); ctx.beginPath();
        if (s.arrow) { const pv = lp[lp.length - 2]; const [ax, ay, bx, by] = arrowHead(pv.x, pv.y, s.x2, s.y2); ctx.moveTo(ax, ay); ctx.lineTo(s.x2, s.y2); ctx.lineTo(bx, by); }
        if (s.tail) { const nx = lp[1]; const [ax, ay, bx, by] = arrowHead(nx.x, nx.y, s.x1, s.y1); ctx.moveTo(ax, ay); ctx.lineTo(s.x1, s.y1); ctx.lineTo(bx, by); } }
      ctx.stroke(); break;
    case 'text':
      ctx.textBaseline = 'alphabetic';
      for (const l of textLines(s.s, s.wrap, s.al)) {
        ctx.font = `${s.ghost ? 'italic ' : ''}${l.sub ? SUB_PX : 18}px ${HAND_FONT}`;
        ctx.fillStyle = l.sub || s.ghost ? t.grey : t.ink;
        ctx.fillText(l.text, s.x + (l.dx ?? 0), s.y + l.dy);
      }
      break;
    case 'free': {
      ctx.stroke(new Path2D(freePath(s.pts)));
      if (s.arrow) { const [ax, ay, bx, by] = pathHead(s.pts), [ex, ey] = s.pts[s.pts.length - 1]; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ex, ey); ctx.lineTo(bx, by); ctx.stroke(); }
      break;
    }
  }
}

export const HANDLE_IDS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type HandleId = (typeof HANDLE_IDS)[number] | 'p1' | 'p2';

export function handlePoints(s: Shape): { id: HandleId; x: number; y: number }[] {
  if (s.k === 'line') return [{ id: 'p1', x: s.x1, y: s.y1 }, { id: 'p2', x: s.x2, y: s.y2 }];
  const b = bounds(s);
  const xs = [b.x, b.x + b.w / 2, b.x + b.w], ys = [b.y, b.y + b.h / 2, b.y + b.h];
  // Text sizes itself, so it only gets its four corners (to turn it); everything else can also be resized.
  const all: { id: HandleId; x: number; y: number }[] = [
    { id: 'nw', x: xs[0], y: ys[0] }, { id: 'n', x: xs[1], y: ys[0] }, { id: 'ne', x: xs[2], y: ys[0] }, { id: 'e', x: xs[2], y: ys[1] },
    { id: 'se', x: xs[2], y: ys[2] }, { id: 's', x: xs[1], y: ys[2] }, { id: 'sw', x: xs[0], y: ys[2] }, { id: 'w', x: xs[0], y: ys[1] },
  ];
  const hs = s.k === 'text' ? all.filter((h) => h.id.length === 2) : all;
  const r = rotOf(s), c = center(b);
  return r ? hs.map((h) => ({ ...h, ...rotatePt(h, c, r) })) : hs;
}

/** A small circular arrow: the corner handle in turn mode. */
function turnGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: Theme) {
  ctx.save();
  ctx.fillStyle = t.paper; ctx.strokeStyle = t.accent; ctx.lineWidth = 1.7 * (r / 9) * (r > 4 ? 1 : 1) ; ctx.lineCap = 'round'; ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(x, y, r * 1.35, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r * 0.8, -0.6, Math.PI * 1.45); ctx.stroke();                 // the arc
  const a = Math.PI * 1.45, ex = x + r * 0.8 * Math.cos(a), ey = y + r * 0.8 * Math.sin(a);   // the head, at the arc's end
  ctx.beginPath(); ctx.moveTo(ex - r * 0.55, ey + r * 0.05); ctx.lineTo(ex, ey); ctx.lineTo(ex + r * 0.1, ey + r * 0.6); ctx.stroke();
  ctx.restore();
}

function outline(ctx: CanvasRenderingContext2D, s: Shape, color: string, lw: number, pad = 3) {
  const b = bounds(s);
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.setLineDash([5, 4]);
  turned(ctx, s, () => ctx.strokeRect(b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad));
  ctx.restore();
}

/** A small "→2" tag on each element that leads to another frame ("→?" when that frame is gone). */
function drawLinks(ctx: CanvasRenderingContext2D, f: Frame, o: DrawOpts, t: Theme) {
  ctx.save();
  ctx.font = `700 ${10}px ui-monospace, Menlo, Consolas, monospace`; ctx.textBaseline = 'middle';
  for (const s of f.shapes) {
    const link = (s as { link?: string }).link;
    if (!link) continue;
    const b = bounds(s), n = o.frameNo!(link), label = `→${n ?? '?'}`, tw = ctx.measureText(label).width + 8;
    if (o.play) { ctx.strokeStyle = t.accent; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6); ctx.setLineDash([]); }
    const x = b.x - 3, y = b.y - 15;
    ctx.fillStyle = n === null ? t.grey : t.accent;
    ctx.beginPath(); ctx.roundRect(x, y, tw, 13, 4); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(label, x + 4, y + 7);
  }
  ctx.restore();
}

export function drawFrame(ctx: CanvasRenderingContext2D, f: Frame, o: DrawOpts, onBgLoad: () => void = () => {}) {
  const { w, h } = frameSize(f);
  const t = o.theme;
  picLoad = onBgLoad;
  ctx.fillStyle = t.paper; ctx.fillRect(0, 0, w, h);
  const bg = bgImage(f, onBgLoad);
  if (bg) {
    const k = Math.min(w / bg.naturalWidth, h / bg.naturalHeight);
    const iw = bg.naturalWidth * k, ih = bg.naturalHeight * k;
    ctx.globalAlpha = 0.45; ctx.drawImage(bg, (w - iw) / 2, (h - ih) / 2, iw, ih); ctx.globalAlpha = 1;
  }
  if (o.grid) {
    ctx.fillStyle = t.grid;
    for (let x = GRID; x < w; x += GRID) for (let y = GRID; y < h; y += GRID) ctx.fillRect(x - 0.75 / o.scale, y - 0.75 / o.scale, 1.5 / o.scale, 1.5 / o.scale);
  }
  const hp = lineHops(f);
  f.shapes.forEach((s, i) => drawShape(ctx, s, t, hp.get(i)));
  for (const d of avatarGlyphs(f).values()) { ctx.save(); ctx.strokeStyle = t.ink; ctx.lineWidth = 2.25; ctx.lineCap = 'round'; ctx.stroke(new Path2D(d)); ctx.restore(); }
  if (o.frameNo) drawLinks(ctx, f, o, t);

  if (o.focus?.length) for (const i of o.focus) if (f.shapes[i]) outline(ctx, f.shapes[i], t.accent, 1.5, 4);
  if (o.hover != null && f.shapes[o.hover]) {
    outline(ctx, f.shapes[o.hover], t.accent, 2.5, 5);
    const lbl = o.classified?.byIndex.get(o.hover)?.labelIdx;
    if (lbl != null) outline(ctx, f.shapes[lbl], t.accent, 1.5, 3);
  }
  if (o.classified) {
    ctx.font = '600 10px ui-monospace, Menlo, Consolas, monospace'; ctx.fillStyle = t.accent; ctx.textBaseline = 'alphabetic';
    for (const e of o.classified.els) {
      const b = bounds(f.shapes[e.i]);
      const tag = e.role.toLowerCase();
      ctx.fillText(tag, Math.max(0, b.x + b.w - ctx.measureText(tag).width), Math.max(9, b.y - 4));
    }
  }
  for (const j of o.more ?? []) if (f.shapes[j]) outline(ctx, f.shapes[j], t.accent, 1.5, 4);
  if (o.marquee) {
    const m = o.marquee;
    ctx.save(); ctx.strokeStyle = t.accent; ctx.fillStyle = 'rgba(232,89,12,.08)'; ctx.lineWidth = 1.25 / o.scale; ctx.setLineDash([5 / o.scale, 4 / o.scale]);
    ctx.fillRect(m.x, m.y, m.w, m.h); ctx.strokeRect(m.x, m.y, m.w, m.h); ctx.restore();
  }
  if (o.sel != null && f.shapes[o.sel]) {
    const s = f.shapes[o.sel];
    outline(ctx, s, t.accent, 1.5, 4);
    if (o.handles !== false && !(o.more && o.more.length)) {
      const sz = 8 / o.scale;
      ctx.fillStyle = t.paper; ctx.strokeStyle = t.accent; ctx.lineWidth = 1.5 / o.scale; ctx.setLineDash([]);
      for (const hp of handlePoints(s)) {
        const corner = hp.id.length === 2 && hp.id !== 'p1' && hp.id !== 'p2';
        if (corner && (o.turn || s.k === 'text')) turnGlyph(ctx, hp.x, hp.y, 9 / o.scale, t);
        else { ctx.fillRect(hp.x - sz / 2, hp.y - sz / 2, sz, sz); ctx.strokeRect(hp.x - sz / 2, hp.y - sz / 2, sz, sz); }
      }
    }
  }
  if (o.focusBox) {
    const b = o.focusBox, pad = 14;
    ctx.save(); ctx.strokeStyle = t.accent; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2 + pad * 1.4, b.h / 2 + pad, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  if (o.pins) drawPins(ctx, f.notes, t);
  if (o.ghost && o.ghost.length > 1) {
    ctx.save(); ctx.strokeStyle = o.ghostColor ?? 'rgba(255,140,0,.45)'; ctx.lineWidth = 2.25; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); o.ghost.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); ctx.restore();
  }
}

function drawPins(ctx: CanvasRenderingContext2D, notes: Note[], t: Theme) {
  notes.forEach((n, i) => {
    const x = n.box[0], y = n.box[1];
    ctx.save();
    ctx.fillStyle = t.accent; ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x, y + 0.5);
    ctx.restore();
  });
}
