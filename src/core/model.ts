import { LABEL_J, LABEL_V, type LabelJ, type LabelV } from './types';
import { cloneBoard, DEVICES, newFrame, newId, type Board, type Device, type Frame, type Note, type Part, type Shape } from './types';
import { classify, smartSize } from './semantics';
import { buildFromText } from './layout';
import { makePart } from './parts';
import { textWidth } from './geom';

const LIM = 5000;
const num = (v: unknown, d?: number): number | null => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= LIM ? v : d ?? null);

const ROLES = ['Checkbox', 'Header', 'List item', 'Sidebar', 'Button', 'Input', 'Card', 'Image', 'Paragraph', 'Divider', 'Arrow', 'Connector', 'Sketch', 'Avatar', 'Radio', 'Circle', 'Text'] as const;
const ID_RE = /^[\w-]{1,24}$/;
const linkOf = (v: unknown): string | null => (typeof v === 'string' && ID_RE.test(v) ? v : null);

/** Validate and sanitise one shape; returns null when it is unusable. */
export function validateShape(v: unknown): Shape | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  switch (o.k) {
    case 'rect': case 'ell': case 'img': case 'tlines': {
      const x = num(o.x), y = num(o.y), w = num(o.w), h = num(o.h);
      if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) return null;
      const sh: Shape = o.k === 'tlines' && typeof o.s === 'string' && o.s ? { k: 'tlines', x, y, w, h, s: o.s.slice(0, 2000) } : { k: o.k, x, y, w, h };
      const lk = linkOf(o.link); if (lk) (sh as { link?: string }).link = lk;
      if (o.k === 'rect' && o.grp === true) (sh as { grp?: boolean }).grp = true;
      if (o.k === 'rect' && o.sm === true) (sh as { sm?: boolean }).sm = true;
      if ((o.k === 'rect' || o.k === 'ell') && typeof o.role === 'string' && (ROLES as readonly string[]).includes(o.role)) (sh as { role?: string }).role = o.role;
      const rt = num(o.rot); if (rt && Math.abs(rt) < 360) (sh as { rot?: number }).rot = Math.round(rt * 100) / 100;
      if (o.k === 'img' && typeof o.src === 'string' && /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(o.src) && o.src.length <= 900000) { (sh as { src?: string }).src = o.src; if (typeof o.fn === 'string' && o.fn) (sh as { fn?: string }).fn = o.fn.slice(0, 120); }
      if (o.k !== 'tlines' && typeof o.id === 'string' && /^[\w-]{1,24}$/.test(o.id)) (sh as { id?: string }).id = o.id;
      if (o.k === 'tlines' && (o.al === 'center' || o.al === 'right')) (sh as { al?: 'center' | 'right' }).al = o.al;
      if (o.k === 'tlines' && (o.av === 'middle' || o.av === 'bottom')) (sh as { av?: 'middle' | 'bottom' }).av = o.av;
      if (o.k === 'rect' || o.k === 'ell') {
        const lv = o.lbl, lj = o.lj, h = sh as { lbl?: LabelV; lj?: LabelJ };
        if (typeof lv === 'string' && (LABEL_V as readonly string[]).includes(lv)) h.lbl = lv as LabelV;
        else if (lv === 'left' || lv === 'right') { h.lbl = 'middle'; h.lj = lv; }   // boards saved before the two settings were split
        else if (lv === 'center') h.lbl = 'middle';
        if (typeof lj === 'string' && (LABEL_J as readonly string[]).includes(lj)) h.lj = lj as LabelJ;
      }
      return sh;
    }
    case 'line': {
      const x1 = num(o.x1), y1 = num(o.y1), x2 = num(o.x2), y2 = num(o.y2);
      if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
      const via = Array.isArray(o.via) && o.via.length <= 40
        ? o.via.map((q) => (Array.isArray(q) && q.length === 2 ? [num(q[0]), num(q[1])] : null))
        : [];
      const okVia = via.length > 0 && via.every((q) => q && q[0] !== null && q[1] !== null) ? (via as number[][]) : undefined;
      const ln: Shape = o.arrow === true ? { k: 'line', x1, y1, x2, y2, arrow: true } : { k: 'line', x1, y1, x2, y2 };
      if (okVia) (ln as { via?: number[][] }).via = okVia;
      if (o.tail === true) (ln as { tail?: boolean }).tail = true;
      if (o.conn === true) (ln as { conn?: boolean }).conn = true;
      if (typeof o.id === 'string' && /^[\w-]{1,24}$/.test(o.id)) (ln as { id?: string }).id = o.id;
      if (typeof o.hop === 'boolean') (ln as { hop?: boolean }).hop = o.hop;
      return ln;
    }
    case 'text': {
      const x = num(o.x), y = num(o.y);
      if (x === null || y === null || typeof o.s !== 'string') return null;
      const t: Shape = { k: 'text', x, y, s: o.s.slice(0, 300) };
      const lk = linkOf(o.link); if (lk) (t as { link?: string }).link = lk;
      if (o.ghost === true) (t as { ghost?: boolean }).ghost = true;
      if (o.free === true) (t as { free?: boolean }).free = true;
      if (typeof o.of === 'string' && /^[\w-]{1,24}$/.test(o.of)) (t as { of?: string }).of = o.of;
      if (o.al === 'center' || o.al === 'right') (t as { al?: 'center' | 'right' }).al = o.al;
      const wr = num(o.wrap); if (wr && wr >= 20 && wr <= 2000) (t as { wrap?: number }).wrap = Math.round(wr);
      const rt = num(o.rot); if (rt && Math.abs(rt) < 360) (t as { rot?: number }).rot = Math.round(rt * 100) / 100;
      return t;
    }
    case 'free': {
      if (!Array.isArray(o.pts) || o.pts.length < 2 || o.pts.length > 3000) return null;
      const pts: number[][] = [];
      for (const p of o.pts) {
        if (!Array.isArray(p)) return null;
        const px = num(p[0]), py = num(p[1]);
        if (px === null || py === null) return null;
        pts.push([px, py]);
      }
      return o.arrow === true ? { k: 'free', pts, arrow: true } : { k: 'free', pts };
    }
    default: return null;
  }
}

