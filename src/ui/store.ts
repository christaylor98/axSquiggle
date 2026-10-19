import { cloneBoard, cloneFrame, newFrame, newId, type Board, type Frame } from '../core/types';
import { dropLinksTo } from '../core/links';
import { exampleBoard, freshBoard, validateBoard } from '../core/model';
import type { Box } from '../core/geom';

export type Tool = 'draw' | 'sketch' | 'text' | 'select' | 'flow' | 'erase' | 'review';

export interface Prefs { snap: boolean; roles: boolean }

export interface State {
  board: Board;
  cur: number;
  tool: Tool;
  prefs: Prefs;
  sel: number | null;
  /** More selected shapes besides `sel` (valid only while `moreFor === sel` and the shape count is unchanged). */
  more: number[];
  moreFor: number | null;
  moreLen: number;
  hover: number | null;
  focus: number[];
  focusBox: Box | null;
}

const K_BOARD = 'axsq.board', K_PREFS = 'axsq.prefs';
const MAX_UNDO = 80;

function load<T>(key: string): T | null {
  try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : null; } catch { return null; }
}

export type Source = 'app' | 'panel';

export class Store {
  state: State;
  private undoStack: Board[] = [];
  private redoStack: Board[] = [];
  private listeners: ((src: Source, full: boolean) => void)[] = [];
  private lastKey = '';
  private lastKeyAt = 0;
  private saveTimer = 0;
  onWarn: (msg: string) => void = () => {};

  constructor() {
    const saved = validateBoard(load<unknown>(K_BOARD));
    const saved_ = load<Partial<Prefs>>(K_PREFS) ?? {};
    const prefs: Prefs = { snap: saved_.snap ?? true, roles: saved_.roles ?? true };
    this.state = {
      board: saved ?? exampleBoard(), cur: 0, tool: 'draw', prefs, sel: null, more: [], moreFor: null, moreLen: 0, hover: null, focus: [], focusBox: null
    };
  }

  get frame(): Frame { return this.state.board.frames[this.state.cur]; }

  subscribe(fn: (src: Source, full: boolean) => void) { this.listeners.push(fn); }
  emit(src: Source = 'app', full = true) { for (const l of this.listeners) l(src, full); }

  /** How many undo steps exist: lets a caller tell whether anything has been done since it last looked. */
  get undoDepth() { return this.undoStack.length; }

  /** Snapshot for undo. `key` coalesces rapid edits of the same thing (typing a label). */
  snapshot(key = '') {
    const now = Date.now();
    if (key && key === this.lastKey && now - this.lastKeyAt < 1500) { this.lastKeyAt = now; return; }
    this.lastKey = key; this.lastKeyAt = now;
    this.undoStack.push(cloneBoard(this.state.board));
    this.redoStack = [];
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
  }

  /** One undoable step. The callback edits the current frame in place or returns a replacement. */
  mutate(fn: (f: Frame, b: Board) => Frame | void, o: { key?: string; src?: Source } = {}) {
    this.snapshot(o.key);
    const b = this.state.board;
    const r = fn(this.frame, b);
    if (r) b.frames[this.state.cur] = r;
    this.changed(o.src ?? 'app');
  }

  /** Edit without a snapshot (live drag updates after a snapshot was taken). */
  live(fn: (f: Frame) => void) { fn(this.frame); this.changed('app', false); }

  replaceBoard(b: Board) {
    this.snapshot();
    this.state.board = b; this.state.cur = 0; this.clearSel(); this.clearFocus();
    this.changed('app');
  }

  /** Show a different board (not an edit): its history starts empty, so Undo can never carry the previous board's content into it. */
  openBoard(b: Board) {
    this.undoStack = []; this.redoStack = []; this.lastKey = '';
    this.state.board = b; this.state.cur = 0; this.clearSel(); this.clearFocus();
    this.changed('app');
  }

  /** Select exactly these shapes (first = primary). */
  select(idxs: number[]) {
    const s = this.state;
    s.sel = idxs[0] ?? null; s.more = idxs.slice(1); s.moreFor = s.sel; s.moreLen = this.frame.shapes.length;
  }

