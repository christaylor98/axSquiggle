import { bounds, interArea, area } from './geom';
import { convertElement, buildFromText, KEYWORDS, parseCell, setHint, setLabel, deleteElement, MIN_H, MAX_H } from './layout';
import { resolveLinks, setLinks, linksOf } from './links';
import { classify, shift, smartSize, type El } from './semantics';
import { cloneFrame, frameSize, newFrame, newId, newNote, type Board, type Device, type Frame } from './types';
import { frameSVG } from './exporters';

/** Everything an outside AI needs to read and change a board: pure functions over a Board, shared by the HTTP and MCP servers. */

export type FrameRef = number | string;

/** Find a frame by 1-based number, id, or caption words. Returns its index or -1. */
export function findFrame(b: Board, ref: FrameRef): number {
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) { const n = Number(ref) - 1; return n >= 0 && n < b.frames.length ? n : -1; }
  const s = String(ref).trim().toLowerCase();
  const byId = b.frames.findIndex((f) => f.id === ref);
  if (byId >= 0) return byId;
  return b.frames.findIndex((f) => s && f.caption.toLowerCase().includes(s));
}

function needFrame(b: Board, ref: FrameRef): number {
  const i = findFrame(b, ref);
  if (i < 0) throw new Error(`No such frame: ${JSON.stringify(ref)}. The board has ${b.frames.length} frame(s); refer to one by number (1-${b.frames.length}), id or caption words.`);
  return i;
}

const bbox = (f: Frame, i: number) => { const b = bounds(f.shapes[i]); return `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}`; };

export interface Listed { n: number; i: number; el: El }
/** The frame's elements in outline order, numbered from 1; `n` is what the tools accept as an element index. */
export function listElements(f: Frame): Listed[] {
  return classify(f).els.map((el, k) => ({ n: k + 1, i: el.i, el }));
}

export function describeFrame(b: Board, fi: number): string {
  const f = b.frames[fi], { w, h } = frameSize(f);
  const lines = [`Frame ${fi + 1} [${f.id}] ${f.caption ? `"${f.caption}" ` : ''}${f.device} ${w}x${h}${f.bg ? '  (has an image behind it: a sketch photo or screenshot, attached to the review)' : ''}`];
  const links = new Map(linksOf(b).filter((l) => l.from === fi).map((l) => [l.idx, l]));
  for (const { n, i, el } of listElements(f)) {
    const l = links.get(i);
    lines.push(`${'  '.repeat(el.depth + 1)}${n}. ${el.role}${el.label ? ` "${el.label.replace(/\s*\n\s*/g, ' / ')}"` : ''}${el.hint ? ` hint "${el.hint}"` : ''} (${bbox(f, i)})${l ? ` -> frame ${l.to === null ? '?' : l.to + 1}` : ''}`);
  }
  if (!f.shapes.length) lines.push('  (empty)');
  for (const n of f.notes) lines.push(`  note [${n.id}]${n.done ? ' (done)' : ''}: ${n.text}${n.reply ? `  | reply: ${n.reply}` : ''}`);
  return lines.join('\n');
}

export function describeBoard(b: Board, rev?: number): string {
  const head = `Board${rev !== undefined ? ` rev ${rev}` : ''}: ${b.frames.length} frame(s)${b.parts ? `, parts: ${Object.entries(b.parts).map(([n, p]) => '/' + n + (p.note ? ` (${p.note})` : '')).join(' ')}` : ''}`;
  return [head, ...b.frames.map((_, i) => describeFrame(b, i))].join('\n\n');
}

export interface ImageOut { mediaType: string; data: string; label: string }

/** Images people dropped behind frames (sketch photos, screenshots), for an AI that can look at them. */
export function frameImages(b: Board, max = 4): ImageOut[] {
  const out: ImageOut[] = [];
  b.frames.forEach((f, i) => {
    const m = f.bg ? /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(f.bg) : null;
    if (m && out.length < max) out.push({ mediaType: m[1], data: m[2], label: `Frame ${i + 1}${f.caption ? ` "${f.caption}"` : ''}: image behind the frame` });
  });
  return out;
}