function validateNote(v: unknown): Note | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.text !== 'string' || !Array.isArray(o.box) || o.box.length !== 4) return null;
  const box = o.box.map((n) => num(n));
  if (box.some((n) => n === null)) return null;
  const about = Array.isArray(o.about) ? o.about.filter((a): a is string => typeof a === 'string').slice(0, 20) : [];
  const n: Note = { id: linkOf(o.id) ?? newId('n'), text: o.text.slice(0, 2000), box: box as Note['box'], about };
  if (o.done === true) n.done = true;
  if (typeof o.reply === 'string' && o.reply) n.reply = o.reply.slice(0, 500);
  return n;
}

export function validateFrame(v: unknown): Frame | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.shapes)) return null;
  const device: Device = o.device === 'phone' ? 'phone' : 'desktop';
  const f = newFrame(device, typeof o.caption === 'string' ? o.caption.slice(0, 300) : '');
  f.id = linkOf(o.id) ?? f.id;
  const fh = num(o.h); if (fh !== null && fh > DEVICES[device].h && fh <= 4000) f.h = Math.round(fh);
  f.shapes = o.shapes.map(validateShape).filter((s): s is Shape => s !== null);
  if (Array.isArray(o.notes)) f.notes = o.notes.map(validateNote).filter((n): n is Note => n !== null);
  if (typeof o.bg === 'string' && o.bg.startsWith('data:image/')) f.bg = o.bg;
  return f;
}

/** Accepts a stored/pasted board (or a bare frames array). Returns null if nothing usable. */
export function validateBoard(v: unknown): Board | null {
  const src = Array.isArray(v) ? { frames: v } : v;
  if (!src || typeof src !== 'object' || !Array.isArray((src as { frames?: unknown }).frames)) return null;
  const frames = ((src as { frames: unknown[] }).frames).map(validateFrame).filter((f): f is Frame => f !== null);
  if (!frames.length) return null;
  const seen = new Set<string>();
  for (const f of frames) { while (seen.has(f.id)) f.id = newId('f'); seen.add(f.id); } // ids must be unique across the board
  const out: Board = { frames };
  if ((src as { example?: unknown }).example === true) out.example = true;
  const parts = validateParts((src as { parts?: unknown }).parts);
  if (parts) out.parts = parts;
  return out;
}

/** Reusable parts: names are lowercase slugs; each part's shapes are validated like any other. */
export function validateParts(v: unknown): Record<string, Part> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const out: Record<string, Part> = {};
  for (const [name, raw] of Object.entries(v as Record<string, unknown>).slice(0, 50)) {
    if (!/^[a-z0-9][a-z0-9_-]{0,23}$/.test(name) || !raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const w = num(o.w), h = num(o.h);
    if (w === null || h === null || !Array.isArray(o.shapes)) continue;
    const shapes = o.shapes.slice(0, 200).map(validateShape).filter((s): s is Shape => s !== null);
    const note = typeof o.note === 'string' && o.note.trim() ? o.note.trim().slice(0, 120) : undefined;
    if (shapes.length) out[name] = { w, h, shapes, ...(note ? { note } : {}) };
  }
  return Object.keys(out).length ? out : undefined;
}

