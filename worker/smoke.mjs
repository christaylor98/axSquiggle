// End-to-end check of a running hosted bridge:  node worker/smoke.mjs http://localhost:8788
const base = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  ' + extra}`); if (!ok) failed++; };
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

const s = await j(await fetch(`${base}/api/sessions`, { method: 'POST' }));
check('session minted', s.url?.startsWith(base + '/s/') && s.mcpUrl?.endsWith('/mcp') && s.claudeCode?.includes('--transport http'), JSON.stringify(s));
const api = (p, init = {}) => fetch(`${s.url}${p}`, init);

check('made-up secret is refused', (await fetch(`${base}/s/abc.def/api/board`)).status === 404);
check('tampered signature is refused', (await fetch(`${s.url.slice(0, -1)}x/api/board`)).status === 404);
check('disallowed origin is refused', (await api('/api/board', { headers: { origin: 'https://evil.example' } })).status === 403);
check('allowed origin gets CORS', (await api('/api/board', { headers: { origin: 'http://localhost:5173' } })).headers.get('access-control-allow-origin') === 'http://localhost:5173');
check('preflight answers', (await fetch(`${s.url}/api/board`, { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } })).status === 204);

// the REST tool endpoint (the same one the local bridge has)
const draft = await api('/api/tools/draft_board', { method: 'POST', body: JSON.stringify({ frames: [{ caption: 'Sign in', outline: 'header Welcome\ninput Email\nbutton Sign in' }] }) });
const dj = await j(draft);
check('draft_board over REST', draft.ok && /Drafted 1 frame/.test(dj.text), JSON.stringify(dj));

// the browser app's own calls
const b = await j(await api('/api/board'));
check('GET /api/board', b.rev > 0 && b.board.frames.length === 1, JSON.stringify(b).slice(0, 200));
const stale = await api('/api/board', { method: 'PUT', body: JSON.stringify({ board: b.board, baseRev: b.rev - 1 }) });
check('stale PUT is rejected (409)', stale.status === 409);
const fresh = await api('/api/board', { method: 'PUT', body: JSON.stringify({ board: b.board, baseRev: b.rev }) });
check('current PUT is accepted', fresh.ok, String(fresh.status));
check('preview export', (await (await api('/api/export/preview')).text()).includes('<html'));

// live updates
const ev = await api('/api/events');
const reader = ev.body.getReader(); const dec = new TextDecoder();
let seen = '';
const pump = (async () => { for (;;) { const { value, done } = await reader.read(); if (done) return; seen += dec.decode(value); } })();
await new Promise((r) => setTimeout(r, 400));
await api('/api/tools/edit_frame', { method: 'POST', body: JSON.stringify({ frame: 1, outline: 'text Forgot password?' }) });
await new Promise((r) => setTimeout(r, 600));
check('SSE: hello then board event', seen.includes('event: hello') && seen.includes('event: board'), seen);
await reader.cancel(); await pump.catch(() => {});

// MCP over HTTPS, the way an AI client talks to it
const rpc = async (method, params, id) => {
  const r = await fetch(s.mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
  return { status: r.status, body: await j(r) };
};
const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } }, 1);
check('MCP initialize', init.body?.result?.serverInfo?.name === 'axsquiggle', JSON.stringify(init));
const list = await rpc('tools/list', {}, 2);
check('MCP tools/list has draft_board and get_review', ['draft_board', 'get_review', 'resolve_notes'].every((n) => list.body?.result?.tools?.some((t) => t.name === n)), JSON.stringify(list).slice(0, 200));
const call = await rpc('tools/call', { name: 'get_board', arguments: {} }, 3);
check('MCP tools/call sees the same board', /Forgot password/.test(JSON.stringify(call.body)), JSON.stringify(call).slice(0, 300));
check('MCP GET is 405', (await fetch(s.mcpUrl)).status === 405);

// sessions are separate
const s2 = await j(await fetch(`${base}/api/sessions`, { method: 'POST' }));
const b2 = await j(await fetch(`${s2.url}/api/board`));
check('another session has its own empty board', b2.board.frames.length === 1 && !JSON.stringify(b2.board).includes('Forgot'), JSON.stringify(b2).slice(0, 200));

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