export const frameSvgText = (b: Board, ref: FrameRef) => frameSVG(b.frames[needFrame(b, ref)]);

// ---------------- drafting ----------------

export interface FrameSpec { caption?: string; device?: Device; outline: string }

/**
 * Build frames from outline text (the same syntax as the Outline panel: "button Save | button Cancel", indentation nests,
 * "-> 2" links to a frame). Returns warnings for things that could not be honoured.
 */
export function buildFrames(specs: FrameSpec[], existing: Frame[] = []): { frames: Frame[]; warnings: string[] } {
  const frames = specs.map((s) => {
    const f = newFrame(s.device ?? 'desktop', s.caption ?? '');
    return smartSize(buildFromText(f, s.outline, null).frame);
  });
  const all = [...existing, ...frames], warnings: string[] = [];
  frames.forEach((f, k) => { for (const bad of resolveLinks(f, all)) warnings.push(`Frame ${existing.length + k + 1}: no frame matches link target "${bad}"`); });
  return { frames, warnings };
}

/** First draft: replace the whole board (or append frames with replace=false). */
export function draftBoard(b: Board, specs: FrameSpec[], replace = true): string[] {
  const { frames, warnings } = buildFrames(specs, replace ? [] : b.frames);
  if (replace) {
    // The muted photo/screenshot a person dropped behind a frame is their reference: keep it under the frame at the same position.
    frames.forEach((f, i) => { const bg = b.frames[i]?.bg; if (bg && !f.bg) f.bg = bg; });
    b.frames = frames; delete b.example;
  } else b.frames.push(...frames);
  if (!b.frames.length) b.frames.push(newFrame());
  // Targets that point at frames created later in the same draft: resolve again now that the whole board exists.
  for (const f of b.frames) resolveLinks(f, b.frames);
  return warnings;
}

/** Add outline text to a frame (below what is there) or replace its contents; optionally set caption/device. */
export function applyOutline(b: Board, ref: FrameRef, outline: string | undefined, mode: 'append' | 'replace' = 'append', meta: { caption?: string; device?: Device } = {}): string[] {
  const fi = needFrame(b, ref);
  let f = b.frames[fi];
  if (meta.caption !== undefined) f.caption = meta.caption;
  if (meta.device) f.device = meta.device;
  if (outline) {
    if (mode === 'replace') f.shapes = [];
    f = smartSize(buildFromText(f, outline, null).frame);
    b.frames[fi] = f;
  }
  return resolveLinks(f, b.frames).map((bad) => `no frame matches link target "${bad}"`);
}

/** A copy of a frame right after it (new ids for the frame and its notes; links to other frames carry over). */
export function duplicateFrameAt(b: Board, ref: FrameRef): string {
  const fi = needFrame(b, ref);
  const copy = cloneFrame(b.frames[fi]);
  copy.id = newId('f');
  copy.notes = copy.notes.map((n) => ({ ...n, id: newId('n') }));
  b.frames.splice(fi + 1, 0, copy);
  return `Duplicated frame ${fi + 1}; the copy is frame ${fi + 2}`;
}

/** Move a frame to position `to` (1 = first). Links follow the frame, not its number. */
export function moveFrameTo(b: Board, ref: FrameRef, to: number): string {
  const fi = needFrame(b, ref), ti = Math.max(0, Math.min(b.frames.length - 1, Math.round(to) - 1));
  const [f] = b.frames.splice(fi, 1);
  b.frames.splice(ti, 0, f);
  return `Moved frame ${fi + 1} to position ${ti + 1}`;
}

export function deleteFrameAt(b: Board, ref: FrameRef): string {
  const fi = needFrame(b, ref);
  if (b.frames.length < 2) throw new Error('A board needs at least one frame');
  const [gone] = b.frames.splice(fi, 1);
  for (const f of b.frames) for (const s of f.shapes) if ((s as { link?: string }).link === gone.id) delete (s as { link?: string }).link;
  return `Deleted frame ${fi + 1}`;
}