export const toRawJSON = (b: Board): string => JSON.stringify({ axsquiggle: 1, frames: b.frames, ...(b.parts ? { parts: b.parts } : {}) }, null, 1);

export function fromRawJSON(text: string): Board | null {
  try { return validateBoard(JSON.parse(text)); } catch { return null; }
}

export const freshBoard = (): Board => ({ frames: [newFrame('desktop')] });

// ---------------- example board ----------------

const T = (s: string, x: number, y: number): Shape => ({ k: 'text', s, x, y });
const R = (x: number, y: number, w: number, h: number): Shape => ({ k: 'rect', x, y, w, h });
const btn = (label: string, x: number, y: number, h = 40, w = 140): Shape[] => [R(x, y, w, h), T(label, Math.round(x + (w - textWidth(label)) / 2), y + h / 2 + 6)];
const input = (label: string, x: number, y: number, w: number, h = 44): Shape[] => [T(label, x, y - 8), R(x, y, w, h)];
const check = (label: string, x: number, y: number): Shape[] => [R(x, y, 20, 20), T(label, x + 28, y + 15)];

/**
 * Three ready-made parts for the Parts tab: a navigation bar, a labelled form row and a bordered choice group.
 * Each is built the way a person would (from an outline), then captured exactly as "save selection as a part" does.
 */
export function exampleParts(): Record<string, Part> {
  const make = (outline: string): Part => {
    const f = smartSize(buildFromText(newFrame(), outline, null).frame);
    return makePart(f, classify(f).els.map((e) => e.i))!;
  };
  return {
    'nav-bar': { ...make('toolbar Home | Products | Pricing | Sign in'), note: 'Top navigation links' },
    'form-row': { ...make('input Email'), note: 'A labelled text field' },
    'choice-group': { ...make('radio Option A\nradio Option B\nradio Option C'), note: 'Three bordered radio options' },
  };
}

export function exampleBoard(): Board {
  const login: Frame = newFrame('desktop', 'Login: email and password, then land on the dashboard');
  login.shapes = [
    R(20, 20, 920, 56), T('Acme', 36, 54),
    R(300, 140, 360, 340), T('Sign in', 316, 172),
    ...input('Email', 316, 222, 328),
    ...input('Password', 316, 308, 328),
    ...check('Remember me', 316, 374),
    ...btn('Sign in', 316, 420),
    T('Forgot password?', 480, 446),
  ];
  const dash: Frame = newFrame('desktop', 'Dashboard: key numbers and recent activity');
  dash.shapes = [
    R(20, 20, 920, 56), T('Dashboard', 36, 54), { k: 'ell', x: 880, y: 28, w: 40, h: 40 },
    R(20, 96, 180, 484), T('Menu', 36, 128), T('Projects', 36, 170), T('Reports', 36, 210),
    R(220, 96, 220, 100), T('Revenue', 236, 128), T('$12.4k', 236, 172),
    R(460, 96, 220, 100), T('Users', 476, 128), T('1,284', 476, 172),
    R(700, 96, 240, 100), T('Orders', 716, 128), T('342', 716, 172),
    R(220, 216, 720, 200), T('Recent activity', 236, 248), { k: 'tlines', x: 236, y: 276, w: 688, h: 100 },
    R(220, 436, 720, 56), T('Invoice #1042', 236, 470),
    R(220, 504, 720, 56), T('Invoice #1041', 236, 538),
  ];
  const phone: Frame = newFrame('phone', 'Phone: task list with quick add');
  phone.shapes = [
    R(20, 20, 350, 56), T('Tasks', 36, 54), { k: 'ell', x: 322, y: 28, w: 40, h: 40 },
    R(20, 104, 350, 56), ...check('Buy milk', 36, 122),
    R(20, 172, 350, 56), ...check('Call Sam', 36, 190),
    R(20, 240, 350, 56), ...check('Send invoice', 36, 258),
    ...input('New task', 20, 344, 350, 48),
    ...btn('Add task', 20, 412, 48, 160),
  ];
  return { frames: [login, dash, phone].map((f) => smartSize(f)), example: true, parts: exampleParts() };
}

export { cloneBoard, DEVICES };
