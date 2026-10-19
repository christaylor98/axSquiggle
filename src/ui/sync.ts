import { validateBoard } from '../core/model';
import type { Store } from './store';

export type SyncState = 'off' | 'connecting' | 'on' | 'error';
interface Config { url: string; token: string; /** the page was served by the bridge itself, so the bridge's board is the real one and the local copy is only a cache */ authoritative?: boolean }
const KEY = 'axsq.bridge';

/**
 * Keeps this board and the AI bridge (see server/) in step: local edits are pushed, AI edits arrive as an undoable replacement.
 * Both directions use revisions, so a write based on an old revision is refused rather than overwriting.
 */
export class Sync {
  state: SyncState = 'off';
  config: Config | null = null;
  /** the name of the board shown (the bridge can hold several) */
  name = '';
  private rev = 0;
  private es: EventSource | null = null;
  private timer = 0;
  private poll = 0;
  private pushing: Promise<void> | null = null;
  private applying = false;
  onChange: () => void = () => {};

  constructor(private store: Store, private toast: (m: string) => void) {
    try { const raw = localStorage.getItem(KEY); if (raw) this.config = JSON.parse(raw) as Config; } catch { /* none */ }
    store.subscribe(() => { if (this.state === 'on' && !this.applying) this.schedulePush(); });
  }

  /** Pick up ?bridge=...&token=... from the address bar (and take the token out of it). */
  static fromLocation(): Config | null {
    // Served by the bridge itself: the address and token are already in the page.
    const injected = (window as unknown as { __AXSQ__?: Partial<Config> }).__AXSQ__;
    if (injected?.url && injected.token) return { url: injected.url.replace(/\/$/, ''), token: injected.token, authoritative: true };
    const q = new URLSearchParams(location.search);
    const url = q.get('bridge'), token = q.get('token');
    if (!url || !token) return null;
    q.delete('bridge'); q.delete('token');
    history.replaceState(null, '', location.pathname + (q.toString() ? `?${q}` : '') + location.hash);
    return { url: url.replace(/\/$/, ''), token };
  }

  private headers() { return { 'content-type': 'application/json', 'x-axsq-token': this.config!.token }; }
  private set(s: SyncState) { this.state = s; this.onChange(); }

  async connect(cfg: Config | null = this.config): Promise<boolean> {
    if (!cfg) return false;
    this.disconnect(false);
    this.config = { url: cfg.url.replace(/\/$/, ''), token: cfg.token };
    const authoritative = cfg.authoritative === true;
    this.set('connecting');
    try {
      const r = await fetch(`${this.config.url}/api/board`, { headers: this.headers() });
      if (!r.ok) throw new Error(r.status === 401 ? 'wrong token' : `bridge said ${r.status}`);
      const j = (await r.json()) as { rev: number; name?: string; board: unknown };
      this.rev = j.rev;
      this.name = j.name ?? '';
      const server = validateBoard(j.board);
      const mine = this.store.state.board;
      const trivial = mine.example === true || mine.frames.every((f) => !f.shapes.length);
      if (server && (j.rev > 0 || trivial)) {
        if (!trivial && j.rev > 0 && !authoritative && !confirm(`The AI bridge already has a board (revision ${j.rev}).\n\nOK: replace the board here with it (Undo brings yours back).\nCancel: keep yours and send it to the AI.`)) await this.push(true);
        else this.adopt(server);
      } else await this.push(true);
      localStorage.setItem(KEY, JSON.stringify({ url: this.config.url, token: this.config.token }));
      this.listen();
      this.set('on');
      this.toast('Connected to the AI bridge');
      return true;
    } catch (e) {
      this.set('error');
      this.toast(`Could not connect: ${(e as Error).message}`);
      return false;
    }
  }

  disconnect(forget = true) {
    this.es?.close(); this.es = null; clearTimeout(this.timer); this.stopPolling();
    if (forget) { try { localStorage.removeItem(KEY); } catch { /* ignore */ } this.config = null; }
    this.set('off');
  }

