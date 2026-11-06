// Records the "up and running" demo of axSquiggle: one real bridge, the real app in a real browser.
//
//   npm run dist                      # builds dist/axsquiggle.html and dist/axsquiggle.mjs
//   node scripts/demo/record.mjs      # needs Playwright (npm i -D playwright, or any global install) and ffmpeg
//
// Output goes to docs/video/ (the mp4) and docs/img/ (the GIFs). The AI side is scripted: it makes the same tool
// calls over the bridge's REST endpoint (POST /api/tools/<name>) that an MCP client makes, with the same arguments
// shape, so everything the app shows is what a real AI would cause. Nothing on screen is mocked up.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const here = join(root, 'scripts/demo');
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require('playwright'); } catch { return createRequire(join(process.env.NODE_PATH?.split(':')[0] ?? '/usr/lib/node_modules', 'x.js'))('playwright'); } })();

const PORT = 4799;
const BRIDGE = `http://127.0.0.1:${PORT}`;
const W = 1280, H = 720;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const work = mkdtempSync(join(tmpdir(), 'axsq-demo-'));
const dataDir = join(work, 'data');
mkdirSync(dataDir);

// ---------- the bridge ----------
const bridge = spawn(process.execPath, [join(root, 'dist/axsquiggle.mjs')], { env: { ...process.env, AXSQ_DIR: dataDir, AXSQ_PORT: String(PORT) }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { await fetch(BRIDGE); break; } catch { await sleep(100); } }
const token = readFileSync(join(dataDir, 'token'), 'utf8').trim();
const ai = async (name, args = {}) => {
  const r = await fetch(`${BRIDGE}/api/tools/${name}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${name}: ${JSON.stringify(j)}`);
  return j;
};

process.on('exit', () => bridge.kill());
// ---------- the browser ----------
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: work, size: { width: W, height: H } } });
const t0 = Date.now();
const marks = {};
const mark = (k, edge) => { (marks[k] ??= {})[edge] = (Date.now() - t0) / 1000; };