  clearSel() { this.state.sel = null; this.state.more = []; this.state.moreFor = null; }

  clearFocus() { this.state.focus = []; this.state.focusBox = null; }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(cloneBoard(this.state.board));
    this.state.board = prev;
    this.state.cur = Math.min(this.state.cur, prev.frames.length - 1);
    this.clearSel(); this.clearFocus();
    this.lastKey = '';
    this.changed('app');
    return true;
  }

  /** Put back what the last undo took away. */
  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(cloneBoard(this.state.board));
    this.state.board = next;
    this.state.cur = Math.min(this.state.cur, next.frames.length - 1);
    this.clearSel(); this.clearFocus();
    this.lastKey = '';
    this.changed('app');
    return true;
  }

  setCur(i: number) {
    this.state.cur = Math.max(0, Math.min(this.state.board.frames.length - 1, i));
    this.clearSel(); this.clearFocus();
    this.emit('app');
  }

  addFrameAfter(f: Frame = newFrame(this.frame.device)) {
    this.snapshot();
    this.state.board.frames.splice(this.state.cur + 1, 0, f);
    this.state.cur++;
    this.clearSel(); this.clearFocus();
    this.changed('app');
  }

  /** A copy of frame i right after it, selected as the current frame. */
  duplicateFrame(i = this.state.cur) {
    const b = this.state.board;
    if (!b.frames[i]) return;
    this.snapshot();
    const copy = cloneFrame(b.frames[i]);
    copy.id = newId('f');
    copy.notes = copy.notes.map((n) => ({ ...n, id: newId('n') }));
    b.frames.splice(i + 1, 0, copy);
    this.state.cur = i + 1;
    this.clearSel(); this.clearFocus();
    this.changed('app');
  }

  /** Move a frame to position `to` (0-based); the current frame stays the one you were looking at. */
  moveFrame(from: number, to: number) {
    const b = this.state.board, n = b.frames.length;
    to = Math.max(0, Math.min(n - 1, to));
    if (from === to || !b.frames[from]) return;
    this.snapshot();
    const curId = b.frames[this.state.cur]?.id;
    const [f] = b.frames.splice(from, 1);
    b.frames.splice(to, 0, f);
    this.state.cur = Math.max(0, b.frames.findIndex((x) => x.id === curId));
    this.changed('app');
  }

  /** Remove a frame (never the last one) and every link that led to it. */
  deleteFrame(i: number): boolean {
    const b = this.state.board;
    if (b.frames.length < 2 || !b.frames[i]) return false;
    this.snapshot();
    const [gone] = b.frames.splice(i, 1);
    dropLinksTo(b, gone.id);
    this.state.cur = Math.min(this.state.cur, b.frames.length - 1);
    this.clearSel(); this.clearFocus();
    this.changed('app');
    return true;
  }

  startFresh() {
    this.snapshot();
    this.state.board = freshBoard(); this.state.cur = 0; this.clearSel(); this.clearFocus();
    this.changed('app');
  }

  private changed(src: Source, full = true) {
    if (this.state.sel !== null && this.state.sel >= this.frame.shapes.length) this.clearSel();
    this.scheduleSave();
    this.emit(src, full);
  }

  savePrefs() { try { localStorage.setItem(K_PREFS, JSON.stringify(this.state.prefs)); } catch { /* ignore */ } }

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 400);
  }

  /** Autosave that survives quota errors by retrying without screenshots. */
  save() {
    const b = this.state.board;
    try { localStorage.setItem(K_BOARD, JSON.stringify(b)); return; } catch { /* quota or private mode */ }
    try {
      const lite = { ...b, frames: b.frames.map((f) => ({ ...f, bg: undefined })) };
      localStorage.setItem(K_BOARD, JSON.stringify(lite));
      this.onWarn('Storage is full: saved without screenshots');
    } catch {
      this.onWarn('Storage is full: changes are not being saved. Export your board.');
    }
  }
}

/** Everything currently selected, primary first. */
export function selectedOf(s: State): number[] {
  if (s.sel === null) return [];
  return [s.sel, ...(s.moreFor === s.sel ? s.more.filter((i) => i !== s.sel) : [])];
}
