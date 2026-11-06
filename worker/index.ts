import { Session } from './session';
export { Session };

export interface Env {
  SESSION: DurableObjectNamespace;
  /** secret used to sign session ids, so made-up addresses are refused before they cost anything */
  SESSION_KEY: string;
  ALLOWED_ORIGINS?: string;
  SESSION_DAYS?: string;
}

const enc = new TextEncoder();
const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sign(key: string, nonce: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url((await crypto.subtle.sign('HMAC', k, enc.encode(nonce))).slice(0, 16));
}

/** A session secret is `<nonce>.<signature>`: it names the session and is the only credential for it. */
async function mint(key: string): Promise<string> {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  return `${nonce}.${await sign(key, nonce)}`;
}

async function valid(key: string, secret: string): Promise<boolean> {
  const [nonce, sig, extra] = secret.split('.');
  if (!nonce || !sig || extra !== undefined || nonce.length > 40) return false;
  const want = enc.encode(await sign(key, nonce)), got = enc.encode(sig);
  if (want.length !== got.length) return false;
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= want[i] ^ got[i];
  return d === 0;
}

function originAllowed(origin: string | null, env: Env): boolean {
  if (!origin || origin === 'null') return true; // not a browser, or the app opened from a file; the secret in the address still protects everything
  if ((env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).includes(origin)) return true;
  try { const h = new URL(origin).hostname; return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'; } catch { return false; }
}

const MAX_BODY = 8 * 1024 * 1024;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('origin');
    const cors: Record<string, string> = origin && originAllowed(origin, env)
      ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
    const json = (code: number, body: unknown, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors, ...extra } });

    if (!env.SESSION_KEY) return json(500, { error: 'The bridge is not set up: SESSION_KEY secret is missing.' });
    if (!originAllowed(origin, env)) return json(403, { error: 'origin not allowed' });

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, 'access-control-allow-headers': 'content-type, x-axsq-token, authorization, mcp-protocol-version, mcp-session-id', 'access-control-allow-methods': 'GET, PUT, POST, OPTIONS', 'access-control-max-age': '600' } });
    }
    if (req.method === 'GET' && url.pathname === '/') {
      return new Response('axSquiggle hosted bridge. Open the app and press "Activate MCP".\n', { headers: { 'content-type': 'text/plain', ...cors } });
    }

    // POST /api/sessions -> a new private session and the addresses to use
    if (req.method === 'POST' && url.pathname === '/api/sessions') {
      const secret = await mint(env.SESSION_KEY);
      const base = `${url.origin}/s/${secret}`;
      return json(200, {
        secret, url: base, token: secret, mcpUrl: `${base}/mcp`,
        claudeCode: `claude mcp add --transport http axsquiggle ${base}/mcp`,
        days: Number(env.SESSION_DAYS ?? 30),
      });
    }

    // /s/<secret>/<rest> -> that session's Durable Object
    const m = /^\/s\/([^/]+)(\/.*)$/.exec(url.pathname);
    if (!m) return json(404, { error: 'not found' });
    const secret = decodeURIComponent(m[1]);
    if (!(await valid(env.SESSION_KEY, secret))) return json(404, { error: 'not found' }); // same answer as a missing page: reveals nothing
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return json(413, { error: 'Body too large (8 MB limit).' });

    const inner = new URL(req.url);
    inner.pathname = m[2];
    const stub = env.SESSION.get(env.SESSION.idFromName(secret));
    const res = await stub.fetch(new Request(inner, req));
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
} satisfies ExportedHandler<Env>;
