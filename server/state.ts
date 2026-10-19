import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshBoard, validateBoard } from '../src/core/model';
import { cloneBoard, type Board } from '../src/core/types';

/** 'board': the open board's content changed or another board was opened. 'boards': the list of boards changed. */
type Listener = (e: { type: 'board' | 'boards'; rev: number; name: string }) => void;

interface Slot { name: string; board: Board; baseline: Board | null; rev: number; at: number }
interface Registry { slots: Map<string, Slot>; current: string; clock: number; subs: Set<Listener>; dir?: string }

const NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,59}$/;
export const DEFAULT_BOARD = 'default';

/**
 * The shared boards between the browser app and an outside AI. Each board is a named file in `<dir>/boards/`;
 * one is "open" (what the browser shows and what tools use unless told otherwise).
 * `rev` counts writes (one clock across all boards, so opening a board always looks like a change to the browser).
 * `baseline` is the board as the AI last left it, so "what the person changed" is baseline vs now.
 * A BoardServer is a view on one board: `view(name)` pins another view without opening it.
 */
export class BoardServer {
  private reg: Registry;
  private pin: string | null = null;

  constructor(dir?: string) {
    this.reg = { slots: new Map(), current: DEFAULT_BOARD, clock: 0, subs: new Set(), dir };
    if (dir) this.init(dir);
    if (!this.reg.slots.has(this.reg.current)) this.slotFor(this.reg.current, true);
  }

  private init(dir: string) {
    const boards = join(dir, 'boards');
    const legacy = join(dir, 'board.json');
    if (!existsSync(boards)) {
      mkdirSync(boards, { recursive: true });
      if (existsSync(legacy)) copyFileSync(legacy, join(boards, DEFAULT_BOARD + '.json')); // the single board of earlier versions
    }
    try { const c = readFileSync(join(dir, 'current'), 'utf8').trim(); if (c && existsSync(join(boards, c + '.json'))) this.reg.current = c; } catch { /* default */ }
    if (!existsSync(join(boards, this.reg.current + '.json'))) {
      const first = readdirSync(boards).filter((f) => f.endsWith('.json')).sort()[0];
      if (first) this.reg.current = first.slice(0, -5);
    }
  }

  private file(name: string) { return this.reg.dir ? join(this.reg.dir, 'boards', name + '.json') : undefined; }

  /** The slot for `name`, read from disk on first use (or made empty when `create`). */
  private slotFor(name: string, create = false): Slot | null {
    const have = this.reg.slots.get(name);
    if (have) return have;
    const f = this.file(name);
    let slot: Slot | null = null;
    if (f && existsSync(f)) {
      try {
        const raw = JSON.parse(readFileSync(f, 'utf8')) as { rev?: number; board?: unknown; baseline?: unknown };
        const board = validateBoard(raw.board);
        if (board) {
          const rev = typeof raw.rev === 'number' ? raw.rev : 0;
          this.reg.clock = Math.max(this.reg.clock, rev);
          slot = { name, board, baseline: validateBoard(raw.baseline), rev, at: statSync(f).mtimeMs };
        }
      } catch { /* treated as missing */ }
    }
    if (!slot && create) { slot = { name, board: freshBoard(), baseline: null, rev: 0, at: Date.now() }; this.save(slot); }
    if (slot) this.reg.slots.set(name, slot);
    return slot;
  }

  private get slot(): Slot {
    const s = this.slotFor(this.pin ?? this.reg.current);
    if (!s) throw new Error(`The board "${this.pin}" no longer exists.`);
    return s;
  }

  private save(s: Slot) {
    s.at = Date.now();
    const f = this.file(s.name);
    if (!f) return;
    try {
      mkdirSync(join(this.reg.dir!, 'boards'), { recursive: true });
      writeFileSync(f, JSON.stringify({ rev: s.rev, board: s.board, baseline: s.baseline }));
    } catch { /* a read-only disk must not stop the session */ }
  }
  private saveCurrent() {
    if (!this.reg.dir) return;
    try { writeFileSync(join(this.reg.dir, 'current'), this.reg.current); } catch { /* ignore */ }
  }

  get board(): Board { return this.slot.board; }
  get baseline(): Board | null { return this.slot.baseline; }
  get rev(): number { return this.slot.rev; }
  /** The name of the board this view is on. */
  get name(): string { return this.slot.name; }
  /** The name of the board that is open in the browser. */
  get open(): string { return this.reg.current; }

  subscribe(fn: Listener): () => void { this.reg.subs.add(fn); return () => this.reg.subs.delete(fn); }
  private emit(type: 'board' | 'boards', s: Slot) { for (const f of this.reg.subs) f({ type, rev: s.rev, name: s.name }); }
  /** Content of a board changed: tell the browser only if it is the open one. */
  private changed(s: Slot) { if (s.name === this.reg.current) this.emit('board', s); else this.emit('boards', s); }

  /** The same boards, but tools on the returned view act on `name` whatever is open in the browser. */
  view(name: string): BoardServer {
    const real = this.find(name);
    if (!real) throw new Error(`There is no board called "${name}". Boards: ${this.list().map((b) => b.name).join(', ')}.`);
    const v = Object.create(this) as BoardServer;
    v.pin = real;
    return v;
  }