// ---------------- editing one element ----------------

export interface Target { index?: number; label?: string; role?: string }
export interface ElementEdit { label?: string; hint?: string; kind?: string; remove?: boolean; link?: FrameRef | null; /** new height of an Image or Card (what is below it moves down or up) */ height?: number; move?: { dx: number; dy: number } }

export function findElement(f: Frame, t: Target): Listed {
  const all = listElements(f);
  if (t.index !== undefined) {
    const hit = all.find((x) => x.n === t.index);
    if (!hit) throw new Error(`Frame has ${all.length} element(s); no element ${t.index}. Call get_board for the numbered list.`);
    return hit;
  }
  const lab = (t.label ?? '').toLowerCase(), role = (t.role ?? '').toLowerCase();
  const hits = all.filter((x) => (!lab || x.el.label.toLowerCase().includes(lab)) && (!role || x.el.role.toLowerCase() === role));
  if (!lab && !role) throw new Error('Say which element: an index from get_board, or a label and/or role.');
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new Error(`No element matches ${JSON.stringify(t)}.`);
  throw new Error(`${hits.length} elements match ${JSON.stringify(t)}; use an index: ${hits.map((h) => `${h.n}=${h.el.role} "${h.el.label}"`).join(', ')}`);
}

export function editElement(b: Board, ref: FrameRef, t: Target, op: ElementEdit): string {
  const fi = needFrame(b, ref);
  let f = b.frames[fi];
  const { el } = findElement(f, t);
  const said: string[] = [];
  if (op.remove) {
    b.frames[fi] = deleteElement(f, el);
    return `Removed ${el.role}${el.label ? ` "${el.label}"` : ''}`;
  }
  if (op.kind) {
    const cell = parseCell(`${op.kind} ${op.label ?? el.label}`);
    if (!cell.keyword) throw new Error(`Unknown element kind "${op.kind}". Kinds: ${Object.keys(KEYWORDS).join(', ')}.`);
    const r = convertElement(f, el, cell);
    f = r.frame; b.frames[fi] = f; said.push(`now a ${cell.kind}`);
    t = { index: undefined, label: op.label ?? el.label, role: undefined };
  } else if (op.label !== undefined) {
    f = setLabel(f, el, op.label); b.frames[fi] = f; said.push(`label "${op.label}"`);
  }
  if (op.hint !== undefined) {
    const e2 = findElement(b.frames[fi], op.kind || op.label !== undefined ? { label: op.label ?? el.label } : { label: el.label, role: el.role }).el;
    if (e2.role !== 'Input') throw new Error('Only input fields have a ghost hint.');
    b.frames[fi] = setHint(b.frames[fi], e2, op.hint); said.push(op.hint ? `hint "${op.hint}"` : 'hint cleared');
  }
  const cur = (() => { try { return findElement(b.frames[fi], op.kind || op.label !== undefined ? { label: op.label ?? el.label } : { index: undefined, label: el.label, role: el.role }); } catch { return null; } })();
  if (op.move && cur) {
    const group = new Set([cur.i]); if (cur.el.labelIdx !== null) group.add(cur.el.labelIdx);
    for (const j of group) shift(b.frames[fi], j, op.move.dx, op.move.dy);
    said.push(`moved ${op.move.dx},${op.move.dy}`);
  }
  if (op.height !== undefined) {
    if (!cur) throw new Error('Could not find that element again to resize it.');
    const host = b.frames[fi].shapes[cur.i];
    if (!(host.k === 'img' || (host.k === 'rect' && cur.el.role === 'Card'))) throw new Error(`Only an Image or a Card has a height to set (this is a ${cur.el.role}).`);
    const h = Math.round(Math.max(MIN_H, Math.min(MAX_H, op.height))), dh = h - host.h, bottom = host.y + host.h;
    if (dh) {
      // Whatever sits below it in the same column (its caption included) moves with its edge.
      b.frames[fi].shapes.forEach((sh, j) => {
        if (j === cur.i || sh.k === 'line') return;
        const bb = bounds(sh);
        if (bb.y >= bottom - 1 && bb.x < host.x + host.w && bb.x + bb.w > host.x) shift(b.frames[fi], j, 0, dh);
      });
      host.h = h;
    }
    said.push(`height ${h}`);
  }
  if (op.link !== undefined && cur) {
    if (op.link === null) setLinks(b.frames[fi], [cur.i], null);
    else { const ti = needFrame(b, op.link); setLinks(b.frames[fi], [cur.i], b.frames[ti].id); said.push(`links to frame ${ti + 1}`); }
  }
  b.frames[fi] = smartSize(b.frames[fi]);
  return `${el.role}${el.label ? ` "${el.label}"` : ''}: ${said.join(', ') || 'unchanged'}`;
}

