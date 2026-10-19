import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { reviewPacket } from '../src/core/agent';
import { prototypeHTML } from '../src/core/exporters';
import { previewHTML } from '../src/core/preview';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { appPage } from './app';
import { buildMcp } from './mcp';
import { callTool, TOOLS } from './tools';
import type { BoardServer } from './state';

export interface HttpOpts {
  token: string;
  origins?: string[];
  /** this server's own base URL, written into the served app */
  selfUrl?: string;
  /** true when only this machine can reach the server; the served app then carries the token so opening it needs no typing */
  loopbackOnly?: boolean;
  /** extra host names this server may be addressed by (when it runs on a shared server behind a proxy) */
  hosts?: string[];
  /** page renderer, replaceable in tests */
  page?: (url: string, token: string | null) => string | null;
}

const MAX_BODY = 40 * 1024 * 1024; // screenshots ride inside the board as data URLs

function sameToken(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Local origins (the dev server, a built copy served from localhost) plus anything listed explicitly. */
function originAllowed(origin: string | undefined, extra: string[]): boolean {
  if (!origin) return true; // not a browser (curl, the MCP proxy)
  if (origin === 'null') return true; // the app opened straight from a file (file://); the token still protects everything
  if (extra.includes(origin)) return true;
  try { const u = new URL(origin); return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]'; } catch { return false; }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > MAX_BODY) throw new Error('Body too large'); chunks.push(c as Buffer); }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

/** Only answer requests addressed to localhost: stops DNS-rebinding tricks from a web page reaching this server. */
function hostAllowed(host: string | undefined, extra: string[]): boolean {
  const h = (host ?? '').replace(/:\d+$/, '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || extra.includes(h);
}

/**
 * The bridge between the browser app and a tool-using AI. Everything needs the token; browsers are also restricted to local origins.
 *   GET  /api/board            -> { rev, name, board }   the open board
 *   GET  /api/export/preview   -> the realistic preview page (?style=clean|material|dark|brand|minimal)
 *   GET  /api/boards           -> { open, boards: [{ name, frames, rev, changed, open }] }
 *   PUT  /api/board            { board, baseRev } -> { ok, rev } or 409 { rev }
 *   GET  /api/review           -> the review packet as text
 *   GET  /api/export/prototype -> the board as a click-through HTML prototype
 *   GET  /api/events           server-sent events: board
 *   POST /api/tools/:name      run one tool (same as MCP) -> { text } (used by the stdio proxy)
 */
export function createHttp(state: BoardServer, opts: HttpOpts): Server {
  const extra = opts.origins ?? [], hosts = (opts.hosts ?? []).map((h) => h.toLowerCase()), loopback = opts.loopbackOnly !== false;
  const render = opts.page ?? ((u: string, t: string | null) => appPage(u, t));
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin as string | undefined;
    const send = (code: number, body: unknown, type = 'application/json') => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...(origin && originAllowed(origin, extra) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}) });
      res.end(type === 'application/json' ? JSON.stringify(body) : String(body));
    };
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (!hostAllowed(req.headers.host, hosts)) return send(403, { error: 'host not allowed' });
      if (!originAllowed(origin, extra)) return send(403, { error: 'origin not allowed' });
      // The app itself, pre-wired to this bridge: open the printed address and everything works.
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        // On a shared server the page must not carry the token (anyone reaching it would be let in): people type it once instead.
        const page = render(opts.selfUrl ?? `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`, loopback ? opts.token : null);
        return page ? send(200, page, 'text/html; charset=utf-8') : send(404, 'The app is not built into this copy (run npm run dist).', 'text/plain');
      }
      if (req.method === 'OPTIONS') {
        // Chrome asks permission before a page on a public address may talk to a private one (Private Network Access): say yes.
        res.writeHead(204, { 'access-control-allow-origin': origin ?? '*', ...(req.headers['access-control-request-private-network'] ? { 'access-control-allow-private-network': 'true' } : {}), 'access-control-allow-headers': 'content-type, x-axsq-token, authorization', 'access-control-allow-methods': 'GET, PUT, POST, OPTIONS', 'access-control-max-age': '600', vary: 'Origin' });
        return res.end();
      }
      const bearer = /^Bearer\s+(.+)$/i.exec((req.headers.authorization as string | undefined) ?? '')?.[1];
      const given = (req.headers['x-axsq-token'] as string | undefined) ?? bearer ?? url.searchParams.get('token') ?? '';
      if (!sameToken(given, opts.token)) return send(401, { error: 'missing or wrong token' });

      if (req.method === 'GET' && url.pathname === '/api/health') return send(200, { ok: true, rev: state.rev, tools: TOOLS.map((t) => t.name) });
      if (req.method === 'GET' && url.pathname === '/api/rev') return send(200, { rev: state.rev, name: state.open });   // cheap poll, for networks that break the event stream
      if (req.method === 'GET' && url.pathname === '/api/board') return send(200, { rev: state.rev, name: state.name, board: state.board });
      if (req.method === 'GET' && url.pathname === '/api/boards') return send(200, { open: state.open, boards: state.list() });
      if (url.pathname === '/mcp') {
        // MCP over plain HTTPS (Streamable HTTP, stateless): for AI clients that connect to a URL, and for a bridge hosted on a server.
        if (req.method !== 'POST') return send(405, { error: 'POST only' });
        const server = buildMcp({ call: (n, a) => callTool(state, n, a) });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on('close', () => { void transport.close(); void server.close(); });
        await server.connect(transport);
        await transport.handleRequest(req, res, await readBody(req));
        return;
      }
      if (req.method === 'PUT' && url.pathname === '/api/board') {
        const body = (await readBody(req)) as { board?: unknown; baseRev?: unknown };
        const r = state.userWrite(body.board, typeof body.baseRev === 'number' ? body.baseRev : -1);
        return r.ok ? send(200, r) : send(409, { ok: false, rev: r.rev });
      }
      if (req.method === 'GET' && url.pathname === '/api/export/preview') return send(200, previewHTML(state.board, url.searchParams.get('title') || 'Preview', url.searchParams.get('style') || undefined), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/api/export/prototype') return send(200, prototypeHTML(state.board, url.searchParams.get('title') || 'Prototype'), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/api/review') return send(200, reviewPacket(state.board, state.baseline, state.rev).text, 'text/plain');
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}) });
        res.write(`event: hello\ndata: ${JSON.stringify({ rev: state.rev, name: state.open })}\n\n`);
        const off = state.subscribe((e) => res.write(`event: ${e.type}\ndata: ${JSON.stringify({ rev: e.rev, name: e.name })}\n\n`));
        const ping = setInterval(() => res.write(': ping\n\n'), 20000);
        req.on('close', () => { off(); clearInterval(ping); });
        return;
      }
      const m = /^\/api\/tools\/([\w-]+)$/.exec(url.pathname);
      if (req.method === 'POST' && m) {
        try { return send(200, await callTool(state, m[1], await readBody(req))); }
        catch (e) { return send(400, { error: (e as Error).message }); }
      }
      return send(404, { error: 'not found' });
    } catch (e) {
      return send(500, { error: (e as Error).message });
    }
  });
}