  /** An AI edit: run `fn` on a copy, sanitise the result, publish it, and remember it as the new baseline. */
  aiWrite(fn: (b: Board) => string | void, expectedRev?: number): string {
    const s = this.slot;
    if (expectedRev !== undefined && expectedRev !== s.rev) {
      throw new Error(`The board changed since you read it (you have rev ${expectedRev}, it is rev ${s.rev}). Call get_board or get_review again.`);
    }
    const draft = cloneBoard(s.board);
    const msg = fn(draft);
    const ok = validateBoard(JSON.parse(JSON.stringify(draft)));
    if (!ok) throw new Error('That edit would leave the board empty or invalid.');
    s.board = ok;
    s.rev = ++this.reg.clock;
    s.baseline = cloneBoard(ok);
    this.save(s);
    this.changed(s);
    return msg ?? '';
  }

  /** A person's edit from the browser, always on the open board. Rejected when the AI wrote in between (the browser then adopts the newer board). */
  userWrite(raw: unknown, baseRev: number): { ok: true; rev: number } | { ok: false; rev: number } {
    const s = this.slotFor(this.reg.current)!;
    if (baseRev !== s.rev) return { ok: false, rev: s.rev };
    const b = validateBoard(raw);
    if (!b) return { ok: false, rev: s.rev };
    s.board = b;
    s.rev = ++this.reg.clock;
    this.save(s);
    this.changed(s);
    return { ok: true, rev: s.rev };
  }

  // ---------- several boards ----------

  /** The stored name matching `name` ignoring case, or null. */
  find(name: string): string | null {
    const want = name.trim().toLowerCase();
    return this.names().find((n) => n.toLowerCase() === want) ?? null;
  }

  private names(): string[] {
    const set = new Set(this.reg.slots.keys());
    if (this.reg.dir) { try { for (const f of readdirSync(join(this.reg.dir, 'boards'))) if (f.endsWith('.json')) set.add(f.slice(0, -5)); } catch { /* none */ } }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  list(): { name: string; frames: number; rev: number; changed: number; open: boolean }[] {
    return this.names().flatMap((n) => {
      const s = this.slotFor(n);
      return s ? [{ name: n, frames: s.board.frames.length, rev: s.rev, changed: s.at, open: n === this.reg.current }] : [];
    });
  }

  private checkName(name: string): string {
    const n = name.trim();
    if (!NAME.test(n)) throw new Error('A board name is 1-60 letters, digits, spaces, dots, dashes or underscores, starting with a letter or digit.');
    return n;
  }

  /** Make a new board, blank or copied from `from`. It becomes the open one unless `open` is false. */
  create(name: string, from?: string, open = true): string {
    const n = this.checkName(name);
    if (this.find(n)) throw new Error(`There is already a board called "${this.find(n)}". Pick another name or switch to it.`);
    const src = from === undefined ? null : this.find(from);
    if (from !== undefined && !src) throw new Error(`There is no board called "${from}" to copy. Boards: ${this.names().join(', ')}.`);
    const base = src ? this.slotFor(src)! : null;
    const s: Slot = { name: n, board: base ? cloneBoard(base.board) : freshBoard(), baseline: base ? cloneBoard(base.board) : null, rev: ++this.reg.clock, at: Date.now() };
    this.reg.slots.set(n, s);
    this.save(s);
    if (open) this.open_(n); else this.emit('boards', s);
    return n;
  }

  private open_(name: string) {
    const s = this.slotFor(name)!;
    this.reg.current = name;
    s.rev = ++this.reg.clock; // newer than anything the browser has seen, so it takes this board
    this.saveCurrent();
    this.emit('board', s);
    this.emit('boards', s);
  }

  /** Open a board in the browser (and as the default for tools). */
  switchTo(name: string): string {
    const n = this.find(name);
    if (!n) throw new Error(`There is no board called "${name}". Boards: ${this.names().join(', ')}.`);
    if (n !== this.reg.current) this.open_(n);
    return n;
  }

  rename(from: string, to: string): string {
    const old = this.find(from);
    if (!old) throw new Error(`There is no board called "${from}".`);
    const n = this.checkName(to);
    if (this.find(n) && this.find(n)!.toLowerCase() !== old.toLowerCase()) throw new Error(`There is already a board called "${this.find(n)}".`);
    const s = this.slotFor(old)!;
    const f0 = this.file(old);
    this.reg.slots.delete(old);
    s.name = n;
    this.reg.slots.set(n, s);
    if (f0 && existsSync(f0)) { try { renameSync(f0, this.file(n)!); } catch { /* saved below */ } }
    this.save(s);
    if (this.reg.current === old) { this.reg.current = n; this.saveCurrent(); }
    this.emit('boards', s);
    return n;
  }

  /** Delete a board; the file moves to `<dir>/.trash/` so it can be restored by hand. Deleting the open board opens another one. */
  remove(name: string): { name: string; opened: string } {
    const n = this.find(name);
    if (!n) throw new Error(`There is no board called "${name}". Boards: ${this.names().join(', ')}.`);
    const f = this.file(n);
    if (f && existsSync(f)) {
      const trash = join(this.reg.dir!, '.trash');
      mkdirSync(trash, { recursive: true });
      renameSync(f, join(trash, `${n}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
    }
    this.reg.slots.delete(n);
    if (this.reg.current === n) {
      const next = this.names()[0] ?? DEFAULT_BOARD;
      if (!this.names().length) this.slotFor(next, true);
      this.open_(next);
    } else this.emit('boards', this.slotFor(this.reg.current)!);
    return { name: n, opened: this.reg.current };
  }
}
