import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createHttp } from '../server/http';
import { BoardServer } from '../server/state';
import { callTool as callToolFull } from '../server/tools';

const callTool = async (...a: Parameters<typeof callToolFull>) => (await callToolFull(...a)).text;
import { exampleBoard } from '../src/core/model';

let state: BoardServer, http: Server, base: string;
const H = { 'x-axsq-token': 'secret', 'content-type': 'application/json' };

beforeEach(async () => {
  state = new BoardServer();
  http = createHttp(state, { token: 'secret' });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
afterEach(() => { http.closeAllConnections(); http.close(); });

describe('bridge', () => {
  it('refuses requests without the token or from foreign origins', async () => {
    expect((await fetch(`${base}/api/board`)).status).toBe(401);
    expect((await fetch(`${base}/api/board`, { headers: { ...H, origin: 'https://evil.example' } })).status).toBe(403);
    const ok = await fetch(`${base}/api/board`, { headers: { ...H, origin: 'http://localhost:5173' } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('lets the browser write its board and rejects a stale write after the AI changed it', async () => {
    const put = (board: unknown, baseRev: number) => fetch(`${base}/api/board`, { method: 'PUT', headers: H, body: JSON.stringify({ board, baseRev }) });
    expect((await put(exampleBoard(), 0)).status).toBe(200);          // rev 1
    await callTool(state, 'edit_frame', { frame: 1, caption: 'AI caption' });   // rev 2
    const stale = await put(exampleBoard(), 1);
    expect(stale.status).toBe(409);
    expect((await stale.json() as { rev: number }).rev).toBe(2);
    expect(state.board.frames[0].caption).toBe('AI caption');
  });

  it('runs the whole draft, review, action loop through the tools', async () => {
    const out = await callTool(state, 'draft_board', { frames: [{ caption: 'Login', outline: 'header Acme\ninput Email\nbutton Sign in' }] });
    expect(out).toContain('Button "Sign in"');
    // the person edits in the browser and writes a note; nothing is pushed to the AI
    const mine = JSON.parse(JSON.stringify(state.board));
    mine.frames[0].shapes.push({ k: 'text', x: 40, y: 400, s: 'Forgot password?' });
    mine.frames[0].notes.push({ id: 'n1', text: 'Sign in should be bigger', box: [0, 0, 0, 0], about: ['Button "Sign in"'] });
    expect((await fetch(`${base}/api/board`, { method: 'PUT', headers: H, body: JSON.stringify({ board: mine, baseRev: state.rev }) })).status).toBe(200);
    // the AI is told in chat, and retrieves the review over MCP
    const packet = await callTool(state, 'get_review', {});
    expect(packet).toContain('[n1]');
    expect(packet).toContain('Sign in should be bigger');
    expect(packet).toContain('Forgot password?');
    await callTool(state, 'edit_element', { frame: 1, label: 'Sign in', set_label: 'Sign in now' });
    await callTool(state, 'resolve_notes', { ids: ['n1'], reply: 'Relabelled it' });
    expect(state.board.frames[0].notes[0]).toMatchObject({ done: true, reply: 'Relabelled it' });
    expect(await callTool(state, 'get_review', {})).toContain('Open review notes: 0');
  });

  it('refuses an edit based on an old revision', async () => {
    await callTool(state, 'draft_board', { frames: [{ outline: 'button A' }] });
    const rev = state.rev;
    await callTool(state, 'edit_frame', { frame: 1, caption: 'x' });
    await expect(callTool(state, 'edit_frame', { frame: 1, caption: 'y', expected_rev: rev })).rejects.toThrow(/changed since you read it/);
  });

  it('streams board events to the browser', async () => {
    const res = await fetch(`${base}/api/events?token=secret`);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let seen = '';
    const read = async (until: string) => { while (!seen.includes(until)) { const { value, done } = await reader.read(); if (done) break; seen += dec.decode(value); } };
    await read('event: hello');
    await callTool(state, 'draft_board', { frames: [{ outline: 'button A' }] });
    await read('event: board');
    expect(seen).toMatch(/event: board\ndata: {"rev":1,"name":"default"}/);
    await reader.cancel();
  });
});

describe('images for the AI', () => {
  it('returns the images people dropped behind frames with the review, and with get_board on request', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await callToolFull(state, 'draft_board', { frames: [{ caption: 'Sketch', outline: 'header Home' }] });
    state.aiWrite((b) => { b.frames[0].bg = png; });
    const r = await callToolFull(state, 'get_review', {});
    expect(r.images).toHaveLength(1);
    expect(r.images[0]).toMatchObject({ mediaType: 'image/png', label: expect.stringContaining('Frame 1 "Sketch"') });
    expect(r.text).toContain('has an image behind it');
    expect((await callToolFull(state, 'get_board', {})).images).toHaveLength(0);
    expect((await callToolFull(state, 'get_board', { include_images: true })).images).toHaveLength(1);
  });
});

describe('locked-down networks', () => {
  it('answers Chrome\'s private-network preflight and the file:// origin', async () => {
    const pre = await fetch(`${base}/api/board`, { method: 'OPTIONS', headers: { origin: 'https://tools.example.com', 'access-control-request-method': 'GET', 'access-control-request-private-network': 'true', host: '127.0.0.1' } }).catch(() => null);
    // a public https page is not a local origin, so it is refused outright unless the operator allows it
    expect(pre?.status).toBe(403);
    const local = await fetch(`${base}/api/board`, { method: 'OPTIONS', headers: { origin: 'http://localhost:5173', 'access-control-request-private-network': 'true' } });
    expect(local.status).toBe(204);
    expect(local.headers.get('access-control-allow-private-network')).toBe('true');
    expect((await fetch(`${base}/api/board`, { headers: { ...H, origin: 'null' } })).status).toBe(200);     // the app opened from a file
  });

  it('allows a configured public origin, and polling works without the event stream', async () => {
    http.closeAllConnections(); http.close();
    http = createHttp(state, { token: 'secret', origins: ['https://tools.example.com'] });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    const pre = await fetch(`${base}/api/board`, { method: 'OPTIONS', headers: { origin: 'https://tools.example.com', 'access-control-request-private-network': 'true' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-private-network')).toBe('true');
    expect(await (await fetch(`${base}/api/rev`, { headers: H })).json()).toEqual({ rev: 0, name: "default" });
    await callToolFull(state, 'draft_board', { frames: [{ outline: 'button A' }] });
    expect(await (await fetch(`${base}/api/rev`, { headers: H })).json()).toEqual({ rev: 1, name: "default" });
  });

  it('never writes the token into the page when the bridge is shared, and refuses unknown hosts', async () => {
    http.closeAllConnections(); http.close();
    const page = (u: string, t: string | null) => `<html>${u} ${t ?? 'NO-TOKEN'}</html>`;
    http = createHttp(state, { token: 'secret', loopbackOnly: false, hosts: ['wire.corp.example'], selfUrl: 'https://wire.corp.example', page });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    expect(await (await fetch(`${base}/`)).text()).toBe('<html>https://wire.corp.example NO-TOKEN</html>');
    // a known host name is accepted (set the Host header the way a reverse proxy would)
    const { request } = await import('node:http');
    const status = await new Promise<number>((res) => { const r = request({ host: '127.0.0.1', port: (http.address() as AddressInfo).port, path: '/api/rev', headers: { host: 'wire.corp.example', 'x-axsq-token': 'secret' } }, (x) => { x.resume(); res(x.statusCode ?? 0); }); r.end(); });
    expect(status).toBe(200);
    const bad = await new Promise<number>((res) => { const r = request({ host: '127.0.0.1', port: (http.address() as AddressInfo).port, path: '/api/rev', headers: { host: 'other.example', 'x-axsq-token': 'secret' } }, (x) => { x.resume(); res(x.statusCode ?? 0); }); r.end(); });
    expect(bad).toBe(403);
    http = createHttp(state, { token: 'secret', loopbackOnly: true, page });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    expect(await (await fetch(`${base}/`)).text()).toContain('secret');                       // this machine only: the token is in the page
  });

  it('speaks MCP over plain HTTP (Streamable HTTP) with a bearer token', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const denied = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(denied.status).toBe(401);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: 'Bearer secret' } } }));
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('draft_board');
    const r = await client.callTool({ name: 'draft_board', arguments: { frames: [{ caption: 'Over HTTP', outline: 'header Hi' }] } });
    expect((r.content as { text: string }[])[0].text).toContain('Drafted 1 frame');
    expect(state.board.frames[0].caption).toBe('Over HTTP');
    await client.close();
  });

  it('load_board restores what get_board (json) saved, and can append', async () => {
    await callTool(state, 'draft_board', { frames: [{ caption: 'Home', outline: 'h1 Welcome\nbutton Go' }, { caption: 'Next', outline: 'text Hi' }] });
    const saved = await callTool(state, 'get_board', { format: 'json' });
    await callTool(state, 'draft_board', { frames: [{ outline: 'text other' }] });
    expect(state.board.frames).toHaveLength(1);
    await callTool(state, 'load_board', { board: saved });
    expect(state.board.frames.map((f) => f.caption)).toEqual(['Home', 'Next']);
    await callTool(state, 'load_board', { board: saved, replace: false });
    expect(state.board.frames).toHaveLength(4);
    expect(new Set(state.board.frames.map((f) => f.id)).size).toBe(4);
    await expect(callTool(state, 'load_board', { board: '{"nope":1}' })).rejects.toThrow(/not a valid board/);
  });
});