// ---------------- review ----------------

/** What each open note is about: the elements under its region, found by overlap. */
function noteTargets(f: Frame, box: [number, number, number, number]): string[] {
  const r = { x: box[0], y: box[1], w: box[2], h: box[3] };
  if (r.w <= 0 || r.h <= 0) return [];
  return listElements(f)
    .filter(({ i }) => { const b = bounds(f.shapes[i]); return interArea(r, b) / Math.max(1, Math.min(area(r), area(b))) > 0.4; })
    .map(({ n, el }) => `${n}. ${el.role}${el.label ? ` "${el.label}"` : ''}`);
}

const key = (r: string, l: string) => `${r}|${l}`;

/** Human-readable list of what changed between two versions of a board (the AI's draft and the user's edit of it). */
export function diffBoards(base: Board, cur: Board): string[] {
  const out: string[] = [];
  const bById = new Map(base.frames.map((f) => [f.id, f]));
  const cById = new Map(cur.frames.map((f) => [f.id, f]));
  base.frames.forEach((f, i) => { if (!cById.has(f.id)) out.push(`Frame removed: was ${i + 1}${f.caption ? ` "${f.caption}"` : ''}`); });
  cur.frames.forEach((f, i) => {
    const old = bById.get(f.id), tag = `Frame ${i + 1}${f.caption ? ` "${f.caption}"` : ''}`;
    if (!old) { out.push(`${tag}: new frame`); return; }
    if (old.caption !== f.caption) out.push(`${tag}: caption changed from "${old.caption}" to "${f.caption}"`);
    if (old.device !== f.device) out.push(`${tag}: device is now ${f.device}`);
    const a = classify(old).els.map((e) => ({ k: key(e.role, e.label), e, b: bounds(old.shapes[e.i]) }));
    const c = classify(f).els.map((e) => ({ k: key(e.role, e.label), e, b: bounds(f.shapes[e.i]) }));
    const left = [...a];
    const added: typeof c = [];
    for (const x of c) {
      const j = left.findIndex((y) => y.k === x.k);
      if (j >= 0) {
        const y = left.splice(j, 1)[0];
        if (Math.abs(x.b.x - y.b.x) + Math.abs(x.b.y - y.b.y) > 30) out.push(`${tag}: ${x.e.role}${x.e.label ? ` "${x.e.label}"` : ''} moved to (${Math.round(x.b.x)},${Math.round(x.b.y)})`);
        else if (Math.abs(x.b.w - y.b.w) + Math.abs(x.b.h - y.b.h) > 30) out.push(`${tag}: ${x.e.role}${x.e.label ? ` "${x.e.label}"` : ''} resized to ${Math.round(x.b.w)}x${Math.round(x.b.h)}`);
      } else added.push(x);
    }
    // A removed and an added element of the same role most likely mean "relabelled".
    for (const x of [...added]) {
      const j = left.findIndex((y) => y.e.role === x.e.role);
      if (j >= 0) { const y = left.splice(j, 1)[0]; added.splice(added.indexOf(x), 1); out.push(`${tag}: ${x.e.role} "${y.e.label}" is now "${x.e.label}"`); }
    }
    for (const x of added) out.push(`${tag}: added ${x.e.role}${x.e.label ? ` "${x.e.label}"` : ''} at (${Math.round(x.b.x)},${Math.round(x.b.y)})`);
    for (const y of left) out.push(`${tag}: removed ${y.e.role}${y.e.label ? ` "${y.e.label}"` : ''}`);
    const oldN = new Map(old.notes.map((n) => [n.id, n]));
    for (const n of f.notes) { const o = oldN.get(n.id); if (!o) out.push(`${tag}: new note [${n.id}] "${n.text}"`); else if (!!o.done !== !!n.done) out.push(`${tag}: note [${n.id}] ${n.done ? 'marked done' : 'reopened'}`); }
    for (const n of old.notes) if (!f.notes.some((x) => x.id === n.id)) out.push(`${tag}: note [${n.id}] deleted`);
  });
  const oldLinks = new Set(linksOf(base).map((l) => `${base.frames[l.from].id}|${l.role}|${l.label}|${l.toId}`));
  for (const l of linksOf(cur)) if (!oldLinks.has(`${cur.frames[l.from].id}|${l.role}|${l.label}|${l.toId}`)) out.push(`Frame ${l.from + 1}: ${l.role}${l.label ? ` "${l.label}"` : ''} now links to ${l.to === null ? 'a missing frame' : `frame ${l.to + 1}`}`);
  return out;
}