await ctx.addInitScript(() => {
  const css = `
  .dm-cursor{position:fixed;z-index:99999;width:22px;height:22px;pointer-events:none;left:0;top:0;transition:transform .02s;filter:drop-shadow(0 1px 2px #0006)}
  .dm-ring{position:fixed;z-index:99998;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:3px solid #e8590c;pointer-events:none;opacity:0}
  .dm-ring.go{animation:dmr .45s ease-out}@keyframes dmr{from{opacity:.9;transform:scale(.4)}to{opacity:0;transform:scale(1.5)}}
  .dm-cap{position:fixed;z-index:99990;left:50%;bottom:22px;transform:translateX(-50%);max-width:1000px;background:#2b2118;color:#fff;font:600 21px/1.3 system-ui,sans-serif;padding:11px 22px 12px;border-radius:14px;box-shadow:0 6px 24px #0005;display:flex;gap:14px;align-items:center;transition:opacity .25s}
  .dm-cap i{font-style:normal;background:#e8590c;border-radius:20px;padding:2px 12px;font-size:15px;white-space:nowrap}
  .dm-term{position:fixed;z-index:99980;left:50%;top:50%;transform:translate(-50%,-56%);width:900px;background:#14161a;color:#d7dde8;border-radius:12px;box-shadow:0 0 0 100vmax #0007,0 20px 60px #000a;font:17px/1.55 ui-monospace,Menlo,Consolas,monospace;overflow:hidden}
  .dm-term .bar{background:#262a31;padding:9px 14px;display:flex;gap:8px;align-items:center;color:#8d96a5;font:13px system-ui}.dm-term .bar b{width:12px;height:12px;border-radius:50%;display:inline-block}
  .dm-term pre{margin:0;padding:16px 20px 18px;white-space:pre-wrap;min-height:120px}.dm-term .p{color:#7ee787}.dm-term .d{color:#8d96a5}.dm-term .o{color:#ffa657}
  .dm-chat{position:fixed;z-index:99970;right:14px;top:96px;width:332px;max-height:470px;overflow:hidden;background:#fff;border:2px solid #8250df;border-radius:14px;box-shadow:0 10px 36px #0004;font:15px/1.4 system-ui,sans-serif;color:#1c2430;display:none;flex-direction:column}
  .dm-chat .h{background:#8250df;color:#fff;font-weight:700;padding:8px 14px;display:flex;justify-content:space-between}.dm-chat .h small{font-weight:400;opacity:.85}
  .dm-chat .m{padding:10px 12px;display:flex;flex-direction:column;justify-content:flex-end;gap:8px;height:420px;overflow:hidden}
  .dm-chat .u{align-self:flex-end;background:#eef1f6;border-radius:12px 12px 2px 12px;padding:7px 11px;max-width:90%}
  .dm-chat .a{background:#f3ecff;border-radius:12px 12px 12px 2px;padding:7px 11px;max-width:96%}
  .dm-chat .t{font:13px ui-monospace,Menlo,Consolas,monospace;background:#14161a;color:#7ee787;border-radius:8px;padding:6px 10px;white-space:pre-wrap}
  .dm-chat .t b{color:#ffa657;font-weight:600}
  .dm-title{position:fixed;z-index:99985;inset:0;background:linear-gradient(135deg,#fff6ee,#ffe3cf);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;font-family:system-ui,sans-serif;color:#2b2118;text-align:center;transition:opacity .5s}
  .dm-title h1{font:700 62px/1.1 'Kalam',cursive,system-ui;margin:0;color:#e8590c}.dm-title p{font-size:26px;margin:0}.dm-title code{background:#2b2118;color:#fff;border-radius:8px;padding:4px 12px;font-size:22px}`;
  const boot = () => {
    if (document.getElementById('dm-style')) return;
    const st = document.createElement('style'); st.id = 'dm-style'; st.textContent = css; document.head.append(st);
    const cur = document.createElement('div'); cur.className = 'dm-cursor';
    cur.innerHTML = '<svg viewBox="0 0 22 22" width="22" height="22"><path d="M3 2l14 8-6 1.6L8.5 18z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const ring = document.createElement('div'); ring.className = 'dm-ring';
    document.body.append(cur, ring);
    addEventListener('mousemove', (e) => { cur.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`; ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { ring.classList.remove('go'); void ring.offsetWidth; ring.classList.add('go'); }, true);
  };
  addEventListener('DOMContentLoaded', boot);
  const q = (c) => document.querySelector('.' + c);
  const mk = (c, html) => { let e = q(c); if (!e) { e = document.createElement('div'); e.className = c; document.body.append(e); } if (html !== undefined) e.innerHTML = html; return e; };
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  window.dm = {
    cap(step, text) { if (!text) { q('dm-cap')?.remove(); return; } mk('dm-cap', `<i>${step}</i><span>${esc(text)}</span>`); },
    title(h, p, code) { mk('dm-title', `<h1>${esc(h)}</h1><p>${esc(p)}</p>${code ? `<code>${esc(code)}</code>` : ''}`).style.opacity = 1; },
    untitle() { const e = q('dm-title'); if (e) { e.style.opacity = 0; setTimeout(() => e.remove(), 520); } },
    term(html) { if (html === null) { q('dm-term')?.remove(); return; } const e = mk('dm-term', `<div class="bar"><b style="background:#ff5f57"></b><b style="background:#febc2e"></b><b style="background:#28c840"></b>&nbsp;terminal</div><pre></pre>`); e.querySelector('pre').innerHTML = html; },
    chat(on) { const e = mk('dm-chat'); if (!e.firstChild) e.innerHTML = '<div class="h">Your AI client <small>talking to axSquiggle over MCP</small></div><div class="m"></div>'; e.style.display = on ? 'flex' : 'none'; },
    say(html) { mk('dm-chat').querySelector('.m').insertAdjacentHTML('beforeend', html); },
    clearChat() { const m = q('dm-chat')?.querySelector('.m'); if (m) m.innerHTML = ''; },
  };
});

const page = await ctx.newPage();
const dm = (fn, ...a) => page.evaluate(([f, args]) => window.dm[f](...args), [fn, a]);
let mx = 640, my = 360;
const move = async (x, y, steps = 28) => {
  const sx = mx, sy = my;
  for (let i = 1; i <= steps; i++) { const t = i / steps, e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; await page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e); await sleep(14); }
  mx = x; my = y;
};
const clickAt = async (x, y) => { await move(x, y); await sleep(120); await page.mouse.down(); await sleep(60); await page.mouse.up(); await sleep(250); };
const clickSel = async (sel) => { const b = await page.locator(sel).first().boundingBox(); await clickAt(b.x + b.width / 2, b.y + b.height / 2); };
const typeSlow = async (text, delay = 38) => { await page.keyboard.type(text, { delay }); };
const termType = async (prompt, cmd, out) => {
  const pre = (h) => dm('term', h);
  let shown = '';
  for (const ch of cmd) { shown += ch; await pre(`<span class="p">$</span> ${shown.replace(/</g, '&lt;')}▌`); await sleep(34); }
  await sleep(350);
  await pre(`<span class="p">$</span> ${cmd.replace(/</g, '&lt;')}\n${out}`);
};
const toolLine = (name, args) => `<span>→ </span><b>${name}</b>${args ? ' ' + args : ''}`;
const aiCall = async (name, args, summary, label) => {
  await dm('say', `<div class="t">${toolLine(name, label)}</div>`);
  await sleep(700);
  const r = await ai(name, args);
  const sum = typeof summary === 'function' ? summary(r) : summary;
  if (sum) await dm('say', `<div class="t" style="color:#d7dde8">${sum}</div>`);
  return r;
};

// ---------- scene 0: title ----------
await page.goto(pathToFileURL(join(root, 'dist/axsquiggle.html')).href);
await page.waitForSelector('#bAi');
await dm('title', 'axSquiggle', 'Sketch it. Your AI builds it. Up and running in 5 minutes.', 'node axsquiggle.mjs');
await sleep(2600);
await dm('untitle'); await sleep(600);

// ---------- scene 1: run it, connect the AI client ----------
mark('connect', 'in');
await dm('cap', 'Step 1', 'Run the bridge: one file, Node 18+, no npm install');
await termType('', 'node axsquiggle.mjs',
  `<span class="d">[axsquiggle]</span> bridge running on <span class="o">http://127.0.0.1:4747</span>\n<span class="d">[axsquiggle]</span> OPEN THE APP: http://127.0.0.1:4747/\n<span class="d">[axsquiggle]</span> token saved in ~/.axsquiggle/token`);
await sleep(2200);
await dm('cap', 'Step 2', 'Add it to your AI client as an MCP server');
await termType('', 'claude mcp add axsquiggle -- node axsquiggle.mjs', `<span class="d">Added stdio MCP server axsquiggle to local config</span>\n<span class="d">Your AI can now call draft_board, get_review, edit_frame, resolve_notes ...</span>`);
await sleep(2600);
await dm('term', null);
await sleep(300);
await clickSel('button:has-text("Start fresh")'); await sleep(500);
await dm('cap', 'Step 3', 'In the app, press MCP, paste the bridge address and token, Connect');
await clickSel('#bAi');
await page.waitForSelector('#dBridge[open]');
await sleep(500);
await clickSel('#brUrl'); await page.fill('#brUrl', ''); await typeSlow(BRIDGE, 24);
await clickSel('#brTok'); await page.fill('#brTok', token);
await sleep(300);
await clickSel('#brGo');
await page.waitForFunction(() => /connected/i.test(document.querySelector('#brStatus')?.textContent ?? '') || /connected/i.test(document.querySelector('#bAi')?.className ?? ''), null, { timeout: 8000 }).catch(() => {});
await sleep(1800);
await page.keyboard.press('Escape'); await sleep(500);
mark('connect', 'out');

// ---------- scene 2: screenshot in, AI replicates ----------
mark('replicate', 'in');
await dm('cap', 'Step 4', 'Drop in a screenshot of a screen you already have');
await clickSel('#bShot');
await page.setInputFiles('#fileIn', join(here, 'source-screen.png'));
await sleep(2400);
await dm('cap', 'Step 5', 'Ask your AI to replicate it in axSquiggle');
await dm('chat', true);
await dm('say', `<div class="u">Replicate the screenshot on frame 1 as a wireframe.</div>`);
await sleep(1500);
await aiCall('get_review', {}, (r) => `review packet + ${r.images.length} image attached (the screenshot)`, '');
await sleep(900);
await dm('say', `<div class="a">That's a profile settings page: header with nav, a menu, and a form. Building it.</div>`);
await sleep(1300);
const outline = `header Acme Pay | text Dashboard | text Payments | text Settings
columns 1:3
  card Menu
    list Profile
    list Security
    list Notifications
    list Billing
  card Profile settings
    avatar
    button Change photo
    input Full name "Jordan Lee"
    input Email "jordan@acme.example"
    text Notifications
    checkbox Email me about payments
    checkbox Weekly summary
    button Save changes | button Cancel`;
await aiCall('edit_frame', { frame: 1, caption: 'Profile settings', outline, mode: 'replace' }, 'Updated.', 'frame:1 mode:replace');
await sleep(2200);
await dm('chat', false);
await page.locator('#bShotX').click().catch(() => {}); // hide the screenshot so the wireframe stands on its own
await sleep(1800);
mark('replicate', 'out');

// ---------- scene 3: the person edits and leaves a note ----------
mark('review', 'in');
await dm('cap', 'Step 6', 'Make a few changes yourself: add a field in the outline');
const addBox = page.locator('textarea[aria-label="Add elements"]');
await clickSel('textarea[aria-label="Add elements"]');
await typeSlow('input Phone "+1 555 0100"', 45);
await page.keyboard.press('Enter');
await sleep(1500);
await dm('cap', 'Step 7', 'Switch to Review, tap what bothers you, write the note');
await clickAt(1100, 300); // leave the outline box
await clickSel('button:has-text("Review")'); await sleep(900);

// tap the "Save changes" button on the canvas (frame coordinates -> screen)
const frame = JSON.parse((await ai('get_board', { format: 'json' })).text).frames[0];
const label = frame.shapes.find((e) => e.k === 'text' && e.s === 'Save changes');
const btn = frame.shapes.find((e) => e.id === label.of);
const cv = await page.locator('#cv').boundingBox();
const k = cv.width / 960;
await clickAt(cv.x + (btn.x + btn.w / 2) * k, cv.y + (btn.y + btn.h / 2) * k);
await sleep(500);
await clickSel('#change');
await typeSlow('Rename "Save changes" to "Update profile", and mark Phone as optional.', 42);
await sleep(500);
await clickSel('#bNote');
await sleep(1800);
mark('review', 'mid');

// ---------- scene 4: send it back ----------
await dm('cap', 'Step 8', 'Tell your AI you left notes. It reads them and acts');
await dm('chat', true);
await dm('say', `<div class="u">I've left a note on the board. Please action it.</div>`);
await sleep(1600);
const rev = await aiCall('get_review', {}, (r) => `${/Open review notes: (\d+)/.exec(r.text)?.[1]} open note(s) + what you changed + the board`, '');
await sleep(1200);
await dm('say', `<div class="a">Got it: rename the button and mark Phone optional.</div>`);
await sleep(1300);
await aiCall('edit_element', { frame: 1, label: 'Save changes', set_label: 'Update profile' }, 'Updated Button "Update profile"', 'frame:1 label:"Save changes"');
await sleep(1500);
await aiCall('edit_element', { frame: 1, label: 'Phone', set_label: 'Phone (optional)' }, 'Updated Input "Phone (optional)"', 'frame:1 label:"Phone"');
await sleep(1500);
const board = JSON.parse((await ai('get_board', { format: 'json' })).text).frames[0];
await aiCall('resolve_notes', { ids: board.notes.map((n) => n.id), reply: 'Renamed to "Update profile"; Phone is now marked optional.' }, '1 note resolved', 'ids:[1]');
await sleep(1200);
await dm('say', `<div class="a">Done. Your note is resolved, and the changes arrived in the app as one undoable edit.</div>`);
await sleep(3200);
await dm('chat', false);
mark('review', 'out');
await dm('cap', 'Done', 'Download axsquiggle.html or axsquiggle.mjs from the README and try it');
await sleep(2800);

// ---------- encode ----------
await ctx.close();
const webm = join(work, readdirSync(work).find((f) => f.endsWith('.webm')));
const outDir = join(root, 'docs/video'); mkdirSync(outDir, { recursive: true });
const img = join(root, 'docs/img');
const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
ff(['-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-preset', 'slow', '-movflags', '+faststart', '-an', join(outDir, 'axsquiggle-in-5-minutes.mp4')]);
const gif = (name, a, b, width = 760, fps = 10) => {
  const pal = join(work, `${name}.png`);
  const common = ['-ss', String(a), '-t', String(b - a), '-i', webm];
  const vf = `fps=${fps},scale=${width}:-1:flags=lanczos`;
  ff([...common, '-vf', `${vf},palettegen=max_colors=96:stats_mode=diff`, pal]);
  ff([...common, '-i', pal, '-lavfi', `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, join(img, `${name}.gif`)]);
};
gif('demo-connect', marks.connect.in, marks.connect.out);
gif('demo-replicate', marks.replicate.in, marks.replicate.out);
gif('demo-review', marks.review.in, marks.review.out);
ff(['-ss', '3.2', '-i', webm, '-frames:v', '1', join(img, 'demo-poster.png')]);
console.log(JSON.stringify(marks));
bridge.kill(); await browser.close();
rmSync(work, { recursive: true, force: true });
process.exit(0);
