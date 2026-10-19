import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHttp } from './http';
import { buildMcp, type Hub } from './mcp';
import { BoardServer } from './state';
import { callTool, type ToolOut } from './tools';

/**
 * axSquiggle bridge.
 *   npm run bridge   HTTP only: the browser app connects here and AIs can POST tools
 *   npm run mcp      MCP over stdio for an AI client; starts the bridge too, or proxies to one that is already running
 * Data lives in $AXSQ_DIR (default ~/.axsquiggle); the token in $AXSQ_DIR/token. Everything binds 127.0.0.1 only.
 */
const dir = process.env.AXSQ_DIR ?? join(homedir(), '.axsquiggle');
const port = Number(process.env.AXSQ_PORT ?? 4747);
const app = process.env.AXSQ_APP ?? 'http://localhost:5173';
// Default: this machine only. On a shared server set AXSQ_HOST=0.0.0.0 and AXSQ_HOSTS=name.of.server, and put HTTPS in front of it.
const host = process.env.AXSQ_HOST ?? '127.0.0.1';
const loopbackOnly = host === '127.0.0.1' || host === 'localhost' || host === '::1';
mkdirSync(dir, { recursive: true });

function loadToken(): string {
  if (process.env.AXSQ_TOKEN) return process.env.AXSQ_TOKEN;
  const f = join(dir, 'token');
  if (existsSync(f)) return readFileSync(f, 'utf8').trim();
  const t = randomBytes(18).toString('base64url');
  writeFileSync(f, t, { mode: 0o600 });
  return t;
}
const token = loadToken();
const log = (m: string) => process.stderr.write(`[axsquiggle] ${m}\n`); // stdout belongs to the MCP protocol
if (Number(process.versions.node.split('.')[0]) < 18) { log(`Node 18 or newer is needed (this is ${process.versions.node}). Get it from https://nodejs.org`); process.exit(1); }

async function startBridge(): Promise<BoardServer | null> {
  const state = new BoardServer(dir);
  const self = `http://127.0.0.1:${port}`;
  const http = createHttp(state, { token, origins: (process.env.AXSQ_ORIGINS ?? '').split(',').filter(Boolean), selfUrl: process.env.AXSQ_PUBLIC_URL ?? (loopbackOnly ? self : undefined), loopbackOnly, hosts: (process.env.AXSQ_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean) });
  return new Promise((resolve, reject) => {
    http.once('error', (e: NodeJS.ErrnoException) => (e.code === 'EADDRINUSE' ? resolve(null) : reject(e)));
    http.listen(port, host, () => {
      log(`bridge running on ${self}`);
      log(`OPEN THE APP: ${self}/        (already connected, nothing to type)`);
      if (!loopbackOnly) log(`SHARED MODE on ${host}: anyone who can reach this port and has the token can read and edit the board. Put HTTPS in front of it. Token: ${token}`);
      else log(`or connect another copy of the app: ${app}/?bridge=${self}&token=${token}`);
      resolve(state);
    });
  });
}

/** Run tools on a bridge that another process already started. */
const remoteHub = (): Hub => ({
  async call(name, args) {
    const r = await fetch(`http://127.0.0.1:${port}/api/tools/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-axsq-token': token }, body: JSON.stringify(args ?? {}) });
    const j = (await r.json()) as { text?: string; images?: ToolOut['images']; error?: string };
    if (!r.ok) throw new Error(j.error ?? `bridge returned ${r.status}`);
    return { text: j.text ?? '', images: j.images ?? [] };
  },
});

// Run by a person in a terminal: just the bridge + app. Spawned by an AI client (stdin is a pipe): speak MCP.
const arg = process.argv.slice(2).find((a) => !a.startsWith('-'));
const mode = arg ?? (process.stdin.isTTY ? 'bridge' : 'mcp');
const wantsOpen = process.argv.includes('--open');
const state = await startBridge();
if (mode === 'bridge') {
  if (!state) { log(`port ${port} is already in use: a bridge is probably running, open http://127.0.0.1:${port}/`); process.exit(1); }
  if (wantsOpen) openBrowser(`http://127.0.0.1:${port}/`);
  log('Leave this window open. Add it to your AI client as an MCP server with:  node ' + (process.argv[1] ?? 'axsquiggle-bridge.mjs') + ' mcp');
} else {
  const hub: Hub = state ? { call: (n, a) => callTool(state, n, a) } : remoteHub();
  if (!state) log(`using the bridge already running on port ${port}`);
  await buildMcp(hub).connect(new StdioServerTransport());
}

/** Open the app in the default browser on Windows, macOS or Linux (best effort). */
function openBrowser(url: string) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0] as string, cmd[1] as string[], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* the address is printed anyway */ }
}