  private listen() {
    const { url, token } = this.config!;
    this.es = new EventSource(`${url}/api/events?token=${encodeURIComponent(token)}`);
    this.es.addEventListener('board', (e) => {
      const rev = (JSON.parse((e as MessageEvent).data) as { rev: number }).rev;
      if (!this.pushing && rev > this.rev) void this.pull('The AI updated the board (Undo to revert)');
    });
    this.es.addEventListener('boards', () => this.onChange());
    this.es.addEventListener('hello', (e) => {
      const rev = (JSON.parse((e as MessageEvent).data) as { rev: number }).rev;
      if (!this.pushing && rev > this.rev) void this.pull('The AI updated the board while you were away (Undo to revert)');
    });
    // Some corporate proxies break server-sent events. If the stream drops, ask for the revision every few seconds instead.
    this.es.onerror = () => { if (this.state === 'on') this.set('error'); this.startPolling(); };
    this.es.onopen = () => { this.stopPolling(); if (this.state === 'error') this.set('on'); };
  }

  private startPolling() {
    if (this.poll || !this.config) return;
    this.poll = window.setInterval(async () => {
      try {
        const r = await fetch(`${this.config!.url}/api/rev`, { headers: this.headers() });
        if (!r.ok) return;
        if (this.state === 'error') this.set('on');
        const rev = ((await r.json()) as { rev: number }).rev;
        if (!this.pushing && rev > this.rev) await this.pull('The AI updated the board (Undo to revert)');
      } catch { if (this.state === 'on') this.set('error'); }
    }, 3000);
  }
  private stopPolling() { if (this.poll) { clearInterval(this.poll); this.poll = 0; } }

  private adopt(board: ReturnType<typeof validateBoard>, another = false) {
    if (!board) return;
    const cur = this.store.state.cur;
    this.applying = true;
    try {
      if (another) this.store.openBoard(board);
      else { this.store.replaceBoard(board); this.store.setCur(Math.min(cur, board.frames.length - 1)); }
    } finally { this.applying = false; }
  }

  private api<T>(path: string, body?: unknown): Promise<T> {
    return fetch(`${this.config!.url}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: this.headers(), body: body === undefined ? undefined : JSON.stringify(body) })
      .then(async (r) => { const j = await r.json() as T & { error?: string }; if (!r.ok) throw new Error(j.error ?? `bridge said ${r.status}`); return j; });
  }

  /** The boards the bridge holds. */
  boards() { return this.api<{ open: string; boards: { name: string; frames: number; changed: number; open: boolean }[] }>('/api/boards'); }
  /** Open a board (or make a new one when `create`); the browser then pulls it like any other change. */
  async openNamed(name: string, create = false) {
    await this.flush();
    await this.api(`/api/tools/${create ? 'new_board' : 'switch_board'}`, { name });
    await this.pull(`Board: ${name}`);
  }

  /** Let a pending local edit reach the bridge first, so it lands on the board it was made on. */
  private async flush() { if (this.timer) { clearTimeout(this.timer); this.timer = 0; await this.push(); } }

  private async pull(message: string) {
    const r = await fetch(`${this.config!.url}/api/board`, { headers: this.headers() });
    if (!r.ok) return;
    const j = (await r.json()) as { rev: number; name?: string; board: unknown };
    this.rev = j.rev;
    const another = (j.name ?? '') !== this.name;
    this.name = j.name ?? '';
    this.adopt(validateBoard(j.board), another);
    this.toast(another ? `Opened board "${this.name}"` : message);
    this.onChange();
  }

  private schedulePush() {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.timer = 0; void this.push(); }, 350);
  }

  private push(first = false): Promise<void> {
    if (this.pushing) return this.pushing;
    this.pushing = (async () => {
      try {
        const r = await fetch(`${this.config!.url}/api/board`, { method: 'PUT', headers: this.headers(), body: JSON.stringify({ board: this.store.state.board, baseRev: this.rev }) });
        if (r.ok) this.rev = ((await r.json()) as { rev: number }).rev;
        else if (r.status === 409 && !first) { await this.pull('The AI changed the board while you were editing, so your last change was not sent (Undo returns it)'); }
        else if (!r.ok && !first) this.toast(`Could not send to the AI bridge (${r.status})`);
      } catch { if (this.state === 'on') this.set('error'); }
      finally { this.pushing = null; }
    })();
    return this.pushing;
  }
}
