import { DurableObject } from 'cloudflare:workers';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { reviewPacket } from '../src/core/agent';
import { prototypeHTML } from '../src/core/exporters';
import { previewHTML } from '../src/core/preview';
import { buildMcp } from '../server/mcp';
import { BoardServer, type Snapshot } from '../server/state';
import { callTool, TOOLS } from '../server/tools';
import type { Env } from './index';

const CHUNK = 500_000;        // characters per stored value (a SQLite-backed Durable Object value may be 2 MB)
const MAX_STORED = 12_000_000; // characters per session: screenshots ride inside the board
const DAY = 86_400_000;

/** One person's session: their boards, kept in memory while busy and in Durable Object storage always. */
export class Session extends DurableObject<Env> {
  private boards?: BoardServer;
  private dirty = false;
  private stored = 0; // number of stored chunks

  private async open(): Promise<BoardServer> {
    if (this.boards) return this.boards;
    const b = new BoardServer();
    const n = (await this.ctx.storage.get<number>('n')) ?? 0;
    this.stored = n;
    if (n) {
      const parts = await this.ctx.storage.get<string>(Array.from({ length: n }, (_, i) => `c${i}`));
      try { b.restore(JSON.parse(Array.from({ length: n }, (_, i) => parts.get(`c${i}`) ?? '').join('')) as Snapshot); } catch { /* start blank */ }
    }
    b.subscribe(() => { this.dirty = true; });
    this.boards = b;
    return b;
  }

  /** Write the boards out if something changed. Refuses (and rolls back) a board too large to keep. */
  private async save(): Promise<boolean> {
    if (!this.dirty || !this.boards) return true;
    this.dirty = false;
    const text = JSON.stringify(this.boards.snapshot());
    if (text.length > MAX_STORED) { this.boards = undefined; return false; } // reloaded from the last good copy on the next request
    const n = Math.ceil(text.length / CHUNK);
    const puts: Record<string, unknown> = { n };
    for (let i = 0; i < n; i++) puts[`c${i}`] = text.slice(i * CHUNK, (i + 1) * CHUNK);
    await this.ctx.storage.put(puts);
    if (this.stored > n) await this.ctx.storage.delete(Array.from({ length: this.stored - n }, (_, i) => `c${n + i}`));
    this.stored = n;
    return true;
  }

  async alarm() { await this.ctx.storage.deleteAll(); this.boards = undefined; this.stored = 0; }

  async fetch(req: Request): Promise<Response> {
    const days = Number(this.env.SESSION_DAYS ?? 30) || 30;
    await this.ctx.storage.setAlarm(Date.now() + days * DAY); // idle sessions expire
    const state = await this.open();
    const res = await this.route(req, state);
    if (!(await this.save())) return json(413, { error: 'That board is too large to keep (about 12 MB with pictures). Remove or shrink pictures.' });
    return res;
  }

  private async route(req: Request, state: BoardServer): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    const get = req.method === 'GET';

    if (get && p === '/api/health') return json(200, { ok: true, rev: state.rev, tools: TOOLS.map((t) => t.name) });
    if (get && p === '/api/rev') return json(200, { rev: state.rev, name: state.open });
    if (get && p === '/api/board') return json(200, { rev: state.rev, name: state.name, board: state.board });
    if (get && p === '/api/boards') return json(200, { open: state.open, boards: state.list() });
    if (get && p === '/api/review') return text(200, reviewPacket(state.board, state.baseline, state.rev).text);
    if (get && p === '/api/export/preview') return html(previewHTML(state.board, url.searchParams.get('title') || 'Preview', url.searchParams.get('style') || undefined));
    if (get && p === '/api/export/prototype') return html(prototypeHTML(state.board, url.searchParams.get('title') || 'Prototype'));

    if (req.method === 'PUT' && p === '/api/board') {
      const body = (await readJson(req)) as { board?: unknown; baseRev?: unknown };
      const r = state.userWrite(body.board, typeof body.baseRev === 'number' ? body.baseRev : -1);
      return r.ok ? json(200, r) : json(409, { ok: false, rev: r.rev });
    }

    if (get && p === '/api/events') return this.events(state, req.signal);

    const m = /^\/api\/tools\/([\w-]+)$/.exec(p);
    if (req.method === 'POST' && m) {
      try { return json(200, await callTool(state, m[1], await readJson(req))); }
      catch (e) { return json(400, { error: (e as Error).message }); }
    }

    if (p === '/mcp') {
      // MCP over HTTPS (Streamable HTTP, stateless): what an AI client connects to by URL.
      if (req.method !== 'POST') return json(405, { error: 'POST only' });
      const server = buildMcp({ call: (n, a) => callTool(state, n, a) });
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      return transport.handleRequest(req);
    }
    return json(404, { error: 'not found' });
  }

  /** Server-sent events: a "board" event whenever the open board changes. Ends after a few minutes; the browser reconnects by itself. */
  private events(state: BoardServer, signal: AbortSignal): Response {
    const te = new TextEncoder();
    let off = () => {}, ping: ReturnType<typeof setInterval>, end: ReturnType<typeof setTimeout>;
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => {
        const send = (s: string) => { try { c.enqueue(te.encode(s)); } catch { /* closed */ } };
        const stop = () => { off(); clearInterval(ping); clearTimeout(end); try { c.close(); } catch { /* closed */ } };
        send(`event: hello\ndata: ${JSON.stringify({ rev: state.rev, name: state.open })}\n\n`);
        off = state.subscribe((e) => send(`event: ${e.type}\ndata: ${JSON.stringify({ rev: e.rev, name: e.name })}\n\n`));
        ping = setInterval(() => send(': ping\n\n'), 15000);
        end = setTimeout(stop, 4 * 60 * 1000);
        signal.addEventListener('abort', stop);
      },
      cancel: () => { off(); clearInterval(ping); clearTimeout(end); },
    });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
  }
}

const json = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const text = (code: number, body: string) => new Response(body, { status: code, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
async function readJson(req: Request): Promise<unknown> { const t = await req.text(); return t ? JSON.parse(t) : {}; }