export interface ReviewPacket {
  text: string;
  openNotes: { id: string; frame: number; text: string; about: string[]; region: number[]; targets: string[] }[];
  changes: string[];
}

/** What the AI fetches to see the review: open review notes (with the elements they point at), what the person changed since the AI's draft, and the board. */
export function reviewPacket(b: Board, baseline: Board | null, rev: number): ReviewPacket {
  const openNotes: ReviewPacket['openNotes'] = [];
  b.frames.forEach((f, fi) => f.notes.filter((n) => !n.done).forEach((n) => openNotes.push({ id: n.id, frame: fi + 1, text: n.text, about: n.about, region: n.box, targets: noteTargets(f, n.box) })));
  const changes = baseline ? diffBoards(baseline, b) : [];
  const lines = [`REVIEW (board rev ${rev})`];
  lines.push('', `Open review notes: ${openNotes.length}`);
  for (const n of openNotes) {
    const f = b.frames[n.frame - 1];
    lines.push(`- [${n.id}] frame ${n.frame}${f.caption ? ` "${f.caption}"` : ''}: ${n.text}`);
    if (n.targets.length) lines.push(`    points at: ${n.targets.join('; ')}`);
    else if (n.about.length) lines.push(`    about: ${n.about.join('; ')}`);
  }
  lines.push('', baseline ? `Changes the person made since your last write (${changes.length}):` : 'No baseline (you have not written to this board yet).');
  for (const c of changes) lines.push(`- ${c}`);
  lines.push('', 'Action each note with the editing tools, then call resolve_notes with the ids (add a short reply saying what you did).', '', describeBoard(b, rev));
  return { text: lines.join('\n'), openNotes, changes };
}

export function addNote(b: Board, ref: FrameRef, text: string, about: string[] = ['AI']): string {
  const f = b.frames[needFrame(b, ref)];
  const n = newNote(text, [40, 40, 0, 0], about);
  f.notes.push(n);
  return n.id;
}

export function resolveNotes(b: Board, ids: string[], reply?: string, done = true): number {
  let n = 0;
  for (const f of b.frames) for (const note of f.notes) {
    if (!ids.includes(note.id)) continue;
    if (done) note.done = true; else delete note.done;
    if (reply) note.reply = reply.slice(0, 500);
    n++;
  }
  return n;
}
