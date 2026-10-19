import { bbox, bounds, center, linePts, lineLabelSpot, pathLen, pointInPoly, setTextMeasurer, snapTo, textBlock, type Box } from '../core/geom';
import { ATTACH_NEAR, connect, endsOf, nearestTarget } from '../core/connect';
import { searchBoard, type Hit } from '../core/search';
import { linkAt, linkable, setLinks } from '../core/links';
import { recognize } from '../core/recognize';
import { arrowLabelOwners, classify, moveGroup, placeArrowLabels, shift, smartSize } from '../core/semantics';
import { borderFor, CHAIN_KINDS, deleteShapes, GROUPED_KINDS, parseStamp, slashMatches, STAMP_HELP, stampFromText } from '../core/layout';
import { filterItems, type PalItem } from '../core/palette';
import { chooseFile, picName, shrinkPicture } from './picture';
import { fromRawJSON } from '../core/model';
import { freeSpotFor } from '../core/place';
import { groupCenter, rotatePt, rotateShapes, rotOf, snapAngle, toLocal } from '../core/rotate';
import { forgetFile, openBoard, readBoard, saveBoard } from './file';
import { cloneShape, frameSize, GRID, isConnector, newFrame, newNote, type Frame, type LabelJ, type LabelV, type Pt, type Shape } from '../core/types';
import { HAND_FONT } from '../core/exporters';
import { previewHTML } from '../core/preview';
import { buildLegend, flashGesture } from './legend';
import { Outline } from './outline';
import { PartsPanel } from './parts';
import { Sync } from './sync';
import howtoHtml from './howto.html?raw';
import { traceImage } from '../core/trace';
import { makePart, partName, selectionOrigin } from '../core/parts';
import type { Board, Part } from '../core/types';
import { instantiate } from '../core/layout';
import { openExport } from './dialogs';
import { currentTheme, drawFrame, handlePoints, type HandleId } from './render';
import { selectedOf, Store, type Tool } from './store';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function startApp() {
  const store = new Store();
  const st = store.state;
  const cv = $<HTMLCanvasElement>('cv'), wrap = $('wrap'), inl = $<HTMLTextAreaElement>('inl');
  /** Keep the text box exactly as tall as its lines (the canvas is scaled, so work from the scaled line height). */
  const fitInl = () => { inl.style.height = 'auto'; inl.style.height = `${Math.max(26 * scale, inl.scrollHeight)}px`; };
  inl.addEventListener('input', fitInl);
  const ctx = cv.getContext('2d')!;
  let scale = 1;
  let ghost: Pt[] | null = null;
  let marquee: Box | null = null;
  let zoom = 1;                      // multiplier on the fit-to-stage scale; the stage scrolls when it is above 1
  let ghostColor: string | undefined;

  // ---------- helpers ----------
  const toastEl = $('toast');
  let toastTimer = 0;
  const toast = (msg: string) => {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 1800);
  };
  store.onWarn = toast;
  const sized = (f: Frame) => smartSize(f);   // always on: boxes fit their text and rows stay tidy without anyone asking
  const measure = document.createElement('canvas').getContext('2d')!;
  const setMeasurer = () => { measure.font = `18px ${HAND_FONT}`; setTextMeasurer((s) => measure.measureText(s).width); };
  setMeasurer();
  document.fonts?.load(`18px Kalam`).then(() => { setMeasurer(); redraw(); });

  // ---------- canvas layout + drawing ----------
  function layout() {
    const f = store.frame, { w, h } = frameSize(f);
    const dpr = window.devicePixelRatio || 1;
    const fit = Math.max(0.2, Math.min((wrap.clientWidth - 16) / w, (wrap.clientHeight - 16) / h, 2));
    scale = fit * zoom;                                  // zoom 1 = the whole frame fits the stage
    cv.style.width = `${w * scale}px`; cv.style.height = `${h * scale}px`;
    const px = Math.min(1, 8192 / Math.max(w * scale * dpr, h * scale * dpr));   // keep the bitmap within browser limits when zoomed far in
    const pw = Math.round(w * scale * dpr * px), ph = Math.round(h * scale * dpr * px);
    $('zoomchip').hidden = Math.abs(zoom - 1) < 0.01; $('zoomchip').textContent = `${Math.round(zoom * fit * 100)}%`;
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    redraw();
  }
  let raf = 0, lastSel = '';
  let play = false;                // click-through mode
  const playBack: string[] = [];   // frame ids to return to with Backspace
  function redraw() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const f = store.frame, dpr = window.devicePixelRatio || 1;
      const k = (cv.width / (frameSize(f).w)) ;   // bitmap pixels per logical unit (scale * dpr, less when capped)
      ctx.setTransform(k, 0, 0, k, 0, 0);
      drawFrame(ctx, f, {
        scale, theme: currentTheme(), grid: st.prefs.snap && !play, classified: st.prefs.roles && !play ? classify(f) : null,
        sel: play ? null : st.sel, more: play ? [] : selectedOf(st).slice(1), marquee, handles: !play && (st.tool === 'select' || st.tool === 'flow'), turn: turnMode, hover: play ? null : st.hover,
        frameNo: (id) => { const n = st.board.frames.findIndex((x) => x.id === id); return n < 0 ? null : n + 1; }, play, ghost, ghostColor, pins: true,
        focus: st.focus, focusBox: st.focusBox,
      }, redraw);
      // Selection is one thing shown in two places: whenever it changes on the canvas, the outline follows.
      const selKey = selectedOf(st).join(',');
      if (selKey !== lastSel) { lastSel = selKey; outline.markSel(); paintKeys(); if (st.tool === 'review') updateReview(); }
    });
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { redraw(); renderStrip(true); });
  new ResizeObserver(layout).observe(wrap);

  const pt = (e: PointerEvent | MouseEvent): Pt => {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  // ---------- hit testing ----------
  function distSeg(p: Pt, ax: number, ay: number, bx: number, by: number) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / l2)) : 0;
    return Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy));
  }
  /** Hit test for selection: smallest shape under the pointer wins. */
  function hitBody(f: Frame, p: Pt): number | null {
    const tol = 7 / scale;
    let best: number | null = null, bestA = Infinity;
    f.shapes.forEach((s, i) => {
      let hit = false;
      if (s.k === 'line') { const lp = linePts(s); hit = lp.some((q, j) => j > 0 && distSeg(p, lp[j - 1].x, lp[j - 1].y, q.x, q.y) <= tol); }
      else if (s.k === 'free') hit = s.pts.some((q, j) => j > 0 && distSeg(p, s.pts[j - 1][0], s.pts[j - 1][1], q[0], q[1]) <= tol);
      else { const b = bounds(s), q = toLocal(s, p), t2 = s.k === 'tlines' ? tol + 5 : tol; hit = q.x >= b.x - t2 && q.x <= b.x + b.w + t2 && q.y >= b.y - t2 && q.y <= b.y + b.h + t2; }   // paragraphs are thin: a little extra reach
      const b = bounds(s), a = Math.max(1, b.w * b.h) * (s.k === 'line' || s.k === 'free' ? 0.01 : 1);
      if (hit && a < bestA) { best = i; bestA = a; }
    });
    return best;
  }
  /** Hit test for erase: hollow boxes only count near their outline. */
  function hitStroke(f: Frame, p: Pt): number | null {
    const tol = 8 / scale;
    for (let i = f.shapes.length - 1; i >= 0; i--) {
      const s = f.shapes[i];
      if (s.k === 'rect' || s.k === 'ell') {
        const b = bounds(s), q = toLocal(s, p);
        const inside = q.x > b.x + tol && q.x < b.x + b.w - tol && q.y > b.y + tol && q.y < b.y + b.h - tol;
        const near = q.x >= b.x - tol && q.x <= b.x + b.w + tol && q.y >= b.y - tol && q.y <= b.y + b.h + tol;
        if (near && !inside) return i;
      } else {
        const hit = hitBody(Object.assign({}, f, { shapes: [s] }), p);
        if (hit !== null) return i;
      }
    }
    return null;
  }

  // ---------- shape geometry edits ----------
  function setBox(s: Shape, nb: Box, from: Shape) {
    if (s.k === 'line' || s.k === 'text') return;
    if (s.k === 'free' && from.k === 'free') {
      const ob = bounds(from);
      const sx = ob.w ? nb.w / ob.w : 1, sy = ob.h ? nb.h / ob.h : 1;
      s.pts = from.pts.map(([x, y]) => [nb.x + (x - ob.x) * sx, nb.y + (y - ob.y) * sy]);
    } else if (s.k !== 'free') { s.x = nb.x; s.y = nb.y; s.w = nb.w; s.h = nb.h; }
  }
  const snapV = (v: number) => (st.prefs.snap ? snapTo(v, GRID) : v);

  // ---------- zoom and pan ----------
  /** Zoom by a factor, keeping the point under (cx, cy) (screen coordinates) where it is. */
  function zoomBy(factor: number, cx?: number, cy?: number) {
    const r = wrap.getBoundingClientRect(), x = cx ?? r.left + r.width / 2, y = cy ?? r.top + r.height / 2;
    const c0 = cv.getBoundingClientRect(), lx = (x - c0.left) / scale, ly = (y - c0.top) / scale;
    zoom = Math.max(0.5, Math.min(8, zoom * factor));
    layout();
    const c1 = cv.getBoundingClientRect();
    wrap.scrollLeft += c1.left + lx * scale - x; wrap.scrollTop += c1.top + ly * scale - y;
  }
  function zoomFit() { zoom = 1; layout(); wrap.scrollTo(0, 0); }
  wrap.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;               // a plain wheel just scrolls the zoomed stage; Ctrl/Cmd (or a trackpad pinch) zooms
    e.preventDefault();
    zoomBy(Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
  }, { passive: false });
  $('zoomchip').onclick = zoomFit;

  // ---------- pointer interaction ----------
  type Drag =
    | { kind: 'draw'; pts: Pt[] }
    | { kind: 'erase'; snapped: boolean }
    | { kind: 'move'; start: Pt; orig: Map<number, Shape>; primary: number; moved: boolean; links: Link[] }
    | { kind: 'rotate'; idxs: number[]; orig: Map<number, Shape>; center: Pt; a0: number; base: number; moved: boolean; links: Link[] }
    | { kind: 'resize'; handle: HandleId; orig: Shape; idx: number; moved: boolean; links: Link[] }
    | { kind: 'tap'; start: Pt }
    | { kind: 'flow'; pts: Pt[] }
    | { kind: 'marquee'; start: Pt; add: boolean; base: number[] }
    | { kind: 'pan'; x: number; y: number; sl: number; st: number };
  let drag: Drag | null = null;

  // ---------- arrow attachment ----------
  /** An attached arrow and the shapes at its two ends, remembered so it can follow them when things move. */
  type Link = { i: number; a: number | null; b: number | null };
  function linksFor(f: Frame, group: Set<number>): Link[] {
    const out: Link[] = [];
    f.shapes.forEach((s, i) => {
      if (s.k !== 'line' || !(s.arrow || s.tail || s.conn) || group.has(i)) return;
      const [a, b] = endsOf(f, i);
      // Every attached arrow is re-routed, not just those on moved shapes, so they also flow around whatever moves into their way.
      if (a !== null || b !== null) out.push({ i, a, b });
    });
    return out;
  }
  const relink = (f: Frame, links: Link[]) => {
    if (!links.length) return;
    const owners = arrowLabelOwners(f);   // who owns which label, found while the arrows are still where their words are
    links.forEach((l) => connect(f, l.i, l.a, l.b));
    placeArrowLabels(f, owners);
  };

  // ---------- selection ----------
  const selected = () => selectedOf(st);
  function setSelection(idxs: number[]) { store.select(idxs); redraw(); }
  const toggleSel = (i: number) => {
    const cur = selected();
    setSelection(cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]);
  };
  /** Elements (primary shapes) lying fully inside a box. */
  function insideBox(f: Frame, r: Box): number[] {
    return classify(f).els.map((e) => e.i).filter((i) => {
      const b = bounds(f.shapes[i]);
      return b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;
    });
  }
  /** Of these shapes, the ones that are elements in their own right (labels belong to their owner). */
  const primaries = (idxs: number[]) => { const by = classify(store.frame).byIndex; return idxs.filter((i) => by.has(i)); };
  const selectAll = () => setSelection(classify(store.frame).els.map((e) => e.i));

  cv.addEventListener('pointerdown', (e) => {
    // Middle button, or Alt + drag, pans a zoomed-in frame.
    if (e.button === 1 || (e.altKey && e.pointerType === 'mouse')) {
      e.preventDefault(); cv.setPointerCapture(e.pointerId);
      drag = { kind: 'pan', x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
      return;
    }
    if (e.button > 0 && e.pointerType === 'mouse') return;
    if (!inl.hidden) inl.blur();
    // preventDefault below stops the canvas taking focus, so release any text field ourselves or shortcuts stay typed into it.
    if (typing(document.activeElement)) (document.activeElement as HTMLElement).blur();
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    const p = pt(e), f = store.frame;
    if (play) {
      const i = linkAt(f, p), target = i === null ? undefined : st.board.frames.findIndex((x) => x.id === (f.shapes[i] as { link: string }).link);
      if (target !== undefined && target >= 0) { playBack.push(f.id); store.setCur(target); }
      else toast(i === null ? 'No link here' : 'That link points at a frame that no longer exists');
      return;
    }
    switch (st.tool) {
      case 'draw': case 'sketch': case 'review': drag = { kind: 'draw', pts: [p] }; ghost = [p]; ghostColor = undefined; break;
      case 'erase': store.snapshot(); drag = { kind: 'erase', snapped: true }; eraseAt(p); break;
      case 'text': drag = { kind: 'tap', start: p }; break;
      case 'select': {
        const h = grabHandle(p, e.shiftKey);
        if (h) { drag = h; return; }
        const hit = hitBody(f, p);
        if (e.shiftKey && hit !== null) { toggleSel(hit); return; }
        if (hit !== null && selected().includes(hit) && selected().length > 1) { drag = startMove(hit, p, selected()); break; }
        if (hit !== null) { setSelection([hit]); drag = startMove(hit, p); }
        else { setSelection(e.shiftKey ? selected() : []); drag = { kind: 'marquee', start: p, add: e.shiftKey, base: selected() }; }
        break;
      }
      case 'flow': {
        // Modeless: grab the selection's handles/body, otherwise it's a stroke that may turn out to be a tap.
        const h = grabHandle(p, e.shiftKey);
        if (h) { drag = h; return; }
        const hs = hitStroke(f, p);
        if (e.shiftKey) {
          if (hs !== null) { toggleSel(hs); return; }
          drag = { kind: 'marquee', start: p, add: true, base: selected() }; break; // Shift+drag on empty space = rubber band
        }
        if (hs !== null && selected().includes(hs)) { drag = startMove(hs, p, selected()); break; }
        drag = { kind: 'flow', pts: [p] }; ghost = [p]; ghostColor = undefined; break;
      }
    }
  });

  /** Corner handles resize; with Shift held (turn mode, little turn arrows) they turn the shape instead. Text only has turn corners. */
  function grabHandle(p: Pt, turn = false): Drag | null {
    if (selected().length !== 1) return null; // handles belong to a single selection
    const s = st.sel !== null ? store.frame.shapes[st.sel] : undefined;
    if (!s || st.sel === null) return null;
    const h = handlePoints(s).find((q) => Math.hypot(q.x - p.x, q.y - p.y) <= 10 / scale);
    if (!h) return null;
    const corner = h.id.length === 2 && h.id !== 'p1' && h.id !== 'p2';
    if (corner && (turn || s.k === 'text')) return startRotate(st.sel, p);
    return { kind: 'resize', handle: h.id, orig: cloneShape(s), idx: st.sel, moved: false, links: linksFor(store.frame, new Set([st.sel])) };
  }
  // Shift held = turn mode: the corners of the selection show little turn arrows.
  let turnMode = false;
  const setTurnMode = (on: boolean) => { if (on !== turnMode) { turnMode = on; redraw(); } };
  document.addEventListener('keydown', (e) => { if (e.key === 'Shift') setTurnMode(true); });
  document.addEventListener('keyup', (e) => { if (e.key === 'Shift') setTurnMode(false); });
  window.addEventListener('blur', () => setTurnMode(false));
  /** Turn an element (with its label and anything inside it) about its centre; `p` is where the pointer took hold. */
  /** A box or circle is selected and a character is typed: write it inside the shape (continuing any words already there). */
  function typeInto(idx: number, ch: string) {
    const f = store.frame, s = f.shapes[idx], b = bounds(s), mid = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const li = classify(f).byIndex.get(idx)?.labelIdx ?? null;
    let best = li ?? -1, bd = Infinity;
    if (best < 0) f.shapes.forEach((t, j) => {   // words typed there before the shape had a label setting
      if (t.k !== 'text' || t.ghost || t.free) return;
      const tb = bounds(t), c = { x: tb.x + tb.w / 2, y: tb.y + tb.h / 2 };
      if (c.x < b.x || c.x > b.x + b.w || c.y < b.y || c.y > b.y + b.h) return;
      const d = Math.hypot(c.x - mid.x, c.y - mid.y);
      if (d < bd) { bd = d; best = j; }
    });
    if (best >= 0) { const tb = bounds(f.shapes[best]); openInline({ x: tb.x + 2, y: tb.y + tb.h / 2 }, ch, { append: true }); return; }
    openInline(s.k === 'ell' ? { x: mid.x - 8, y: mid.y - 6 } : { x: b.x + 14, y: b.y + Math.min(b.h / 2, 30) - 6 }, ch, { into: idx });
  }
  /** Text tool, box or circle selected: up / down step the label above -> inside -> underneath; left / right step it left -> centre -> right. A step that cannot go further is ignored. */
  const V_WORDS: Record<LabelV, string> = { top: 'above it', inTop: 'inside, at the top', middle: 'inside, in the middle', inBottom: 'inside, at the bottom', bottom: 'underneath it' };
  const J_WORDS: Record<LabelJ, string> = { left: 'left', center: 'centred', right: 'right' };
  const V_ORDER: LabelV[] = ['top', 'inTop', 'middle', 'inBottom', 'bottom'], J_ORDER: LabelJ[] = ['left', 'center', 'right'];
  function stepLabel(idx: number, dv: -1 | 0 | 1, dj: -1 | 0 | 1) {
    const cur = store.frame.shapes[idx];
    if (!cur || (cur.k !== 'rect' && cur.k !== 'ell')) return;
    const v = V_ORDER.indexOf(cur.lbl ?? 'middle'), j = J_ORDER.indexOf(cur.lj ?? 'center');
    const nv = Math.max(0, Math.min(V_ORDER.length - 1, v + dv)), nj = Math.max(0, Math.min(2, j + dj));
    if (nv === v && nj === j && cur.lbl) return;     // already as far that way as it goes: nothing to do
    let said = '';
    store.mutate((fr) => {
      const sh = fr.shapes[idx];
      if (!sh || (sh.k !== 'rect' && sh.k !== 'ell')) return;
      sh.lbl = V_ORDER[nv]; sh.lj = J_ORDER[nj];
      said = `Label ${V_WORDS[sh.lbl]}, ${J_WORDS[sh.lj]}`;
      return sized(fr);
    });
    if (said) toast(said);
  }
  /** Text tool, paragraph selected: left / right step its lines left -> centre -> right, up / down step them top -> middle -> bottom of its box. */
  const AV_ORDER = ['top', 'middle', 'bottom'] as const;
  function stepParagraph(idx: number, dj: -1 | 0 | 1, dv: -1 | 0 | 1) {
    const cur = store.frame.shapes[idx];
    if (!cur || cur.k !== 'tlines') return;
    const j = J_ORDER.indexOf(cur.al ?? 'left'), nj = Math.max(0, Math.min(2, j + dj));
    const v = AV_ORDER.indexOf(cur.av ?? 'top'), nv = Math.max(0, Math.min(2, v + dv));
    if (nj === j && nv === v) return;
    store.mutate((fr) => {
      const sh = fr.shapes[idx];
      if (!sh || sh.k !== 'tlines') return;
      if (J_ORDER[nj] === 'left') delete sh.al; else sh.al = J_ORDER[nj] as 'center' | 'right';
      if (AV_ORDER[nv] === 'top') delete sh.av; else sh.av = AV_ORDER[nv] as 'middle' | 'bottom';
    });
    toast(`Paragraph ${J_WORDS[J_ORDER[nj]]}, ${AV_ORDER[nv] === 'top' ? 'at the top' : AV_ORDER[nv] === 'middle' ? 'in the middle' : 'at the bottom'}`);
  }
  /** Cut the words loose from the shape (they stay put, nothing re-places or moves them), or hook them back on. */
  /** Detached text sitting in or just above/below this shape: what D can hook back on. */
  function freeTextNear(idx: number): number {
    const f = store.frame, hb = bounds(f.shapes[idx]);
    return f.shapes.findIndex((t) => {
      if (t.k !== 'text' || !t.free) return false;
      const tb = bounds(t), cx = tb.x + tb.w / 2, cy = tb.y + tb.h / 2;
      if (cx < hb.x - 4 || cx > hb.x + hb.w + 4) return false;
      return (cy > hb.y && cy < hb.y + hb.h) || (cy <= hb.y && hb.y - (tb.y + tb.h) < 40) || (cy >= hb.y + hb.h && tb.y - (hb.y + hb.h) < 40);
    });
  }
  /** Is there text this shape owns that D can detach, or detached text near it that D can hook back on? */
  function hasDetachable(idx: number): boolean {
    return (classify(store.frame).byIndex.get(idx)?.labelIdx ?? null) !== null || freeTextNear(idx) >= 0;
  }
  function toggleDetach(idx: number) {
    let said = '';
    store.mutate((fr) => {
      const c = classify(fr), li = c.byIndex.get(idx)?.labelIdx ?? null;
      if (li !== null && fr.shapes[li].k === 'text') { (fr.shapes[li] as { free?: boolean }).free = true; delete (fr.shapes[li] as { of?: string }).of; said = 'Text detached: it stays where it is and moves on its own'; }
      else {
        const j = freeTextNear(idx);
        if (j < 0) { said = 'No text here to detach'; return; }
        delete (fr.shapes[j] as { free?: boolean }).free; said = 'Text attached again';
      }
      return sized(fr);
    });
    toast(said);
  }
  function startRotate(idx: number, p: Pt): Drag {
    const f = store.frame, c = classify(f);
    const idxs = [...moveGroup(f, c, idx)], pivot = groupCenter(f, idxs);
    return { kind: 'rotate', idxs, orig: new Map(idxs.map((j) => [j, cloneShape(f.shapes[j])])), center: pivot, a0: Math.atan2(p.y - pivot.y, p.x - pivot.x), base: rotOf(f.shapes[idx]), moved: false, links: linksFor(f, new Set(idxs)) };
  }
  /** Turn the selected elements by a fixed step (keyboard). */
  function rotateSel(deg: number) {
    const prim = primaries(selected());
    if (!prim.length) { toast('Select something to turn first'); return; }
    store.mutate((fr) => {
      const c = classify(fr), set = new Set<number>();
      for (const i of prim) for (const j of moveGroup(fr, c, i)) set.add(j);
      const idxs = [...set], links = linksFor(fr, set);
      rotateShapes(fr, idxs, groupCenter(fr, idxs), deg);
      relink(fr, links);
      return fr;
    });
  }
  /** Start dragging `hit`, together with `also` (the rest of a multi-selection) and everything that travels with each. */
  function startMove(hit: number, p: Pt, also: number[] = []): Drag {
    const f = store.frame, c = classify(f);
    const group = new Set<number>();
    for (const i of [hit, ...also]) for (const j of moveGroup(f, c, i)) group.add(j);
    return { kind: 'move', start: p, orig: new Map([...group].map((j) => [j, cloneShape(f.shapes[j])])), primary: hit, moved: false, links: linksFor(f, group) };
  }

  let mouse: Pt | null = null; // the cursor in frame coordinates while it is over the canvas
  cv.addEventListener('pointerleave', () => { if (!document.querySelector('dialog[open]')) mouse = null; }); // opening the palette makes the canvas lose the hover: keep the spot
  cv.addEventListener('pointermove', (e) => {
    mouse = pt(e);
    if (play && !drag) { cv.style.cursor = linkAt(store.frame, pt(e)) !== null ? 'pointer' : 'default'; return; }
    if (!drag) return;
    if (drag.kind === 'pan') { wrap.scrollLeft = drag.sl - (e.clientX - drag.x); wrap.scrollTop = drag.st - (e.clientY - drag.y); return; }
    const p = pt(e);
    switch (drag.kind) {
      case 'draw': case 'flow': drag.pts.push(p); ghost = drag.pts; redraw(); break;
      case 'erase': eraseAt(p); break;
      case 'marquee': {
        const d = drag;
        marquee = { x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) };
        redraw(); break;
      }
      case 'move': {
        const d = drag;
        if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < 3 / scale) return;
        if (!d.moved) { store.snapshot(); d.moved = true; }
        store.live((f) => { for (const [j, s] of d.orig) { f.shapes[j] = cloneShape(s); shift(f, j, p.x - d.start.x, p.y - d.start.y); } relink(f, d.links); });
        break;
      }
      case 'resize': {
        const d = drag;
        if (!d.moved) {
          store.snapshot(); d.moved = true;
        }
        store.live((f) => { const s = f.shapes[d.idx]; if (s.k === 'line') delete s.via; resizeTo(s, d, p); relink(f, d.links); refit(f, d.idx); });
        break;
      }
      case 'rotate': {
        const d = drag;
        if (!d.moved) { store.snapshot(); d.moved = true; }
        let delta = ((Math.atan2(p.y - d.center.y, p.x - d.center.x) - d.a0) * 180) / Math.PI;
        if (!e.altKey) delta = snapAngle(d.base + delta, 45, 11) - d.base; // clicks to every 45 degrees (hold Alt for a free angle)
        store.live((f) => { for (const [j, o] of d.orig) f.shapes[j] = cloneShape(o); rotateShapes(f, d.idxs, d.center, delta); relink(f, d.links); });
        break;
      }
    }
  });

  /** Words follow their shape while it is being resized: re-run the auto-fit in place. */
  function refit(f: Frame, fixed: number | null = null) { const n = smartSize(f, fixed); f.shapes = n.shapes; if (n.h === undefined) delete f.h; else f.h = n.h; }

  function resizeTo(s: Shape, d: Extract<Drag, { kind: 'resize' }>, p: Pt) {
    if (s.k === 'line' && d.orig.k === 'line') {
      if (d.handle === 'p1') { s.x1 = p.x; s.y1 = p.y; } else { s.x2 = p.x; s.y2 = p.y; }
      return;
    }
    const ob = bounds(d.orig), rot = rotOf(d.orig), oc = { x: ob.x + ob.w / 2, y: ob.y + ob.h / 2 };
    const q = rot ? rotatePt(p, oc, -rot) : p;   // the pointer in the shape's own (unturned) frame
    let x0 = ob.x, y0 = ob.y, x1 = ob.x + ob.w, y1 = ob.y + ob.h;
    if (d.handle.includes('w')) x0 = q.x;
    if (d.handle.includes('e')) x1 = q.x;
    if (d.handle.includes('n')) y0 = q.y;
    if (d.handle.includes('s')) y1 = q.y;
    const nb = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.max(4, Math.abs(x1 - x0)), h: Math.max(4, Math.abs(y1 - y0)) };
    if (rot) { // the corner opposite the one being dragged stays put on screen
      const mid = rotatePt({ x: nb.x + nb.w / 2, y: nb.y + nb.h / 2 }, oc, rot);
      nb.x = mid.x - nb.w / 2; nb.y = mid.y - nb.h / 2;
    }
    setBox(s, nb, d.orig);
  }

  function eraseAt(p: Pt) {
    const i = hitStroke(store.frame, p);
    if (i === null) return;
    store.live((f) => { f.shapes.splice(i, 1); });
    st.sel = null;
  }

  const finish = (e: PointerEvent) => {
    const d = drag; drag = null;
    if (!d || d.kind === 'pan') return;
    const p = pt(e);
    switch (d.kind) {
      case 'draw': ghost = null; st.tool === 'review' ? reviewLoop(d.pts, e.shiftKey) : drawn(d.pts, e.altKey || st.tool === 'sketch'); redraw(); break;
      case 'erase': store.emit('app'); break;
      case 'marquee': {
        const r = marquee; marquee = null;
        if (r && (r.w > 4 / scale || r.h > 4 / scale)) setSelection([...new Set([...(d.add ? d.base : []), ...insideBox(store.frame, r)])]);
        redraw(); break;
      }
      case 'flow': {
        ghost = null;
        const s0 = d.pts[0];
        if (d.pts.every((q) => Math.hypot(q.x - s0.x, q.y - s0.y) < 6 / scale)) {
          // Boxes only count at their outline, so a tap inside one types a label instead of selecting it.
          const hit = hitStroke(store.frame, p);
          const isText = hit !== null && store.frame.shapes[hit].k === 'text';
          if (hit !== null && !isText) st.sel = hit;
          else { st.sel = null; openInline(s0); }
        } else drawn(d.pts, e.altKey);
        redraw(); break;
      }
      case 'tap': {
        if (Math.hypot(p.x - d.start.x, p.y - d.start.y) >= 6 / scale) break;
        // A tap on a box or circle (not on words already in it) selects it: type to write inside it, arrows place the words.
        const i = hitBody(store.frame, d.start), sh = i !== null ? store.frame.shapes[i] : null;
        if (i !== null && sh && (sh.k === 'ell' || (sh.k === 'rect' && !sh.grp) || sh.k === 'tlines')) setSelection([i]); else openInline(d.start);
        break;
      }
      case 'move': {
        if (!d.moved || !st.prefs.snap) break;
        const b = bounds(store.frame.shapes[d.primary]);
        const dx = snapTo(b.x, GRID) - b.x, dy = snapTo(b.y, GRID) - b.y;
        store.live((f) => { for (const j of d.orig.keys()) shift(f, j, dx, dy); relink(f, d.links); });
        store.emit('app'); break;
      }
      case 'rotate': { cv.style.cursor = st.tool === 'select' ? 'default' : 'crosshair'; break; }
      case 'resize': {
        if (!d.moved) break;
        if (d.orig.k === 'line' && (d.orig.arrow || d.orig.tail || d.orig.conn)) store.live((f) => attachArrow(f, d.idx));   // an arrow end dropped on or in a shape sticks to it
        else if (st.prefs.snap && !rotOf(d.orig)) store.live((f) => {
          const s = f.shapes[d.idx];
          if (s.k === 'line') { s.x1 = snapV(s.x1); s.y1 = snapV(s.y1); s.x2 = snapV(s.x2); s.y2 = snapV(s.y2); }
          else {
            const b = bounds(s), x0 = snapV(b.x), y0 = snapV(b.y);
            setBox(s, { x: x0, y: y0, w: Math.max(GRID, snapV(b.x + b.w) - x0), h: Math.max(GRID, snapV(b.y + b.h) - y0) }, d.orig.k === 'free' ? s : d.orig);
          }
          relink(f, d.links); refit(f, d.idx);
        });
        store.emit('app'); break;
      }
    }
  };
  cv.addEventListener('pointerup', finish);
  cv.addEventListener('pointercancel', (e) => { ghost = null; marquee = null; if (drag?.kind === 'draw') drag = null; else finish(e); redraw(); });

  /** Both ends of a drawn arrow sit at the edge of the same shape (not an arrow lying wholly inside a big box): it loops back into it. */
  function loopsBack(f: Frame, s: Extract<Shape, { k: 'line' }>, i: number): boolean {
    const b = bounds(f.shapes[i]);
    const nearEdge = (x: number, y: number) => { const dx = Math.max(b.x - x, 0, x - b.x - b.w), dy = Math.max(b.y - y, 0, y - b.y - b.h); return dx > 0 || dy > 0 || Math.min(x - b.x, b.x + b.w - x, y - b.y, b.y + b.h - y) < ATTACH_NEAR; };
    return nearEdge(s.x1, s.y1) && nearEdge(s.x2, s.y2) && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 12;
  }

  /** Snap both ends of an arrow to the nearest shapes and route it around the rest. */
  function attachArrow(f: Frame, idx: number) {
    const s = f.shapes[idx];
    if (!s || s.k !== 'line') return;
    const a = nearestTarget(f, { x: s.x1, y: s.y1 }, undefined, [idx], true);
    let b = nearestTarget(f, { x: s.x2, y: s.y2 }, undefined, [idx], true);
    if (b === a && !(a !== null && loopsBack(f, s, a))) b = null;
    if (a !== null || b !== null) connect(f, idx, a, b);
  }

  /** The last stroke that was cleaned up, while nothing else has happened: Esc turns it back into the sketch as drawn. */
  let lastDraw: { pts: Pt[]; depth: number; frame: number } | null = null;
  function keepAsSketch(): boolean {
    const d = lastDraw; lastDraw = null;
    if (!d || store.undoDepth !== d.depth || st.cur !== d.frame) return false;
    store.undo();
    drawn(d.pts, true);
    return true;
  }
  function drawn(pts: Pt[], sketch = false) {
    const f = store.frame;
    const res = recognize(pts, f.shapes, { snap: st.prefs.snap, sketch });
    if (!res) return;
    store.mutate((fr) => {
      if (res.remove !== undefined) fr.shapes.splice(res.remove, 1);
      else if (res.convert !== undefined) {
        const r = fr.shapes[res.convert];
        if (r.k === 'rect') fr.shapes[res.convert] = { k: 'img', x: r.x, y: r.y, w: r.w, h: r.h };
      } else if (res.shape) fr.shapes.push(res.shape);
      const out = sized(fr);
      if (res.gesture === 'arrow' && res.shape?.k === 'line') attachArrow(out, out.shapes.length - 1); // an arrow almost always means "from this to that"
      return out;
    });
    // In Flow a new hand-drawn path stays selected, so the arrowhead shortcut (A) is one keypress away.
    st.sel = st.tool === 'flow' && res.shape?.k === 'free' ? store.frame.shapes.length - 1 : null;
    const cleaned = res.gesture !== 'free' && res.gesture !== 'erase' && res.convert === undefined && !!res.shape && !(res.shape.k === 'free');
    lastDraw = cleaned ? { pts, depth: store.undoDepth, frame: st.cur } : null;
    toast(cleaned ? `${res.label} · Esc keeps it as a sketch` : res.label);
    flashGesture(res.gesture);
  }

  // ---------- inline text ----------
  // ---------- the keys that work right now ----------
  const keybar = $('keybar');
  /** Keys available in the current situation (mode and selection), shown above the canvas so none need remembering. */
  /** One box or circle is selected: typing writes inside it, so letters are not shortcuts until it is deselected (Space then a key still works). */
  /** Write or edit the words on an arrow: they sit on its longest run, and travel with it. */
  function labelArrow(idx: number) {
    const f = store.frame, ln = f.shapes[idx];
    if (ln.k !== 'line') return;
    const li = classify(f).byIndex.get(idx)?.labelIdx ?? null, lt = li !== null ? f.shapes[li] : null;
    if (lt && lt.k === 'text') { const tb = bounds(lt); openInline({ x: tb.x + 2, y: tb.y + tb.h / 2 }, '', { append: true }); return; }
    const sp = lineLabelSpot(ln, 'Label');
    openInline({ x: sp.mid.x - 20, y: sp.mid.y - 8 });
  }
  function typesInto(): boolean { if (selected().length !== 1 || st.sel === null) return false; const sh = store.frame.shapes[st.sel]; return !!sh && (sh.k === 'ell' || (sh.k === 'rect' && !sh.grp)); }
  function paintKeys() {
    let ks: [string, string][];
    if (play) ks = [['click', 'follow a link'], ['⌫', 'back'], ['← →', 'frames'], ['Esc', 'exit']];
    else if (st.tool === 'text' && st.sel !== null && selected().length === 1 && store.frame.shapes[st.sel]?.k === 'tlines') ks = [['← →', 'paragraph: left · centre · right'], ['↑ ↓', 'paragraph: top · middle · bottom'], ['Esc', 'deselect'], ['Space', 'all keys · search']];
    else if (st.tool === 'text' && typesInto()) ks = [['type', 'words inside it'], ['↑ ↓', 'label: above · top · middle · bottom · underneath'], ['← →', 'label: left · centre · right'], ['D', 'detach / attach text'], ['Esc', 'deselect'], ['Space', 'all keys · search']];
    else if (typesInto()) ks = [['type', 'words inside it'], ['Tab', 'next'], ['← ↑ ↓ →', 'nudge (Shift 4×)'], ['Del ⌫', 'delete'], ['Esc', 'deselect (then letters are shortcuts)'], ['⇧ + corner', 'turn'], ['> <', 'turn 45°'], ['Ctrl C X V', 'copy cut paste'], ['Ctrl D', 'duplicate'], ['Space', 'all keys · search'], ['?', 'help']];
    else if (st.sel !== null && selected().length === 1 && isConnector(store.frame.shapes[st.sel])) ks = [['Enter', 'write a label on it'], ['← → ↑ ↓', 'arrowhead on / off at that end'], ['⇧ + arrows', 'nudge'], ['A', 'arrowhead at the end'], ['L', 'link to frame'], ['Del ⌫', 'delete'], ['Esc', 'deselect'], ['Space', 'all keys · search']];
    else if (imgIdx() !== null) ks = [['Enter', 'describe it'], ['P', 'put a picture in it'], ['⇧P', 'take the picture out'], ['drop / paste', 'a picture onto it'], ['← ↑ ↓ →', 'nudge (Shift 4×)'], ['Del ⌫', 'delete'], ['Esc', 'deselect'], ['Space', 'all keys · search']];
    else if (selected().length) ks = [['Tab', 'next'], ['← ↑ ↓ →', 'nudge (Shift 4×)'], ['Del ⌫', 'delete'], ['Esc', 'deselect'], ['A', 'arrowhead'], ['Q', 'border'], ['⇧ + corner', 'turn'], ['> <', 'turn 45°'], ['B', 'save as part'], ['L', 'link to frame'], ['Ctrl C X V', 'copy cut paste'], ['Ctrl D', 'duplicate'], ['Space', 'all keys · search'], ['?', 'help']];
    else {
      const common: [string, string][] = [['Space', 'all keys · search'], ['?', 'help'], ['/', 'stamps & parts'], ['1-9', 'jump to frame'], ['+ −', 'zoom (0 fits)']];
      ks = ({
        flow: [['drag', 'draw'], ['tap', 'type (try /radio)'], ['tap a shape', 'select'], ['Shift+drag', 'box select'], ['Ctrl A', 'select all']],
        draw: [['drag', 'draw a shape, line or arrow'], ['Alt+drag', 'keep as sketch'], ['S', 'sketch mode'], ['hook the end', 'arrow'], ['scribble back and forth', 'paragraph'], ['F', 'flow mode']],
        sketch: [['drag', 'sketch: kept exactly as drawn'], ['D', 'back to clean-up'], ['F', 'flow mode']],
        text: [['tap', 'add text'], ['Enter', 'done'], ['Shift+Enter', 'new line']],
        select: [['tap', 'select'], ['drag', 'box select'], ['Shift+tap', 'add to selection'], ['Ctrl A', 'all']],
        erase: [['drag over a shape', 'erase it'], ['scribble out', 'also erases']],
        review: [['tap an element', 'say what a note is about'], ['Shift+tap', 'add another'], ['loop several', 'at once'], ['type', 'write the note']],
      } as Record<Tool, [string, string][]>)[st.tool].concat(common);
    }
    // Space and ? are also buttons here, so the palette and the help are one click away for anyone using the mouse.
    keybar.innerHTML = ks.map(([k, l]) => (k === 'Space' || k === '?' ? `<button class="kbl" data-open="${k === '?' ? 'help' : 'keys'}"><kbd>${k}</kbd>${l}</button>` : `<span><kbd>${k}</kbd>${l}</span>`)).join('');
    keybar.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => { b.onclick = () => (b.dataset.open === 'help' ? openHowTo() : openKeys()); });
  }

  // ---------- "/" pop-up: every stamp with a one-liner, filtered as you type ----------
  const slash = $('slash');
  let slashItems: ReturnType<typeof slashMatches> = [], slashSel = 0;
  const slashWord = () => { const v = inl.value; return v.startsWith('/') && !/\s/.test(v) ? v.slice(1).toLowerCase() : null; };
  function paintSlash() {
    const q = slashWord();
    slashItems = q === null ? [] : slashMatches(q, st.board.parts);   // everything, parts included; the pop-up scrolls
    if (!slashItems.length) { slash.hidden = true; return; }
    slashSel = Math.min(slashSel, slashItems.length - 1);
    slash.textContent = '';
    slashItems.forEach((it, i) => {
      const d = document.createElement('div');
      if (i === slashSel) d.className = 'on';
      d.innerHTML = `<b></b><span></span>${it.also.length ? '<small></small>' : ''}`;
      (d.querySelector('b') as HTMLElement).textContent = `/${it.name}`;
      if (st.board.parts?.[it.name]) d.classList.add('mine');
      (d.querySelector('span') as HTMLElement).textContent = it.hint;
      const sm = d.querySelector('small'); if (sm) sm.textContent = it.also.map((a) => '/' + a).join(' ');
      d.onmousedown = (e) => { e.preventDefault(); completeSlash(i); };
      slash.append(d);
    });
    (slash.querySelector('.on') as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
    slash.style.left = inl.style.left;
    slash.style.top = `${parseFloat(inl.style.top) + inl.offsetHeight + 4}px`;
    slash.hidden = false;
  }
  function completeSlash(i: number) {
    inl.value = `/${slashItems[i].name} `; inl.setSelectionRange(inl.value.length, inl.value.length);
    fitInl(); slashSel = 0; paintSlash(); inl.focus();
  }
  /** Handle a key for the pop-up; true when it was consumed. */
  function slashKey(ev: KeyboardEvent): boolean {
    if (slash.hidden || !slashItems.length) return false;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); slashSel = (slashSel + (ev.key === 'ArrowDown' ? 1 : -1) + slashItems.length) % slashItems.length; paintSlash(); return true; }
    const q = slashWord() ?? '';
    const exact = [slashItems[slashSel].name, ...slashItems[slashSel].also].includes(q);
    if (ev.key === 'Tab' || (ev.key === 'Enter' && !ev.shiftKey && !exact)) { ev.preventDefault(); completeSlash(slashSel); return true; }
    return false;
  }

  /** A one-line label box at a canvas point. Enter commits and asks for the next (cont = true); Escape cancels; clicking away commits and stops. */
  function promptAt(x: number, y: number, placeholder: string, cb: (text: string | null, cont: boolean) => void) {
    inl.hidden = false; inl.value = ''; inl.placeholder = placeholder;
    inl.style.fontSize = `${18 * scale}px`;
    const cr = cv.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    inl.style.left = `${cr.left - wr.left + wrap.scrollLeft + x * scale - 3}px`;   // the stage scrolls when zoomed in
    inl.style.top = `${cr.top - wr.top + wrap.scrollTop + (y - 22) * scale}px`;
    inl.style.height = `${26 * scale}px`;
    inl.focus(); fitInl();
    let done = false;
    const end = (text: string | null, cont: boolean) => { if (done) return; done = true; inl.hidden = true; inl.onblur = inl.onkeydown = null; cb(text, cont); };
    inl.onkeydown = (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); end(inl.value.replace(/\s+$/, ''), true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); end(null, false); }
      ev.stopPropagation();
    };
    inl.onblur = () => end(inl.value.replace(/\s+$/, '') || null, false);
  }

  /**
   * Radios, checkboxes and list rows are typed one after another: type the label, Enter makes the next one below and
   * waits for its label; Enter on an empty label (or Escape) ends. Radios and checkboxes get a border once there are two.
   * `done` holds the shape indices of the items made so far; `border` the index of the group's border once it exists.
   */
  function continueStack(kind: 'radio' | 'checkbox' | 'list', x: number, y: number, done: number[][], border: number | null) {
    const sf = frameSize(store.frame), ctx = { W: sf.w, phone: store.frame.device === 'phone' };
    const bare = stampFromText(`/${kind}`, x, y, ctx)!.shapes;
    const lab = stampFromText(`/${kind} X`, x, y, ctx)!.shapes.find((s) => s.k === 'text') as Extract<Shape, { k: 'text' }>;
    const boxes = bare.map(bounds), h = Math.max(...boxes.map((b) => b.y + b.h)) - y;
    if (y + h > sf.h - GRID) { toast('Out of room on this frame'); return; }
    const first = store.frame.shapes.length, mine = bare.map((_, i) => first + i);
    store.mutate((fr) => { fr.shapes.push(...bare); }, { key: `stack${st.cur}` });
    promptAt(lab.x, lab.y, 'label. Enter adds the next, empty Enter ends', (text, cont) => {
      if (!text) { // nothing typed: drop the blank one and stop
        store.mutate((fr) => deleteShapes(fr, mine), { key: `stack${st.cur}` });
        return;
      }
      const labelIdx = first + bare.length, items = [...done, [...mine, labelIdx]]; // each item: its shapes and its label
      let b = border;
      const rowH = kind === 'list' ? Math.max(56, Math.round(textBlock(text).h + 26)) : Math.max(h, Math.round(textBlock(text).h + 6)); // extra lines make the row taller
      store.mutate((fr) => {
        if (kind === 'list') (fr.shapes[first] as { h: number }).h = rowH;
        fr.shapes.push({ k: 'text', x: lab.x, y: lab.y, s: text });
        if (GROUPED_KINDS.includes(kind) && items.length >= 2) {
          const around = borderFor(items.flat().map((i) => fr.shapes[i]));
          if (b === null) { b = fr.shapes.length; fr.shapes.push(around); } else fr.shapes[b] = around;
        }
      }, { key: `stack${st.cur}` });
      if (cont) continueStack(kind, x, y + rowH + 10, items, b);
    });
  }

  /** `append`: editing existing text, add `initial` to its end instead of replacing it. `into`: the shape being typed into (new text is centred in a circle). */
  function openInline(p: Pt, initial = '', opts: { append?: boolean; into?: number } = {}) {
    const f = store.frame;
    let editIdx: number | null = null;
    for (let i = f.shapes.length - 1; i >= 0; i--) {
      const s = f.shapes[i];
      if (s.k !== 'text') continue;
      const b = bounds(s), tol = 6 / scale;
      if (p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol) { editIdx = i; break; }
    }
    const existing = editIdx !== null ? (f.shapes[editIdx] as Extract<Shape, { k: 'text' }>) : null;
    const x = existing ? existing.x : snapV(p.x), y = existing ? existing.y : snapV(p.y + 6);
    inl.hidden = false;
    inl.value = existing ? (opts.append ? existing.s + initial : existing.s) : initial;
    inl.placeholder = existing ? '' : 'type, or /radio /check /btn /field /img';
    inl.style.fontSize = `${18 * scale}px`;
    const cr = cv.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    inl.style.left = `${cr.left - wr.left + wrap.scrollLeft + x * scale - 3}px`;   // the stage scrolls when zoomed in
    inl.style.top = `${cr.top - wr.top + wrap.scrollTop + (y - 22) * scale}px`;
    inl.style.height = `${26 * scale}px`;
    inl.focus(); if (initial && (!existing || opts.append)) inl.setSelectionRange(inl.value.length, inl.value.length); else inl.select(); fitInl();
    slashSel = 0; inl.oninput = () => { fitInl(); paintSlash(); }; paintSlash();
    let done = false;
    const commit = (keep: boolean) => {
      if (done) return; done = true; slash.hidden = true; inl.oninput = null;
      const v = inl.value.replace(/\s+$/, '').replace(/^\s*\n/, '');
      inl.hidden = true; inl.onblur = inl.onkeydown = null;
      if (!keep) return;
      if (editIdx !== null) {
        const idx = editIdx;
        if (!v) store.mutate((fr) => { fr.shapes.splice(idx, 1); return sized(fr); });
        else if (v !== existing!.s) store.mutate((fr) => { (fr.shapes[idx] as { s: string }).s = v; return sized(fr); });
      } else if (v.startsWith('/')) {
        // Stamp: "/radio Email, SMS" drops real elements here instead of plain text.
        const sf = frameSize(store.frame);
        const ps = parseStamp(v, st.board.parts);
        const chain = ps && ps.kind && ps.kind !== 'part' && CHAIN_KINDS.includes(ps.kind) && ps.labels.length <= 1 ? (ps.kind as 'radio' | 'checkbox' | 'list') : null;
        if (chain && !ps!.labels[0]) { continueStack(chain, snapV(p.x), snapV(p.y), [], null); return; } // "/radio": type the first label right away
        const r = stampFromText(v, snapV(p.x), snapV(p.y), { W: sf.w, phone: store.frame.device === 'phone' }, st.board.parts);
        if (!r) { toast(`Unknown stamp. Try /radio /check /btn /field /img /card /header /list${Object.keys(st.board.parts ?? {}).map((n) => ' /' + n).join('')}`); return; }
        const first = store.frame.shapes.length;
        store.mutate((fr) => { fr.shapes.push(...r.shapes); return sized(fr); });
        setSelection(primaries(r.shapes.map((_, i) => first + i))); // stamped elements arrive selected
        if (chain) { // "/radio Email": carry on with the next one underneath
          const bb = r.shapes.map(bounds), hh = Math.max(...bb.map((q) => q.y + q.h)) - Math.min(...bb.map((q) => q.y)) + 4;
          continueStack(chain, snapV(p.x), snapV(p.y) + hh + 10, [r.shapes.map((_, i) => first + i)], null);
        }
      } else if (v) store.mutate((fr) => {
        const t: Extract<Shape, { k: 'text' }> = { k: 'text', x: Math.round(x), y: Math.round(y), s: v };
        const host = opts.into !== undefined ? fr.shapes[opts.into] : undefined;
        if (host && (host.k === 'ell' || host.k === 'rect') && !host.lbl) host.lbl = 'middle'; // words typed into a shape are its label: inside, centred, until told otherwise
        fr.shapes.push(t); return sized(fr);
      });
    };
    inl.onkeydown = (ev) => {
      if (slashKey(ev)) { ev.stopPropagation(); return; }
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commit(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
      ev.stopPropagation();
    };
    inl.onblur = () => commit(true);
  }

  // ---------- review mode ----------
  const describe = (f: Frame, i: number) => {
    const e = classify(f).byIndex.get(i);
    return e ? `${e.role}${e.label ? ` "${e.label}"` : ''}` : 'Shape';
  };
  /** Box around some elements and their labels. */
  function unionBox(f: Frame, hits: number[]): Box {
    const c = classify(f);
    let u: Box | null = null;
    for (const i of hits) {
      const e = c.byIndex.get(i);
      for (const j of e && e.labelIdx !== null ? [i, e.labelIdx] : [i]) {
        const b = bounds(f.shapes[j]);
        if (!u) { u = b; continue; }
        const x0 = Math.min(u.x, b.x), y0 = Math.min(u.y, b.y);
        u = { x: x0, y: y0, w: Math.max(u.x + u.w, b.x + b.w) - x0, h: Math.max(u.y + u.h, b.y + b.h) - y0 };
      }
    }
    return u ?? { x: 40, y: 40, w: 0, h: 0 };
  }
  /** What a note is about: the elements looped or tapped in Review, otherwise whatever is selected (on the canvas or in the Outline). */
  const reviewTargets = () => (st.focus.length ? st.focus : primaries(selected()));
  /** A loop around elements, a tap on one (Shift adds), or a tap on empty space (clears) sets what the next note is about. */
  function reviewLoop(pts: Pt[], additive = false) {
    const f = store.frame, c = classify(f);
    const s0 = pts[0], isTap = pts.every((q) => Math.hypot(q.x - s0.x, q.y - s0.y) < 6 / scale);
    if (isTap) {
      const hit = hitStroke(f, s0) ?? hitBody(f, s0);
      if (hit === null) { if (!additive) { store.clearFocus(); setSelection([]); updateReview(); redraw(); } return; }   // a stray Shift+tap changes nothing
      const idx = c.owner.get(hit) ?? hit;
      st.focus = additive ? (st.focus.includes(idx) ? st.focus.filter((x) => x !== idx) : [...st.focus, idx]) : [idx];
      st.focusBox = st.focus.length ? unionBox(f, st.focus) : null;
      updateReview(); redraw();
      $<HTMLTextAreaElement>('change').focus();
      return;
    }
    if (pathLen(pts) < 40) return;
    const hits = c.els.filter((e) => { const m = center(bounds(f.shapes[e.i])); return pointInPoly(m.x, m.y, pts); });
    if (!hits.length) { toast('Nothing inside that loop'); return; }
    st.focus = hits.map((e) => e.i);
    const u = unionBox(f, st.focus), lb = bbox(pts);
    st.focusBox = hits.length === 1 ? u : { x: Math.min(u.x, lb.x), y: Math.min(u.y, lb.y), w: Math.max(u.x + u.w, lb.x + lb.w) - Math.min(u.x, lb.x), h: Math.max(u.y + u.h, lb.y + lb.h) - Math.min(u.y, lb.y) };
    updateReview();
    $<HTMLTextAreaElement>('change').focus();
  }
  function updateReview() {
    const f = store.frame;
    const targets = reviewTargets();
    const names = targets.map((i) => describe(f, i));
    const chip = $('focusChip');
    chip.textContent = names.length ? `${st.focus.length ? 'About' : 'Selected'}: ${names.slice(0, 4).join(', ')}${names.length > 4 ? `, +${names.length - 4} more` : ''}` : 'Tap or loop elements (or select them) to say what a note is about';
    $('bFocusX').hidden = !(st.focus.length || names.length);
    const ol = $('notes');
    ol.textContent = '';
    $('ncount').textContent = f.notes.length ? `(${f.notes.filter((x) => !x.done).length} open of ${f.notes.length})` : '';
    $('nempty').hidden = f.notes.length > 0;
    f.notes.forEach((n, i) => {
      const li = document.createElement('li');
      if (n.done) li.className = 'done';
      const txt = document.createElement('span'); txt.className = 't'; txt.textContent = n.text + ' '; txt.title = 'Click to edit this note';
      txt.onclick = () => {
        const ta = document.createElement('textarea');
        ta.className = 'noteedit'; ta.value = n.text; ta.rows = 2;
        txt.replaceWith(ta); ta.focus(); ta.select();
        let closed = false;
        const finish = (save: boolean) => {
          if (closed) return; closed = true;
          const v = ta.value.trim();
          if (save && v && v !== n.text) store.mutate((fr) => { fr.notes[i].text = v; }, { key: `note${st.cur}:${i}`, src: 'panel' });
          else updateReview();
        };
        ta.onblur = () => finish(true);
        ta.onkeydown = (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ta.blur(); } else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); } ev.stopPropagation(); };
      };
      li.append(txt);
      const tick = document.createElement('button');
      tick.textContent = n.done ? '↺' : '✓'; tick.title = n.done ? 'Reopen this note' : 'Mark as done'; tick.setAttribute('aria-label', tick.title);
      tick.onclick = () => store.mutate((fr) => { const t = fr.notes[i]; if (t.done) delete t.done; else t.done = true; });
      li.append(tick);
      const x = document.createElement('button'); x.textContent = '×'; x.title = 'Delete note'; x.setAttribute('aria-label', 'Delete note');
      x.onclick = () => store.mutate((fr) => { fr.notes.splice(i, 1); });
      li.append(x);
      if (n.reply) { const r = document.createElement('div'); r.className = 'reply'; r.textContent = `AI: ${n.reply}`; li.append(r); }
      ol.append(li);
    });
  }
  $('bFocusX').onclick = () => { store.clearFocus(); setSelection([]); updateReview(); redraw(); };
  $('bNote').onclick = () => {
    const ta = $<HTMLTextAreaElement>('change'), text = ta.value.trim();
    if (!text) { toast('Type the note in the box first'); ta.focus(); return; }
    const f = store.frame;
    const targets = reviewTargets();
    const fb = st.focusBox && st.focus.length ? st.focusBox : targets.length ? unionBox(f, targets) : null;
    const box: [number, number, number, number] = fb ? [fb.x, fb.y, fb.w, fb.h] : [40, 40, 0, 0];
    const about = targets.map((i) => describe(f, i));
    store.mutate((fr) => { fr.notes.push(newNote(text, box, about)); });
    ta.value = '';
    toast('Note added');
  };
  // ---------- screenshots ----------
  async function addScreenshot(file: Blob) {
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('bad image')); i.src = url; });
      URL.revokeObjectURL(url);
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      const bg = c.toDataURL('image/jpeg', 0.82);
      const tall = c.height > c.width * 1.2;
      const f = store.frame;
      if (f.shapes.length || f.bg) {
        const nf = newFrame(tall ? 'phone' : f.device);
        nf.bg = bg;
        store.addFrameAfter(nf);
      } else store.mutate((fr) => { fr.bg = bg; if (tall) fr.device = 'phone'; });
      toast('Image added behind the frame. Press K to trace it into shapes (offline), or ask your AI (over MCP) to build it.');
    } catch { toast('Could not read that image'); }
  }
  /** Offline trace of the frame's background image (a photo of a sketch, or a screenshot) into wireframe shapes. */
  async function traceBackground() {
    const f = store.frame;
    if (!f.bg) { toast('Drop or paste a photo of a sketch (or a screenshot) onto the frame first'); return; }
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('bad image')); i.src = f.bg!; });
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0);
      const r = traceImage(g.getImageData(0, 0, c.width, c.height), { device: f.device });
      if (!r.shapes.length) { toast('Found no strokes to trace. A dark pen on light paper works best.'); return; }
      const first = f.shapes.length;
      store.mutate((fr) => { fr.shapes.push(...r.shapes); return sized(fr); });
      setSelection(primaries(r.shapes.map((_, i) => first + i)));
      toast(`Traced ${r.shapes.length} shapes${r.texts ? `; ${r.texts} handwriting spot${r.texts > 1 ? 's are' : ' is'} marked "Label", type the real text in the Outline` : ''}. The image stays muted behind the frame as a reference.`);
    } catch { toast('Could not read that image'); }
  }
  $('bShot').onclick = () => $<HTMLInputElement>('fileIn').click();
  $<HTMLInputElement>('fileIn').onchange = (e) => {
    const t = e.target as HTMLInputElement;
    const file = t.files?.[0];
    if (file) addScreenshot(file);
    t.value = '';
  };
  // ---------- a picture in an image element ----------
  const imgIdx = (): number | null => { const i = st.sel; return i !== null && selected().length === 1 && store.frame.shapes[i]?.k === 'img' ? i : null; };
  async function putPicture(idx: number, file: Blob) {
    try {
      const src = await shrinkPicture(file);
      store.mutate((fr) => { const s = fr.shapes[idx]; if (s?.k === 'img') { s.src = src; s.fn = picName(file); } return sized(fr); });
      toast('Picture in place. Press Shift+P to take it out; Enter writes its description.');
    } catch { toast('Could not read that image'); }
  }
  const pickPicture = (idx: number) => chooseFile((f) => void putPicture(idx, f));
  function takePictureOut() {
    const i = imgIdx(), s = i !== null ? store.frame.shapes[i] : null;
    if (i === null || s?.k !== 'img' || !s.src) { toast('Select an image that has a picture in it'); return; }
    store.mutate((fr) => { const q = fr.shapes[i]; if (q?.k === 'img') { delete q.src; delete q.fn; } });
  }
  /** Enter on an image: write (or edit) its description, which sits underneath it. */
  function describeImage(idx: number) {
    const f = store.frame, im = f.shapes[idx];
    if (im.k !== 'img') return;
    const li = classify(f).byIndex.get(idx)?.labelIdx ?? null, lt = li !== null ? f.shapes[li] : null;
    if (lt && lt.k === 'text') { const tb = bounds(lt); openInline({ x: tb.x + 2, y: tb.y + tb.h / 2 }, '', { append: true }); return; }
    openInline({ x: im.x + im.w / 2 - 40, y: im.y + im.h + 22 });
  }
  $('bShotX').onclick = () => store.mutate((fr) => { delete fr.bg; });
  wrap.addEventListener('dragover', (e) => { e.preventDefault(); wrap.classList.add('drop'); });
  wrap.addEventListener('dragleave', () => wrap.classList.remove('drop'));
  // Work that is not in a file yet: anything on the board that differs from the last save or open (the example board does not count).
  let savedJson = '';
  const unsaved = () => !st.board.example && st.board.frames.some((f) => f.shapes.length) && JSON.stringify(st.board) !== savedJson;
  function sure(title: string, text: string): Promise<'save' | 'discard' | 'cancel'> {
    const d = $<HTMLDialogElement>('dSure');
    $('sureTitle').textContent = title; $('sureText').textContent = text;
    return new Promise((resolve) => {
      const done = () => { d.removeEventListener('close', done); resolve(d.returnValue === 'save' || d.returnValue === 'discard' ? d.returnValue : 'cancel'); };
      d.returnValue = ''; d.addEventListener('close', done); d.showModal();
    });
  }
  /** Before replacing the board: offer to save it if it has work that is not in a file. False means stop. */
  async function okToReplace(what: string): Promise<boolean> {
    if (!unsaved()) return true;
    const r = await sure(`${what}? This drawing is not saved`, 'Save it to a file first, or carry on and leave it behind (Undo can still bring it back until you close the page).');
    if (r === 'cancel') return false;
    if (r === 'save' && !(await doSave())) return false;
    return true;
  }
  const failed = (err: unknown) => toast(`That did not work: ${(err as Error).message ?? err}`);
  const openFile = async (get: () => Promise<Board | null>) => {
    try {
      if (!(await okToReplace('Open another file'))) return;
      const b = await get();
      if (b) { store.replaceBoard(b); savedJson = JSON.stringify(st.board); toast(`Opened ${b.frames.length} frame${b.frames.length > 1 ? 's' : ''} (Undo to go back)`); }
    } catch (err) { failed(err); }
  };
  const doSave = async (as = false): Promise<boolean> => {
    try { const n = await saveBoard(st.board, as, (def) => ask('Save as', 'File name. This browser saves straight to your downloads folder; Chrome and Edge let you pick the folder.', def)); if (n) { savedJson = JSON.stringify(st.board); toast(`Saved ${n}`); } return !!n; }
    catch (err) { failed(err); return false; }
  };
  const newDrawing = async () => {
    if (!(await okToReplace('Start a new drawing'))) return;
    store.startFresh(); forgetFile(); savedJson = JSON.stringify(st.board); toast('New drawing (Undo brings the old one back)');
  };
  $('bNew').onclick = () => void newDrawing();
  $('bOpen').onclick = () => void openFile(openBoard);
  $('bSave').onclick = () => void doSave();
  wrap.addEventListener('drop', (e) => {
    e.preventDefault(); wrap.classList.remove('drop');
    const data = [...(e.dataTransfer?.files ?? [])].find((x) => /\.(json|axsq)$/i.test(x.name));
    if (data) { void openFile(() => readBoard(data)); return; }
    const file = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith('image/'));
    if (file) {   // dropped on an image element: the picture goes in it; anywhere else it goes behind the frame
      const hit = hitBody(store.frame, pt(e)), hs = hit !== null ? store.frame.shapes[hit] : null;
      if (hit !== null && hs?.k === 'img') { setSelection([hit]); void putPicture(hit, file); } else addScreenshot(file);
    } else toast('Drop an image or a board (.json) file');
  });
  const typing = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  };
  // ---------- copy, cut, paste, duplicate ----------
  // Copied elements are kept in memory and also put on the system clipboard as JSON, so they paste into another frame,
  // another board, or another browser window. Pasting into the frame they came from steps them down-right so copies never hide each other.
  let clip: { part: Part; ox: number; oy: number; from: string; n: number } | null = null;
  const CLIP_TAG = 'axsquiggle-clip';
  function takeCopy(): { text: string } | null {
    const sel = selected(), f = store.frame;
    if (!sel.length) return null;
    const part = makePart(f, sel), o = selectionOrigin(f, sel);
    if (!part || !o) return null;
    clip = { part, ox: o.x, oy: o.y, from: f.id, n: 0 };
    return { text: JSON.stringify({ [CLIP_TAG]: 1, part, ox: o.x, oy: o.y }) };
  }
  /** Put a copy on the frame: back where it came from when pasting into another frame, stepped 20px when pasting into the same one. */
  function pasteClip(c: { part: Part; ox: number; oy: number; from?: string; n?: number }, fresh: boolean) {
    const f = store.frame, sf = frameSize(f);
    const same = c.from === f.id;
    const step = same || fresh ? GRID * ((fresh ? 0 : (clip?.n ?? 0)) + 1) : 0;
    if (clip && same && !fresh) clip.n++;
    const x = c.ox + step, y = Math.min(c.oy + step, Math.max(0, sf.h - c.part.h - GRID));
    const first = f.shapes.length, shapes = instantiate(c.part, x, y, sf.w);
    store.mutate((fr) => { fr.shapes.push(...shapes); return fr; });
    setSelection(primaries(shapes.map((_, i) => first + i)));
    toast(`Pasted ${primaries(shapes.map((_, i) => first + i)).length} element${shapes.length > 1 ? 's' : ''}`);
  }
  document.addEventListener('copy', (e) => {
    if (typing(e.target) || play) return;
    const c = takeCopy();
    if (c) { e.preventDefault(); e.clipboardData?.setData('text/plain', c.text); }
  });
  // Some browsers/contexts never raise copy/paste events for the canvas. The keys therefore also work from the key handler:
  // the copy lives in memory (and is offered to the system clipboard), and a paste with no paste event follows 80ms later.
  let pasteSeen = false;
  const copyKey = (cut: boolean) => {
    const c = takeCopy();
    if (!c) return;
    navigator.clipboard?.writeText(c.text).catch(() => { /* memory copy still works */ });
    if (cut) deleteSel(); else toast('Copied');
  };
  const pasteKey = () => { pasteSeen = false; window.setTimeout(() => { if (!pasteSeen && clip) pasteClip(clip, false); }, 80); };
  const duplicateSel = () => {
    const c = takeCopy();
    if (c && clip) pasteClip({ ...clip, from: '' }, true);
    else toast('Select something to duplicate first');
  };
  document.addEventListener('paste', (e) => {
    pasteSeen = true;
    if (typing(e.target)) return;
    const asText = e.clipboardData?.getData('text/plain') ?? '';
    if (asText.includes(`"${CLIP_TAG}"`)) {
      try {
        const j = JSON.parse(asText) as { part: Part; ox: number; oy: number };
        if (j.part && Array.isArray(j.part.shapes)) {
          e.preventDefault();
          const mine = clip && JSON.stringify(clip.part) === JSON.stringify(j.part) ? clip : null;
          pasteClip(mine ?? { part: j.part, ox: j.ox ?? GRID, oy: j.oy ?? GRID }, false);
          return;
        }
      } catch { /* not ours: fall through to the ordinary paste handling */ }
    }
    // The system clipboard may not hold our copy (a browser can refuse the write; or something else was copied since). The canvas cannot use
    // plain text anyway, so unless the clipboard has an image or a whole board, paste the elements copied in the app.
    const hasImage = [...(e.clipboardData?.items ?? [])].some((i) => i.type.startsWith('image/'));
    const t = asText.trim(), isBoard = (t.startsWith('{') || t.startsWith('[')) && !!fromRawJSON(asText);
    if (!hasImage && !isBoard && clip) { e.preventDefault(); pasteClip(clip, false); return; }
    pasteLegacy(e);
  });
  function pasteLegacy(e: ClipboardEvent) {
    if (typing(e.target)) return;
    const items = [...(e.clipboardData?.items ?? [])];
    const img = items.find((i) => i.type.startsWith('image/'));
    if (img) { e.preventDefault(); const file = img.getAsFile(), ii = imgIdx(); if (file) { if (ii !== null) void putPicture(ii, file); else addScreenshot(file); } return; }
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const board = text.trim().startsWith('{') || text.trim().startsWith('[') ? fromRawJSON(text) : null;
    if (board) { e.preventDefault(); store.replaceBoard(board); toast(`Imported ${board.frames.length} frame${board.frames.length > 1 ? 's' : ''} (Undo to revert)`); }
  }

  // ---------- toolbar ----------
  const toolBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-tool]')];
  function setTool(t: Tool) {
    if (play) setPlay(false);
    st.tool = t; drag = null; ghost = null;
    if (!inl.hidden) inl.blur();
    cv.style.cursor = t === 'select' ? 'default' : t === 'text' ? 'text' : 'crosshair';
    syncUi(); paintKeys(); redraw();
  }
  toolBtns.forEach((b) => (b.onclick = () => setTool(b.dataset.tool as Tool)));
  const toggle = (id: string, key: 'snap' | 'roles') => {
    $(id).onclick = () => { st.prefs[key] = !st.prefs[key]; store.savePrefs(); syncUi(); redraw(); };
  };
  toggle('tGrid', 'snap'); toggle('tRoles', 'roles');
  const undo = () => { if (!store.undo()) toast('Nothing to undo'); };
  $('bUndo').onclick = undo;
  $('bExport').onclick = () => openExport($<HTMLDialogElement>('dExport') , st.board, toast);
  document.querySelectorAll('.dclose').forEach((b) => ((b as HTMLElement).onclick = () => (b.closest('dialog') as HTMLDialogElement).close()));
  $('bFresh').onclick = () => store.startFresh();

  // ---------- AI bridge ----------
  const sync = new Sync(store, toast);
  const paintSync = () => {
    $('bAi').classList.toggle('on', sync.state === 'on');
    $('bAi').classList.toggle('err', sync.state === 'error');
    $('brStatus').textContent = { off: 'Not connected.', connecting: 'Connecting...', on: 'Connected. Your edits and notes are available to the AI through MCP; its edits arrive here as an undoable change.', error: 'The bridge is not answering. Is it running?' }[sync.state];
  };
  const dBoards = $<HTMLDialogElement>('dBoards'), bq = $<HTMLInputElement>('bq'), bres = $('bres');
  let boardRows: { name: string; frames: number; changed: number; open: boolean }[] = [], bAct = 0;
  const bShown = () => boardRows.filter((b) => b.name.toLowerCase().includes(bq.value.trim().toLowerCase()));
  const paintBoards = () => {
    const rows = bShown();
    bres.textContent = '';
    rows.forEach((b, i) => {
      const el = document.createElement('button');
      el.className = i === bAct ? 'on' : ''; el.setAttribute('role', 'option');
      el.innerHTML = `<span class="fr">${b.frames}</span><span class="txt">${b.name.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)}${b.open ? ' <small>(open)</small>' : ''}</span>`;
      el.onclick = () => void goBoard(b.name, false);
      bres.append(el);
    });
    if (!rows.length && bq.value.trim()) bres.innerHTML = '<div class="none">No such board: Enter makes it.</div>';
    (bres.children[bAct] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  };
  const goBoard = async (name: string, create: boolean) => {
    dBoards.close();
    try { await sync.openNamed(name, create); } catch (e) { toast((e as Error).message); }
  };
  const openBoards = async () => {
    if (sync.state !== 'on') { toast('Connect to the MCP bridge first (MCP button)'); return; }
    try { boardRows = (await sync.boards()).boards; } catch (e) { toast((e as Error).message); return; }
    bq.value = ''; bAct = Math.max(0, boardRows.findIndex((b) => b.open)); paintBoards();
    if (!dBoards.open) dBoards.showModal();
    bq.focus();
  };
  bq.addEventListener('input', () => { bAct = 0; paintBoards(); });
  bq.addEventListener('keydown', (e) => {
    const rows = bShown();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (rows.length) { bAct = (bAct + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length; paintBoards(); } }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const typed = bq.value.trim();
      const exact = boardRows.find((b) => b.name.toLowerCase() === typed.toLowerCase());
      if (exact) void goBoard(exact.name, false);
      else if (rows[bAct]) void goBoard(rows[bAct].name, false);
      else if (typed) void goBoard(typed, true);
    }
  });
  $('bBoards').onclick = () => void openBoards();
  sync.onChange = () => {
    paintSync();
    const b = $('bBoards');
    b.hidden = sync.state !== 'on' || !sync.name;
    b.textContent = sync.name;
  };
  $('bAi').onclick = () => {
    $<HTMLInputElement>('brUrl').value = sync.config?.url ?? (window as unknown as { __AXSQ__?: { url?: string } }).__AXSQ__?.url ?? 'http://127.0.0.1:4747';
    $<HTMLInputElement>('brTok').value = sync.config?.token ?? '';
    paintSync(); $<HTMLDialogElement>('dBridge').showModal();
  };
  $('brGo').onclick = async () => {
    const url = $<HTMLInputElement>('brUrl').value.trim(), token = $<HTMLInputElement>('brTok').value.trim();
    if (!url || !token) { toast('Enter the bridge URL and token'); return; }
    if (await sync.connect({ url, token })) $<HTMLDialogElement>('dBridge').close();
  };
  $('brOff').onclick = () => { sync.disconnect(); toast('Disconnected from the MCP bridge'); };
  const fromUrl = Sync.fromLocation();
  if (fromUrl) void sync.connect(fromUrl); else if (sync.config) void sync.connect();
  $('bPanel').onclick = () => document.body.classList.toggle('panel-open');
  $('bAdd').onclick = () => store.addFrameAfter();
  $<HTMLSelectElement>('device').onchange = (e) => store.mutate((f) => { f.device = (e.target as HTMLSelectElement).value as Frame['device']; });
  const cap = $<HTMLInputElement>('caption');
  cap.oninput = () => store.mutate((f) => { f.caption = cap.value; }, { key: `cap${st.cur}`, src: 'panel' });

  // panel tabs
  const outline = new Outline(store, $('pOutline'), redraw);
  buildLegend($('pLegend'));
  /** The animated guide, as a page of its own in a new tab (built from a blob, so it works from a file, the bridge or a hosted copy). */
  const openHowTo = (section = '') => {
    const url = URL.createObjectURL(new Blob([howtoHtml], { type: 'text/html' }));
    window.open(url + (section ? `#${section}` : ''), '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  $('bHelp').onclick = () => openHowTo();
  /** Change a part's one-line description (Enter with nothing typed clears it). */
  async function editPartNote(name: string) {
    const cur = st.board.parts?.[name]?.note ?? '';
    const v = await ask(`What is /${name} for?`, 'One line. Shown in the Parts tab and in the ? list. Leave empty to clear.', cur, true);
    if (v === null) return;
    store.mutate((_, b) => { const p = b.parts?.[name]; if (!p) return; if (v) p.note = v.slice(0, 120); else delete p.note; }, { src: 'panel' });
  }
  const partsPanel = new PartsPanel(store, $('pParts'), (name) => placePart(name), () => openHowTo('parts'), (name) => { void editPartNote(name); });
  /** Drop a saved part below everything on the frame (or at a tapped spot) and select what was placed. */
  function placePart(name: string, at?: Pt) {
    const part = st.board.parts?.[name];
    if (!part) return;
    const f = store.frame, sf = frameSize(f);
    const spot = at ?? spotFor(part.w, part.h);
    const x = snapV(spot.x), y = snapV(spot.y);
    const first = f.shapes.length, shapes = instantiate(part, x, y, sf.w);
    store.mutate((fr) => { fr.shapes.push(...shapes); return fr; });
    setSelection(primaries(shapes.map((_, i) => first + i)));
    toast(`Placed /${name}`);
  }
  /** Small modal text prompt; resolves to the trimmed text, or null if cancelled. */
  function ask(title: string, hint = '', value = '', allowEmpty = false): Promise<string | null> {
    const d = $<HTMLDialogElement>('dAsk'), inp = $<HTMLInputElement>('askIn');
    $('askTitle').textContent = title; $('askHint').textContent = hint; inp.value = value;
    return new Promise((resolve) => {
      const done = () => { d.removeEventListener('close', done); resolve(d.returnValue === 'ok' && (allowEmpty || inp.value.trim()) ? inp.value.trim() : null); };
      d.returnValue = '';
      d.addEventListener('close', done);
      $('askNo').onclick = () => d.close('cancel');
      d.showModal(); inp.focus(); inp.select();
    });
  }
  async function saveSelectionAsPart() {
    const sel = selected();
    if (!sel.length) { toast('Select the elements to save first'); return; }
    const raw = await ask('Save selection as a part', 'name: one-line description (the description is optional). Example:  nav-bar: top navigation links');
    if (raw === null) return;
    const m = /^([^:]+?)\s*:\s*([\s\S]*)$/.exec(raw), name = partName(m ? m[1] : raw), note = (m ? m[2] : '').trim().slice(0, 120);
    if (!name) { toast(`“${raw}” can't be a part name (try something like nav-bar)`); return; }
    const part = makePart(store.frame, sel);
    if (!part) return;
    store.mutate((_, b) => { b.parts = { ...(b.parts ?? {}), [name]: { ...part, ...(note ? { note } : {}) } }; });
    toast(`Saved /${name}`);
  }
  document.querySelectorAll<HTMLButtonElement>('[data-p]').forEach((b) => (b.onclick = () => {
    document.querySelectorAll('[data-p]').forEach((x) => x.classList.toggle('on', x === b));
    $('pOutline').hidden = b.dataset.p !== 'outline';
    $('pParts').hidden = b.dataset.p !== 'parts';
    $('pLegend').hidden = b.dataset.p !== 'legend';
  }));

  // ---------- keyboard ----------
  /** A border (card) around the selection, e.g. a set of radio buttons that belong together. */
  const borderSel = () => {
    const sel = selected();
    if (!sel.length) { toast('Select the elements to put a border around first'); return; }
    const first = store.frame.shapes.length;
    store.mutate((fr) => {
      const c = classify(fr), group = new Set<number>();
      for (const i of sel) for (const j of moveGroup(fr, c, i)) group.add(j);
      fr.shapes.push(borderFor([...group].map((j) => fr.shapes[j])));
    });
    setSelection([first, ...sel]);
    toast('Border added');
  };
  const deleteSel = () => {
    const sel = selected();
    if (!sel.length) return;
    store.mutate((f) => {
      const c = classify(f), drop = new Set<number>();
      for (const i of sel) { const el = c.byIndex.get(i); if (el) { drop.add(el.i); if (el.labelIdx !== null) drop.add(el.labelIdx); } }
      return drop.size ? deleteShapes(f, [...drop]) : undefined;
    });
    st.sel = null;
    toast(sel.length > 1 ? `Deleted ${sel.length} elements` : 'Deleted');
  };
  const cycleSel = (dir: 1 | -1) => {
    const n = store.frame.shapes.length;
    if (!n) return;
    st.sel = st.sel === null ? (dir > 0 ? 0 : n - 1) : (st.sel + dir + n) % n;
    redraw();
  };
  const nudge = (dx: number, dy: number) => {
    const sel = selected();
    if (!sel.length) return;
    store.mutate((f) => {
      const c = classify(f), group = new Set<number>();
      for (const i of sel) for (const j of moveGroup(f, c, i)) group.add(j); // a container and its selected contents move once
      const links = linksFor(f, group);
      for (const j of group) shift(f, j, dx, dy);
      relink(f, links);
    }, { key: `nudge${st.cur}:${sel.join('.')}` });
  };
  const toggleBtn = (id: string) => () => $(id).click();
  /** Arrow keys on a selected arrow: put an arrowhead on (or take it off) the end that lies that way. */
  function toggleEndHead(idx: number, key: string) {
    const s = store.frame.shapes[idx];
    if (!s || s.k !== 'line') return;
    const horiz = key === 'arrowleft' || key === 'arrowright', neg = key === 'arrowleft' || key === 'arrowup';
    const a = horiz ? s.x1 : s.y1, b = horiz ? s.x2 : s.y2;
    if (Math.abs(a - b) < 8) { toast(horiz ? 'This arrow runs straight up and down: use ↑ ↓' : 'This arrow runs straight across: use ← →'); return; }
    const startIsThatEnd = neg ? a < b : a > b;     // which end lies that way: the start (tail) or the end (arrow)
    let said = '';
    store.mutate((f) => {
      const t = f.shapes[idx] as { arrow?: boolean; tail?: boolean; conn?: boolean };
      const prop = startIsThatEnd ? 'tail' : 'arrow';
      if (t[prop]) delete t[prop]; else t[prop] = true;
      if (!t.arrow && !t.tail) t.conn = true;   // no heads left: still a connector (it stays attached and routed), not a divider
      else delete t.conn;
      said = `${key.slice(5)} end: arrowhead ${t[prop] ? 'on' : 'off'}${t.arrow || t.tail ? '' : ' (a connector now: no heads, still attached)'}`;
    });
    toast(said);
  }
  /** Arrowhead on the selected line or sketched path (a second press takes it off). */
  const toggleHead = () => {
    const i = st.sel, s = i === null ? undefined : store.frame.shapes[i];
    if (i === null || !s || (s.k !== 'line' && s.k !== 'free')) { toast('Select a line or sketch first'); return; }
    store.mutate((f) => { const t = f.shapes[i] as { arrow?: boolean; tail?: boolean; conn?: boolean }; if (t.arrow) { delete t.arrow; if (s.k === 'line' && !t.tail) t.conn = true; } else t.arrow = true; });   // taking the last head off leaves a connector, not a divider
    redraw();
  };
  type Act = { key: string; label: string; run: () => void };
  const ACTIONS: { group: string; items: Act[] }[] = [
    { group: 'Tools', items: [
      { key: 'f', label: 'Flow (no mode switching)', run: () => setTool('flow') }, { key: 'd', label: 'Draw (shapes, lines and arrows are cleaned up)', run: () => setTool('draw') }, { key: 's', label: 'Sketch (strokes stay exactly as drawn)', run: () => setTool('sketch') }, { key: 't', label: 'Text', run: () => setTool('text') },
      { key: 'v', label: 'Select', run: () => setTool('select') }, { key: 'e', label: 'Erase', run: () => setTool('erase') },
      { key: 'r', label: 'Review', run: () => setTool('review') },
    ] },
    { group: 'Edit', items: [
      { key: 'u', label: 'Undo', run: undo }, { key: 'a', label: 'Arrowhead on selection', run: toggleHead }, { key: 'x', label: 'Delete selection', run: deleteSel },
      { key: 'q', label: 'Border around selection', run: borderSel },
      { key: '>', label: 'Turn selection 45° clockwise (or hold a corner and drag)', run: () => rotateSel(45) }, { key: '<', label: 'Turn selection 45° anticlockwise', run: () => rotateSel(-45) },
      { key: 'g', label: 'Grid snap', run: toggleBtn('tGrid') }, { key: 'o', label: 'Role tags', run: toggleBtn('tRoles') },
    ] },
    { group: 'Boards', items: [{ key: 'B', label: 'Boards: switch or start a new one', run: () => void openBoards() }] },
    { group: 'View', items: [
      { key: '=', label: 'Zoom in', run: () => zoomBy(1.25) }, { key: '-', label: 'Zoom out', run: () => zoomBy(0.8) },
      { key: '0', label: 'Fit the whole frame', run: zoomFit },
    ] },
    { group: 'Frames', items: [
      { key: 'n', label: 'New frame', run: () => store.addFrameAfter() },
      { key: 'y', label: 'Duplicate this frame', run: () => { store.duplicateFrame(); toast('Frame duplicated'); } },
      { key: '{', label: 'Move frame left', run: () => store.moveFrame(st.cur, st.cur - 1) },
      { key: '}', label: 'Move frame right', run: () => store.moveFrame(st.cur, st.cur + 1) },
      { key: 'z', label: 'Delete this frame', run: () => { if (!store.deleteFrame(st.cur)) toast('A board needs at least one frame'); else toast('Frame deleted (Undo to restore)'); } },
      { key: 'l', label: 'Link selection to a frame', run: () => { void linkSelection(); } },
      { key: 'V', label: 'Preview: every screen made to look real, in a style you pick (S cycles styles)', run: openPreview },
      { key: 'i', label: 'Play: click through the links', run: () => setPlay(!play) },
      { key: '[', label: 'Previous frame', run: () => store.setCur(st.cur - 1) },
      { key: ']', label: 'Next frame', run: () => store.setCur(st.cur + 1) },
      { key: 'm', label: 'Toggle desktop / phone', run: () => store.mutate((f) => { f.device = f.device === 'phone' ? 'desktop' : 'phone'; }) },
      { key: 'c', label: 'Edit caption', run: () => setTimeout(() => cap.focus(), 0) },
    ] },
    { group: 'File', items: [
      { key: 'S', label: 'Save to a file (Ctrl+S)', run: () => { void doSave(); } },
      { key: 'j', label: 'Open a file (Ctrl+O)', run: () => { void openFile(openBoard); } },
      { key: '!', label: 'New, empty drawing', run: () => { void newDrawing(); } },
    ] },
    { group: 'Board', items: [
      { key: 'b', label: 'Save selection as a part', run: () => { void saveSelectionAsPart(); } },
      { key: 'p', label: 'Picture into the selected image · or a photo / screenshot behind the frame', run: () => { const i = imgIdx(); if (i !== null) pickPicture(i); else $('bShot').click(); } },
      { key: 'P', label: 'Take the picture out of the selected image', run: takePictureOut },
      { key: '?', label: 'Help: the animated guide', run: () => openHowTo() },
      { key: 'k', label: 'Trace that image into shapes (offline)', run: () => { void traceBackground(); } },
      { key: 'F', label: 'Search all frames (Ctrl+F)', run: () => openSearch() },
      { key: 'w', label: 'Export', run: () => $('bExport').click() },
      { key: 'h', label: 'Side panel', run: () => $('bPanel').click() },
    ] },
  ];
  const dKeys = $<HTMLDialogElement>('dKeys');
  const byKey = new Map<string, Act>();
  for (const g of ACTIONS) for (const a of g.items) byKey.set(a.key, a);
  byKey.set('+', byKey.get('=')!);   // + is Shift+= on most keyboards

  // ---------- realistic preview ----------
  function openPreview() {
    const url = URL.createObjectURL(new Blob([previewHTML(st.board, 'Preview')], { type: 'text/html' }));
    const w = window.open(`${url}#${st.cur + 1}`, '_blank');
    if (!w) toast('The browser blocked the preview window: allow pop-ups for this page');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ---------- frame links + click-through ----------
  function setPlay(on: boolean) {
    play = on; playBack.length = 0;
    $('playbar').hidden = !on; paintKeys();
    document.body.classList.toggle('playing', on);
    if (on) { setSelection([]); if (!inl.hidden) inl.blur(); }
    cv.style.cursor = on ? 'default' : st.tool === 'select' ? 'default' : st.tool === 'text' ? 'text' : 'crosshair';
    redraw();
  }
  /** Pick a frame to link to: press its number, or Up/Down + Enter. Resolves to a frame id, null (remove link) or undefined (cancel). */
  function pickFrame(current: string | undefined): Promise<string | null | undefined> {
    const d = $<HTMLDialogElement>('dLink'), list = $('lres');
    const opts: { id: string | null; label: string; tag: string }[] = [
      ...st.board.frames.map((fr, i) => ({ id: fr.id, label: fr.caption || `Frame ${i + 1}`, tag: String(i + 1) })),
      { id: null, label: 'No link', tag: '0' },
    ];
    let act = Math.max(0, opts.findIndex((o) => o.id === current));
    return new Promise((resolve) => {
      let result: string | null | undefined;
      const paint = () => {
        list.textContent = '';
        opts.forEach((o, i) => {
          const b = document.createElement('button');
          b.className = i === act ? 'on' : '';
          b.innerHTML = `<span class="fr">${o.tag}</span><span class="txt"></span>`;
          (b.querySelector('.txt') as HTMLElement).textContent = o.label + (o.id !== null && o.id === store.frame.id ? ' (this frame)' : '');
          b.onclick = () => { result = o.id; d.close(); };
          list.append(b);
        });
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); act = (act + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length; paint(); }
        else if (e.key === 'Enter') { e.preventDefault(); result = opts[act].id; d.close(); }
        else if (/^[0-9]$/.test(e.key)) { const o = opts.find((x) => x.tag === e.key); if (o) { e.preventDefault(); result = o.id; d.close(); } }
      };
      const done = () => { d.removeEventListener('close', done); d.removeEventListener('keydown', onKey); resolve(result); };
      d.addEventListener('keydown', onKey); d.addEventListener('close', done);
      paint(); d.showModal(); list.focus();
    });
  }
  async function linkSelection() {
    const sel = selected(), f = store.frame;
    const idxs = sel.filter((i) => f.shapes[i] && linkable(f.shapes[i]));
    if (!idxs.length) { toast('Select a button or other element to link first'); return; }
    if (st.board.frames.length < 2) { toast('Add another frame to link to'); return; }
    const first = f.shapes[idxs[0]] as { link?: string };
    const target = await pickFrame(first.link);
    if (target === undefined) return;
    store.mutate((fr) => { setLinks(fr, idxs, target); });
    toast(target === null ? 'Link removed' : `Linked to frame ${st.board.frames.findIndex((x) => x.id === target) + 1}`);
  }

  // ---------- search across all frames ----------
  const dSearch = $<HTMLDialogElement>('dSearch'), sq = $<HTMLInputElement>('sq'), sres = $('sres');
  let hits: Hit[] = [], sAct = 0;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const mark = (text: string, q: string) => {
    let out = esc(text);
    for (const w of q.toLowerCase().split(/\s+/).filter(Boolean)) out = out.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![^<]*>)`, 'ig'), '<mark>$1</mark>');
    return out;
  };
  const goHit = (h: Hit) => {
    dSearch.close();
    store.setCur(h.frame);
    if (h.idx !== null) { st.sel = h.idx; redraw(); }
    toast(`Frame ${h.frame + 1}${h.kind === 'element' ? `: ${h.role}${h.text ? ' “' + h.text.slice(0, 30) + '”' : ''}` : ''}`);
  };
  const paintHits = () => {
    sres.textContent = '';
    if (!sq.value.trim()) return;
    if (!hits.length) { sres.innerHTML = '<div class="none">Nothing found.</div>'; return; }
    hits.forEach((h, i) => {
      const b = document.createElement('button');
      b.className = i === sAct ? 'on' : ''; b.setAttribute('role', 'option');
      b.innerHTML = `<span class="fr">${h.frame + 1}</span><span class="chip">${esc(h.role)}</span><span class="txt">${mark(h.text || '(no text)', sq.value)}</span>`;
      b.onclick = () => goHit(h);
      sres.append(b);
    });
    (sres.children[sAct] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  };
  const openSearch = () => { if (!dSearch.open) dSearch.showModal(); sq.focus(); sq.select(); };
  sq.addEventListener('input', () => { hits = searchBoard(st.board, sq.value); sAct = 0; paintHits(); });
  sq.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (hits.length) { sAct = (sAct + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length; paintHits(); } }
    else if (e.key === 'Enter' && hits[sAct]) { e.preventDefault(); goHit(hits[sAct]); }
  });
  $('bSearch').onclick = openSearch;
  // ---------- the palette: keys, "/" stamps and parts ----------
  // Open with ? or Space: press a key and it runs (hands stay on the keyboard). Tab or / starts a search over actions, stamps and parts.
  const palq = $<HTMLInputElement>('palq'), palbody = $('palbody');
  type PalRun = PalItem & { run: () => void };
  let palRows: PalRun[] = [], palSel = 0;
  /** Where a stamp or part chosen from the palette goes: by the cursor if it is over the canvas, else the first free space. */
  const spotFor = (w: number, h: number): Pt => freeSpotFor(store.frame, w, h, mouse);
  const stampSpot = (name: string): Pt => {
    const sf = frameSize(store.frame);
    const r = stampFromText(`/${name} X`, 0, 0, { W: sf.w, phone: store.frame.device === 'phone' }, st.board.parts);
    const bb = r ? r.shapes.map(bounds) : [];
    const w = bb.length ? Math.max(...bb.map((q) => q.x + q.w)) : 260, h = bb.length ? Math.max(...bb.map((q) => q.y + q.h)) : 60;
    return spotFor(Math.min(w + 20, sf.w - 2 * GRID), h + (['radio', 'checkbox', 'list'].includes(name) ? 120 : 20)); // radios, checks and lists grow as you type
  };
  function palItems(): PalRun[] {
    const acts: PalRun[] = ACTIONS.flatMap((g) => g.items.map((a) => ({ kind: 'action' as const, key: a.key, label: a.label, hint: g.group, run: a.run })));
    const stamps: PalRun[] = STAMP_HELP.map((sd) => ({ kind: 'stamp' as const, label: '/' + sd.name, hint: sd.hint, also: sd.also, run: () => openInline(stampSpot(sd.name), `/${sd.name} `) }));
    const parts: PalRun[] = Object.entries(st.board.parts ?? {}).map(([n, p]) => ({ kind: 'part' as const, label: '/' + n, hint: p.note || `your saved part, ${Math.round(p.w)}×${Math.round(p.h)}`, run: () => placePart(n) }));
    return [...acts, ...stamps, ...parts];
  }
  /** "/radio Email, SMS": the first word picks the stamp or part, the rest are its parameters (the same text the canvas box takes). */
  const palSplit = (q: string): { word: string; params: string } => {
    const m = /^(\/\S*)\s+([\s\S]*)$/.exec(q.trimStart());
    return m ? { word: m[1], params: m[2].trim() } : { word: q, params: '' };
  };
  const palRun = (it: PalRun) => {
    const { params } = palSplit(palq.value);
    dKeys.close();
    if (params && (it.kind === 'stamp' || it.kind === 'part')) {
      // Hand the whole line to the same box the canvas uses and commit it, so both ways parse and place it identically.
      setTimeout(() => {
        const name = it.label.slice(1), part = st.board.parts?.[name];
        openInline(it.kind === 'part' && part ? spotFor(part.w, part.h) : stampSpot(name), `${it.label} ${params}`);
        inl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      }, 0);
      return;
    }
    setTimeout(it.run, 0);
  };
  function paintPal() {
    const q = palSplit(palq.value).word, all = palItems();
    palbody.textContent = '';
    const row = (it: PalRun, i: number, on: boolean) => {
      const b = document.createElement('button');
      b.className = 'pr' + (on ? ' on' : '') + ` k-${it.kind}`; b.dataset.i = String(i);
      const k = document.createElement('kbd'); k.textContent = it.kind === 'action' ? (/^[A-Z]$/.test(it.key!) ? `⇧${it.key}` : it.key!.toUpperCase()) : it.label;
      const l = document.createElement('span'); l.textContent = it.kind === 'action' ? it.label : it.hint;
      b.append(k, l); b.onclick = () => palRun(it);
      return b;
    };
    if (q.trim()) {
      palRows = filterItems(all, q) as PalRun[];
      palSel = Math.min(palSel, Math.max(0, palRows.length - 1));
      if (!palRows.length) { palbody.innerHTML = '<div class="none">Nothing matches. Parts and stamps start with /.</div>'; return; }
      const list = document.createElement('div'); list.className = 'palist';
      palRows.forEach((it, i) => list.append(row(it, i, i === palSel)));
      palbody.append(list);
      list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
      return;
    }
    palRows = all;
    const sect = (title: string, items: PalRun[], cls: string) => {
      if (!items.length) return;
      const h = document.createElement('h4'); h.textContent = title;
      const g = document.createElement('div'); g.className = `palgrid ${cls}`;
      items.forEach((it) => g.append(row(it, all.indexOf(it), false)));
      palbody.append(h, g);
    };
    for (const g of ACTIONS) sect(g.group, all.filter((it) => it.kind === 'action' && it.hint === g.group), 'acts');
    sect('Stamps: tap the canvas and type /name, or pick one here', all.filter((it) => it.kind === 'stamp'), 'stamps');
    sect('Your parts', all.filter((it) => it.kind === 'part'), 'stamps');
  }
  /** "/" anywhere: the stamps and parts list, ready to type a name. */
  const openSlash = () => { if (dKeys.open) return; openKeys(); palq.value = '/'; palSel = 0; paintPal(); palq.focus(); };
  const openKeys = () => {
    if (dKeys.open) return;
    palq.value = ''; palSel = 0; paintPal();
    dKeys.showModal();
    (dKeys.querySelector('.pal') as HTMLElement).focus();     // keys, not the search box, get the first press
  };
  // Closing from the keyboard can leave focus on a hidden element inside the dialog, which would swallow every later shortcut.
  dKeys.addEventListener('close', () => { const a = document.activeElement as HTMLElement | null; if (a && dKeys.contains(a)) a.blur(); });
  palq.addEventListener('input', () => { palSel = 0; paintPal(); });
  dKeys.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target === palq) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') {
        e.preventDefault(); if (palRows.length) { palSel = (palSel + (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1) + palRows.length) % palRows.length; paintPal(); }
      } else if (e.key === 'Enter') { e.preventDefault(); if (palq.value.trim() && palRows[palSel]) palRun(palRows[palSel]); }
      else if (e.key === 'Escape' && palq.value) { e.preventDefault(); palq.value = ''; palSel = 0; paintPal(); (dKeys.querySelector('.pal') as HTMLElement).focus(); }
      e.stopPropagation();
      return;
    }
    if (e.key === 'Escape') return;                                              // closes
    if (e.key === ' ') { e.preventDefault(); dKeys.close(); return; }             // Space again leaves
    if (e.key === '/') { e.preventDefault(); palq.value = '/'; palSel = 0; paintPal(); palq.focus(); return; }
    if (e.key === 'Tab' || e.key === 'ArrowDown') { e.preventDefault(); palq.focus(); return; }
    const a = byKey.get(e.key) ?? byKey.get(e.key.toLowerCase());
    if (a) { e.preventDefault(); e.stopPropagation(); dKeys.close(); setTimeout(a.run, 0); }
  });
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void doSave(e.shiftKey); return; }
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); void openFile(openBoard); return; }
    if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); openSearch(); return; }
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); if (dKeys.open) dKeys.close(); else { (document.activeElement as HTMLElement | null)?.blur?.(); openKeys(); } return; }
    if (e.key === '?' && !typing(e.target) && !(e.target as HTMLElement | null)?.closest('dialog[open]')) { e.preventDefault(); openHowTo(); return; }
    if (typing(e.target) || (e.target as HTMLElement | null)?.closest('dialog[open]')) return;
    if (play) {
      const k = e.key.toLowerCase();
      if (k === 'escape' || k === 'i') { e.preventDefault(); setPlay(false); }
      else if (k === 'backspace') { e.preventDefault(); const id = playBack.pop(); const i = st.board.frames.findIndex((x) => x.id === id); if (i >= 0) store.setCur(i); else toast('Start of the walk-through'); }
      else if (k === 'arrowright') { e.preventDefault(); store.setCur(st.cur + 1); }
      else if (k === 'arrowleft') { e.preventDefault(); store.setCur(st.cur - 1); }
      return;
    }
    if (e.key === 'Escape') {   // Esc is "back out": the sketch back after a drawn shape, else deselect, else undo (Shift+Esc redoes)
      if (e.shiftKey) { e.preventDefault(); if (!store.redo()) toast('Nothing to redo'); return; }
      if (keepAsSketch()) { e.preventDefault(); return; }
      if (!selected().length) { e.preventDefault(); if (!store.undo()) toast('Nothing to undo'); return; }
    }
    if (e.key === '/' && !mod && !e.altKey) { e.preventDefault(); openSlash(); return; }
    if (st.tool === 'text' && !mod && !e.altKey && st.sel !== null && selected().length === 1 && store.frame.shapes[st.sel]?.k === 'tlines') {
      const ps: Record<string, [-1 | 0 | 1, -1 | 0 | 1]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (ps[e.key]) { e.preventDefault(); stepParagraph(st.sel, ...ps[e.key]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setSelection([]); return; }
    }
    if (st.tool === 'text' && !mod && !e.altKey && typesInto() && st.sel !== null) {
      const step: Record<string, [-1 | 0 | 1, -1 | 0 | 1]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (step[e.key]) { e.preventDefault(); stepLabel(st.sel, ...step[e.key]); return; }
      // D cuts the words loose from the shape (or hooks them back on). With nothing there to detach it is just the letter d; Shift+D always types.
      if (e.key === 'd' && !e.shiftKey && hasDetachable(st.sel)) { e.preventDefault(); toggleDetach(st.sel); return; }
      if (e.key === 'Escape') { e.preventDefault(); setSelection([]); return; }
    }
    if (!mod && !e.altKey && e.key.length === 1 && e.key !== ' ' && e.key !== '<' && e.key !== '>' && selected().length === 1 && st.sel !== null) {
      const sh = store.frame.shapes[st.sel];
      if (sh && typesInto()) { e.preventDefault(); typeInto(st.sel, e.key); return; } // typing on a selected box or circle writes in it
    }
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) { if (!store.redo()) toast('Nothing to redo'); } else undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); if (!store.redo()) toast('Nothing to redo'); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); return; }
    if (mod && e.key.toLowerCase() === 'c') { copyKey(false); return; }
    if (mod && e.key.toLowerCase() === 'x') { copyKey(true); return; }
    if (mod && e.key.toLowerCase() === 'v') { pasteKey(); return; }
    if (mod && e.key.toLowerCase() === 'a' && (st.tool === 'select' || st.tool === 'flow')) { e.preventDefault(); selectAll(); return; }
    if (mod || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); openKeys(); return; }   // one key into shortcut mode: the list opens, the next key runs one
    if (/^[1-9]$/.test(k) && !e.shiftKey && Number(k) <= st.board.frames.length) { e.preventDefault(); store.setCur(Number(k) - 1); return; }   // 1-9 jump to that frame
    if (k === 'backspace' || k === 'delete') { if (selected().length) { e.preventDefault(); deleteSel(); } else if (k === 'backspace') toast('Nothing selected · Ctrl+Z undoes'); return; }
    if (st.tool === 'select' || st.tool === 'flow') {
      if (k === 'tab') { e.preventDefault(); cycleSel(e.shiftKey ? -1 : 1); return; }
      if (k === 'escape') { setSelection([]); return; }
      const step = e.shiftKey ? GRID * 4 : st.prefs.snap ? GRID : 1;
      const sh0 = st.sel !== null && selected().length === 1 ? store.frame.shapes[st.sel] : undefined;
      if (sh0 && sh0.k === 'img' && k === 'enter' && !e.shiftKey) { e.preventDefault(); describeImage(st.sel!); return; }   // Enter writes (or edits) the image's description
      if (sh0 && isConnector(sh0) && sh0.k === 'line' && k === 'enter' && !e.shiftKey) { e.preventDefault(); labelArrow(st.sel!); return; }   // Enter writes (or edits) the arrow's label
      if (sh0 && isConnector(sh0) && sh0.k === 'line' && !e.shiftKey && !e.altKey && k.startsWith('arrow')) { e.preventDefault(); toggleEndHead(st.sel!, k); return; }   // on an arrow the arrow keys add or remove the head at that end (Shift+arrow nudges)
      const dir: Record<string, [number, number]> = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] };
      if (dir[k] && selected().length) { e.preventDefault(); nudge(...dir[k]); return; }
    }
    const a = e.shiftKey && byKey.get(e.key) ? byKey.get(e.key) : byKey.get(k);   // Shift+P is its own key, not P
    if (a) { e.preventDefault(); a.run(); }
  });

  // ---------- strip ----------
  const thumbs = $('thumbs');
  function drawThumb(c: HTMLCanvasElement, f: Frame) {
    const { w, h } = frameSize(f), s = Math.min(150 / w, 84 / h), dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * s * dpr); c.height = Math.round(h * s * dpr);
    c.style.width = `${w * s}px`; c.style.height = `${h * s}px`;
    const g = c.getContext('2d')!;
    g.setTransform(s * dpr, 0, 0, s * dpr, 0, 0);
    drawFrame(g, f, { scale: s, theme: currentTheme() }, () => drawThumb(c, f));
  }
  function renderStrip(full: boolean) {
    const frames = st.board.frames;
    if (full || thumbs.children.length !== frames.length) {
      thumbs.textContent = '';
      frames.forEach((f, i) => {
        const b = document.createElement('button');
        b.className = 'thumb'; b.title = f.caption || `Frame ${i + 1}`; b.setAttribute('aria-label', `Frame ${i + 1}`);
        const c = document.createElement('canvas'); const n = document.createElement('i'); n.textContent = String(i + 1);
        b.append(c, n);
        b.onclick = () => store.setCur(i);
        // Drag a thumbnail to a new place to reorder the frames.
        b.draggable = true;
        b.ondragstart = (e) => { e.dataTransfer?.setData('application/x-axsq-frame', String(i)); e.dataTransfer!.effectAllowed = 'move'; };
        b.ondragover = (e) => { if (e.dataTransfer?.types.includes('application/x-axsq-frame')) { e.preventDefault(); b.classList.add('over'); } };
        b.ondragleave = () => b.classList.remove('over');
        b.ondrop = (e) => { b.classList.remove('over'); const from = Number(e.dataTransfer?.getData('application/x-axsq-frame')); if (Number.isInteger(from)) { e.preventDefault(); store.moveFrame(from, i); } };
        thumbs.append(b);
      });
    }
    [...thumbs.children].forEach((el, i) => {
      el.classList.toggle('on', i === st.cur);
      const c = el.querySelector('canvas')!;
      if (full || i === st.cur) drawThumb(c, frames[i]);
      (el as HTMLElement).title = frames[i].caption || `Frame ${i + 1}`;
    });
    (thumbs.children[st.cur] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // ---------- sync ----------
  function syncUi() {
    toolBtns.forEach((b) => b.classList.toggle('on', b.dataset.tool === st.tool));
    $('tGrid').classList.toggle('on', st.prefs.snap);
    $('tRoles').classList.toggle('on', st.prefs.roles);
    $('rbar').hidden = st.tool !== 'review';
    $('banner').hidden = !st.board.example;
    $('bShotX').hidden = !store.frame.bg;
    $<HTMLSelectElement>('device').value = store.frame.device;
    if (document.activeElement !== cap) cap.value = store.frame.caption;
    updateReview();
  }
  let lastCur = -1, lastCount = -1, lastDevice = '';
  store.subscribe((src, full) => {
    const f = store.frame;
    const changed = lastCur !== st.cur || lastCount !== st.board.frames.length || lastDevice !== f.device;
    const frameChanged = lastCur !== st.cur || lastCount !== st.board.frames.length;
    lastCur = st.cur; lastCount = st.board.frames.length; lastDevice = f.device;
    if (frameChanged) { zoom = 1; wrap.scrollTo(0, 0); }
    if (changed) layout(); else redraw();
    syncUi();
    if (src !== 'panel' || frameChanged) outline.render();
    partsPanel.render();
    renderStrip(src !== 'panel' && full);
  });

  setTool('draw');
  layout();
  outline.render();
  partsPanel.render();
  renderStrip(true);
  lastCur = st.cur; lastCount = st.board.frames.length; lastDevice = store.frame.device;
}
