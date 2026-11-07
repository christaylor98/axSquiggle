// Records "Get the most out of axSquiggle": one video, a chapter per mode, driving the real app in a real browser.
//
//   npm run dist                          # builds dist/axsquiggle.mjs
//   node scripts/demo/modes.mjs           # needs Playwright (with its chromium + ffmpeg) and ffmpeg
//   SCENES=draw,flow node scripts/demo/modes.mjs --shots   # just those chapters, a screenshot after each, no video
//
// Voice-over: GEMINI_API_KEY=... (see voice.mjs; NO_VO=1 records silent). The words are in NARRATION below.
// Output: docs/video/axsquiggle-modes.mp4 (with chapter markers) and docs/video/axsquiggle-modes.chapters.json.
// The AI part is scripted the same way as record.mjs: real tool calls over the bridge's POST /api/tools/<name>.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeVoice, mixArgs } from './voice.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const here = join(root, 'scripts/demo');
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require('playwright'); } catch { return createRequire(join(process.env.NODE_PATH?.split(':')[0] ?? '/usr/lib/node_modules', 'x.js'))('playwright'); } })();

const SHOTS = process.argv.includes('--shots');
const ONLY = process.env.SCENES ? process.env.SCENES.split(',') : null;
const PORT = Number(process.env.DEMO_PORT ?? 4747); // DEMO_PORT if your own bridge already has 4747
const BRIDGE = `http://127.0.0.1:${PORT}`;
const W = 1280, H = 720;
const sleep = (ms) => new Promise((r) => setTimeout(r, SHOTS ? Math.min(ms, 150) : ms));
const work = mkdtempSync(join(tmpdir(), 'axsq-modes-'));
const dataDir = join(work, 'data');
mkdirSync(dataDir);

// ---------- the voice-over: one line per caption, said while it happens ----------
const NARRATION = {
  intro: "Hi! This is a tour of everything axSquiggle can do. Every mode gets its own chapter, so feel free to skip straight to the one you need.",
  draw: "Let's start with Draw, the mode you're in by default. Draw roughly, and each stroke is cleaned up the moment you let go.",
  'draw.box': "A rough box becomes a nice clean box.",
  'draw.avatar': "A small circle near the top turns into an avatar.",
  'draw.input': "A wide, short box is an input field.",
  'draw.button': "And a small box becomes a button, as soon as it has a word in it.",
  'draw.para': "Scribble back and forth, and you get a paragraph.",
  'draw.image': "A line from corner to corner across a box makes it an image placeholder.",
  'draw.arrow': "Finish a line with a little hook, and it's an arrow, that sticks to whatever it touches.",
  'draw.delete': "Changed your mind? Just scribble over a shape to delete it.",
  'draw.rough': "And if you press Escape right after a stroke, it stays rough, exactly as you drew it.",
  flow: "Flow mode, on F, lets you draw and type without switching tools.",
  'flow.button': "Tap inside a box and type, and now it's a button.",
  'flow.label': "Tap just above a field and type, and that's its label.",
  'flow.keep': "Keep drawing in the same tool, then tap and type again.",
  sketch: "Sketch mode, on S, keeps your strokes exactly as you drew them. It's great for notes, doodles and rough ideas.",
  'sketch.raw': "Nothing gets cleaned up here.",
  'sketch.arrow': "A hook at the end still gives you an arrow, just a hand-drawn one.",
  text: "Text mode, on T, is for headings, notes and labels, right where you want them.",
  'text.tap': "Just tap anywhere, and start typing.",
  'text.updown': "Tap a box, and the up and down arrows move its label: above, top, middle, bottom, or under.",
  'text.lr': "Left and right line it up left, centre or right.",
  stamps: "Stamps are ready-made parts. Type a slash and a name, and it drops right in.",
  'stamps.tabs': "Tap a spot, and type slash tabs, then the labels.",
  'stamps.radio': "Radio buttons work the same way, with the question first.",
  'stamps.more': "There are dropdowns, buttons, search fields, and plenty more.",
  outline: "Outline lets you type a whole screen, one line per element. It's the same screen, just written as text.",
  'outline.lines': "Every line is one element, and indenting a line puts it inside a card.",
  'outline.rename': "Rename anything in the outline, and the screen follows along.",
  select: "Select mode, on V, is for moving, resizing and tidying up. Everything snaps to a twenty pixel grid.",
  'select.drag': "Drag something to move it, and it snaps into place.",
  'select.nudge': "The arrow keys nudge it a step at a time.",
  'select.grid': "G turns the grid and snapping off, and back on again.",
  'select.roles': "And O shows you what each element actually is.",
  erase: "Erase, on E, rubs things out.",
  'erase.drag': "Drag over anything to remove it. One drag is one undo.",
  'erase.undo': "Escape undoes, and Shift Escape redoes.",
  frames: "Each frame is a screen. Link them together, and you can click through them like a real app.",
  'frames.strip': "The strip along the bottom is your storyboard. The number keys, one to nine, jump straight to a frame.",
  'frames.link': "Select a button, press Space, then L, and pick the frame it should open.",
  'frames.play': "Press I to play it. Click the link, and you're on that screen.",
  'frames.phone': "And M switches a frame between desktop and phone.",
  image: "Got something that already exists? Start from a screenshot, with P.",
  'image.drop': "Drop, paste or pick a screenshot. It goes on a new frame, behind the canvas.",
  'image.draw': "Then draw over it. The screenshot stays faint, so your wireframe stays clean.",
  'image.hide': "Hide the screenshot when you're done, or let your AI rebuild the screen for you.",
  find: "Control F searches every frame: captions, labels and notes.",
  review: "Review mode, on R, is for leaving notes right on the screen. Your AI reads them, makes the change, and replies.",
  'review.note': "Tap the thing you mean, write your note, and hit Add note.",
  'review.ask': "Then just ask your AI to deal with it.",
  'review.done': "It reads the note, makes Team the most popular plan, and replies right there on your note.",
  preview: "Preview shows your sketch as a real interface, and Export takes it anywhere.",
  'preview.open': "Shift V draws every frame as a real UI.",
  'preview.style': "Press S to switch the style: clean, material, dark, brand, and minimal.",
  'preview.export': "W opens Export: PNG, SVG, Markdown for the spec, a clickable prototype, Figma, Excalidraw, and more.",
  keys: "Last one, and it's the only key you really need to remember. Press Space to see every shortcut, stamp and part, and search them.",
  outro: "That's axSquiggle. Sketch it, and your AI builds it. Get it at squiggle dot axstack dot dev.",
};
const voice = await makeVoice({ root, lines: NARRATION, now: () => (Date.now() - t0) / 1000, sleep, off: SHOTS || !!process.env.NO_VO });
const vo = voice.say;

// ---------- the bridge ----------
const bridge = spawn(process.execPath, [join(root, 'dist/axsquiggle.mjs'), 'bridge', '--no-open'], { env: { ...process.env, AXSQ_DIR: dataDir, AXSQ_PORT: String(PORT) }, stdio: 'ignore' });
process.on('exit', () => bridge.kill());
for (let i = 0; i < 50; i++) { try { await fetch(BRIDGE); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
const token = readFileSync(join(dataDir, 'token'), 'utf8').trim();
const ai = async (name, args = {}) => {
  const r = await fetch(`${BRIDGE}/api/tools/${name}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${name}: ${JSON.stringify(j)}`);
  return j;
};

// ---------- the browser, with the recorder's overlay (captions, cursor, chapter cards, chat) ----------
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, ...(SHOTS ? {} : { recordVideo: { dir: work, size: { width: W, height: H } } }) });
let t0 = Date.now(); // reset when the page opens: that is when the video starts
const chapters = [];

await ctx.addInitScript(() => {
  const css = `
  .dm-cursor{position:fixed;z-index:99999;width:22px;height:22px;pointer-events:none;left:0;top:0;filter:drop-shadow(0 1px 2px #0006)}
  .dm-ring{position:fixed;z-index:99998;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:3px solid #e8590c;pointer-events:none;opacity:0}
  .dm-ring.go{animation:dmr .45s ease-out}@keyframes dmr{from{opacity:.9;transform:scale(.4)}to{opacity:0;transform:scale(1.5)}}
  .dm-cap{position:fixed;z-index:99990;left:50%;bottom:22px;transform:translateX(-50%);max-width:1040px;background:#2b2118;color:#fff;font:600 21px/1.3 system-ui,sans-serif;padding:11px 22px 12px;border-radius:14px;box-shadow:0 6px 24px #0005;display:flex;gap:14px;align-items:center}
  .dm-cap i{font-style:normal;background:#e8590c;border-radius:20px;padding:2px 12px;font-size:15px;white-space:nowrap}
  .dm-cap kbd{font:700 17px ui-monospace,Menlo,Consolas,monospace;background:#fff;color:#2b2118;border-radius:6px;padding:1px 8px;margin:0 2px}
  .dm-keys{position:fixed;z-index:99991;right:22px;top:110px;display:flex;gap:6px}
  .dm-keys kbd{font:700 26px ui-monospace,Menlo,Consolas,monospace;background:#2b2118;color:#fff;border-radius:10px;padding:6px 14px;box-shadow:0 4px 0 #e8590c;animation:kin .15s ease-out}
  @keyframes kin{from{transform:translateY(-6px);opacity:0}}
  .dm-chat{position:fixed;z-index:99970;right:14px;top:96px;width:332px;max-height:470px;overflow:hidden;background:#fff;border:2px solid #8250df;border-radius:14px;box-shadow:0 10px 36px #0004;font:15px/1.4 system-ui,sans-serif;color:#1c2430;display:none;flex-direction:column}
  .dm-chat .h{background:#8250df;color:#fff;font-weight:700;padding:8px 14px;display:flex;justify-content:space-between}.dm-chat .h small{font-weight:400;opacity:.85}
  .dm-chat .m{padding:10px 12px;display:flex;flex-direction:column;justify-content:flex-end;gap:8px;height:420px;overflow:hidden}
  .dm-chat .u{align-self:flex-end;background:#eef1f6;border-radius:12px 12px 2px 12px;padding:7px 11px;max-width:90%}
  .dm-chat .a{background:#f3ecff;border-radius:12px 12px 12px 2px;padding:7px 11px;max-width:96%}
  .dm-chat .t{font:13px ui-monospace,Menlo,Consolas,monospace;background:#14161a;color:#7ee787;border-radius:8px;padding:6px 10px;white-space:pre-wrap}
  .dm-chat .t b{color:#ffa657;font-weight:600}
  .dm-title{position:fixed;z-index:99985;inset:0;background:linear-gradient(135deg,#fff4e8,#ffd9bd);display:flex;flex-direction:column;align-items:flex-start;justify-content:center;padding:0 120px;gap:10px;font-family:system-ui,sans-serif;color:#2b2118;transition:opacity .4s}
  .dm-title .n{font:700 28px/1 'Kalam',cursive,system-ui;color:#e8590c}
  .dm-title h1{font:800 76px/1.02 system-ui,sans-serif;letter-spacing:-.03em;margin:0}
  .dm-title p{font-size:27px;margin:6px 0 0;color:#5b4636;max-width:900px}
  .dm-title svg{margin-top:6px}
  .dm-title kbd{font:700 22px ui-monospace,Menlo,Consolas,monospace;background:#2b2118;color:#fff;border-radius:7px;padding:2px 9px}`;
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
  // captions take `key` markup for keys: "Press `S` for Sketch"
  const keys = (s) => esc(s).replace(/`([^`]+)`/g, '<kbd>$1</kbd>');
  window.dm = {
    cap(step, text) { if (!text) { q('dm-cap')?.remove(); return; } mk('dm-cap', `<i>${esc(step)}</i><span>${keys(text)}</span>`); },
    keys(list) { if (!list) { q('dm-keys')?.remove(); return; } mk('dm-keys', list.map((k) => `<kbd>${esc(k)}</kbd>`).join('')); },
    title(n, h, p) {
      const squig = '<svg width="420" height="26" viewBox="0 0 420 26"><path d="M4 16 C60 2 110 26 170 12 S290 2 340 16 S400 22 416 8" fill="none" stroke="#e8590c" stroke-width="7" stroke-linecap="round"/></svg>';
      mk('dm-title', `${n ? `<div class="n">${esc(n)}</div>` : ''}<h1>${esc(h)}</h1>${squig}${p ? `<p>${keys(p)}</p>` : ''}`).style.opacity = 1;
    },
    untitle() { const e = q('dm-title'); if (e) { e.style.opacity = 0; setTimeout(() => e.remove(), 420); } },
    chat(on) { const e = mk('dm-chat'); if (!e.firstChild) e.innerHTML = '<div class="h">Your AI client <small>talking to axSquiggle over MCP</small></div><div class="m"></div>'; e.style.display = on ? 'flex' : 'none'; },
    say(html) { mk('dm-chat').querySelector('.m').insertAdjacentHTML('beforeend', html); },
    clearChat() { const m = q('dm-chat')?.querySelector('.m'); if (m) m.innerHTML = ''; },
  };
});

const page = await ctx.newPage();
t0 = Date.now();
const dm = (fn, ...a) => page.evaluate(([f, args]) => window.dm[f](...args), [fn, a]);

// ---------- pointer, keys and frame coordinates ----------
let mx = 640, my = 360;
const move = async (x, y, steps = 24) => {
  const sx = mx, sy = my;
  for (let i = 1; i <= steps; i++) { const t = i / steps, e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; await page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e); if (!SHOTS) await sleep(12); }
  mx = x; my = y;
};
const clickAt = async (x, y) => { await move(x, y); await sleep(120); await page.mouse.down(); await sleep(60); await page.mouse.up(); await sleep(250); };
const clickSel = async (sel) => { const b = await page.locator(sel).first().boundingBox(); await clickAt(b.x + b.width / 2, b.y + b.height / 2); };
const typeSlow = async (text, delay = 40) => { await page.keyboard.type(text, { delay: SHOTS ? 0 : delay }); };
// a key press shown big on screen, so viewers see what was pressed
const key = async (k, label = k) => { await page.evaluate(() => document.activeElement?.blur()); await dm('keys', [label]); await sleep(350); await page.keyboard.press(k); await sleep(650); await dm('keys', null); };

// frame coordinates (960 wide, desktop) -> screen
let cv;
const fit = async () => { cv = await page.locator('#cv').boundingBox(); };
const fx = (x, y) => { const k = cv.width / 960; return [cv.x + x * k, cv.y + y * k]; };
// seeded wobble, so every recording draws the same "hand-drawn" strokes
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - .5; };
// draw through frame points, at a hand-drawing pace
const stroke = async (pts, { pace = 9 } = {}) => {
  const s = pts.map(([x, y]) => fx(x, y));
  await move(s[0][0], s[0][1]); await sleep(150);
  await page.mouse.down();
  for (const [x, y] of s.slice(1)) { await page.mouse.move(x, y); if (!SHOTS) await sleep(pace); }
  await page.mouse.up(); mx = s.at(-1)[0]; my = s.at(-1)[1];
  await sleep(500);
};
const seg = (a, b, n = 14, wob = 3) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n; return [a[0] + (b[0] - a[0]) * t + rnd() * wob, a[1] + (b[1] - a[1]) * t + rnd() * wob]; });
const roughBox = (x, y, w, h) => [...seg([x, y], [x + w, y]), ...seg([x + w, y], [x + w, y + h]), ...seg([x + w, y + h], [x, y + h]), ...seg([x, y + h], [x + 2, y - 2])];
const roughCircle = (cx, cy, r) => Array.from({ length: 30 }, (_, i) => { const a = -Math.PI / 2 + i / 28 * Math.PI * 2; return [cx + Math.cos(a) * r + rnd() * 3, cy + Math.sin(a) * r + rnd() * 3]; });
const scribble = (x, y, w, rows = 5, gap = 9) => { const p = []; for (let i = 0; i < rows; i++) { p.push([x + rnd() * 4, y + i * gap]); p.push([x + w + rnd() * 4, y + i * gap + 4]); } return p; };
const blur = () => page.evaluate(() => document.activeElement?.blur());
// letters are shortcuts only with nothing selected (selected box + letters = typing its label); Esc deselects, but
// with nothing selected Esc is undo, so press it only when something is selected
const calm = async () => { await blur(); if (/deselect/.test(await page.locator('#keybar').innerText())) { await page.keyboard.press('Escape'); await sleep(200); } };
// switch tools with the toolbar button (shown with its key): clicking never types into a selected box the way a letter would
const tool = async (name, k) => { await blur(); await dm('keys', [k.toUpperCase()]); await clickSel(`[data-tool=${name}]`); await page.waitForSelector(`[data-tool=${name}].on`); await sleep(300); await dm('keys', null); };
const button = async (sel, label) => { await dm('keys', [label]); await clickSel(sel); await sleep(300); await dm('keys', null); };

// where an element is on screen: by its label (the text it owns) or its role, from the bridge's view of the board
const where = async (n, label) => {
  await fit();
  const f = JSON.parse((await ai('get_board', { format: 'json' })).text).frames[n - 1];
  const t = f.shapes.find((e) => e.k === 'text' && e.s && e.s.includes(label));
  const e = t ? (f.shapes.find((o) => o.id === t.of) ?? t) : f.shapes.find((o) => o.role === label);
  if (!e) throw new Error(`no "${label}" on frame ${n}`);
  const fw = f.device === 'phone' ? 390 : 960, k = cv.width / fw;
  return [cv.x + (e.x + e.w / 2) * k, cv.y + (e.y + e.h / 2) * k, e.w / 2 * k, e.h / 2 * k];
};
const tapAt = async (x, y) => { const [sx, sy] = fx(x, y); await clickAt(sx, sy); };
const write = async (x, y, text) => { await tapAt(x, y); await page.waitForSelector('#inl', { state: 'visible', timeout: 4000 }).catch(async (e) => { await page.screenshot({ path: join(process.env.SHOT_DIR ?? work, 'FAIL.png') }); throw e; }); await typeSlow(text); await sleep(300); await page.keyboard.press('Enter'); await sleep(700); };

// ---------- scenes ----------
const chapter = async (id, n, title, sub) => {
  await voice.done();
  chapters.push({ id, title, start: (Date.now() - t0) / 1000 });
  await dm('cap', ''); await dm('title', n, title, sub); await vo(id); await sleep(2600); await voice.done(); await dm('untitle'); await sleep(500);
};
const shot = async (id) => { if (SHOTS) await page.screenshot({ path: join(process.env.SHOT_DIR ?? work, `${id}.png`) }); };
const newFrame = async () => { await blur(); await clickSel('#bAdd'); await sleep(500); await fit(); };

const scenes = {
  async draw() {
    await chapter('draw', 'Chapter 1', 'Draw', 'Draw roughly. Each stroke is cleaned up the moment you let go.');
    await fit();
    await vo('draw.box');
    await dm('cap', 'Draw', 'A rough box becomes a clean box');
    await stroke(roughBox(60, 120, 260, 320));
    await sleep(900);
    await vo('draw.avatar');
    await dm('cap', 'Draw', 'A small circle near the top becomes an avatar');
    await stroke(roughCircle(480, 60, 30));
    await sleep(700);
    await vo('draw.input');
    await dm('cap', 'Draw', 'A wide, short box is an input field');
    await stroke(roughBox(360, 160, 300, 44));
    await vo('draw.button');
    await dm('cap', 'Draw', 'A small box is a button once it has a word in it');
    await stroke(roughBox(440, 260, 140, 44));
    await sleep(500);
    await vo('draw.para');
    await dm('cap', 'Draw', 'Scribble back and forth: a paragraph');
    await stroke(scribble(380, 340, 260), { pace: 14 });
    await sleep(700);
    await vo('draw.image');
    await dm('cap', 'Draw', 'A line corner to corner across a box: an image placeholder');
    await stroke(seg([70, 130], [310, 430], 18, 2));
    await sleep(900);
    await vo('draw.arrow');
    await dm('cap', 'Draw', 'Finish any line with a little hook: an arrow that sticks to what it touches');
    await stroke(roughBox(720, 120, 200, 240));
    await stroke([...seg([590, 282], [700, 278], 12, 4), [690, 268], [684, 262]]);
    await sleep(1000);
    await vo('draw.delete');
    await dm('cap', 'Draw', 'Changed your mind? Scribble over a shape to delete it');
    await stroke(seg([400, 500], [600, 520], 10, 2));
    await sleep(500);
    await stroke(scribble(390, 490, 220, 6, 7), { pace: 12 });
    await sleep(900);
    await vo('draw.rough');
    await dm('cap', 'Draw', '`Esc` right after a stroke keeps it rough');
    await stroke([[740, 500], [770, 470], [800, 520], [830, 470], [860, 515], [880, 480]]);
    await sleep(500);
    await key('Escape', 'Esc');
    await sleep(1400);
    await shot('draw');
  },

  async flow() {
    await chapter('flow', 'Chapter 2', 'Flow', 'Draw and type without switching tools. `F`');
    await tool('flow', 'f');
    await vo('flow.button');
    await dm('cap', 'Flow', 'Tap inside a box and type: it becomes a button');
    await write(470, 272, 'Sign in');
    await vo('flow.label');
    await dm('cap', 'Flow', 'Tap above a field and type: that is its label');
    await write(362, 128, 'Email');
    await write(748, 160, 'Welcome back');
    await vo('flow.keep');
    await dm('cap', 'Flow', 'Keep drawing in the same tool, then tap and type again');
    await stroke(roughBox(740, 300, 160, 40));
    await write(760, 314, 'Create account');
    await sleep(1200);
    await shot('flow');
  },

  async sketch() {
    await chapter('sketch', 'Chapter 3', 'Sketch', 'Keep strokes exactly as drawn: notes, doodles, rough ideas. `S`');
    await tool('sketch', 's');
    await vo('sketch.raw');
    await dm('cap', 'Sketch', 'Nothing is cleaned up in Sketch mode');
    await stroke([[110, 520], [125, 480], [140, 520], [100, 495], [150, 495], [110, 520]], { pace: 22 });
    await stroke(seg([170, 510], [300, 500], 10, 6), { pace: 16 });
    await vo('sketch.arrow');
    await dm('cap', 'Sketch', 'A hook at the end still gives you an arrow, hand-drawn');
    await stroke([...seg([310, 520], [440, 470], 12, 8), [428, 466], [424, 476]], { pace: 16 });
    await sleep(1000);
    await tool('draw', 'd');
    await shot('sketch');
  },

  async text() {
    await chapter('text', 'Chapter 4', 'Text', 'Headings, notes and labels exactly where you want them. `T`');
    await tool('text', 't');
    await vo('text.tap');
    await dm('cap', 'Text', 'Tap anywhere and type');
    await write(60, 40, 'Welcome to Acme');
    await vo('text.updown');
    await dm('cap', 'Text', 'Tap a box, then `↑` `↓` move its label: above, top, middle, bottom, under');
    const [cx, cy] = await where(1, 'Welcome back');
    await clickAt(cx, cy + 60);
    await key('ArrowUp', '↑');
    await vo('text.lr');
    await dm('cap', 'Text', '`←` `→` set it left, centre or right');
    await key('ArrowRight', '→');
    await sleep(800);
    await page.keyboard.press('Escape'); await sleep(400);
    await shot('text');
  },

  async stamps() {
    await chapter('stamps', 'Chapter 5', 'Stamps', 'Type a slash and a name to drop in a ready-made part. `/`');
    await newFrame();
    await tool('flow', 'f');
    await vo('stamps.tabs');
    await dm('cap', 'Stamps', 'Tap a spot and type `/tabs`, then the labels');
    await write(60, 50, '/tabs Day, Week, Month');
    await vo('stamps.radio');
    await dm('cap', 'Stamps', 'Radio buttons, with the question first');
    await write(60, 140, '/radio Contact by: Email, SMS, Phone');
    await vo('stamps.more');
    await dm('cap', 'Stamps', 'Dropdowns, buttons, search fields...');
    await write(60, 330, '/dropdown Country "Pick one"');
    await write(60, 430, '/btn Save, Cancel');
    await write(520, 50, '/search Find a customer');
    await sleep(1200);
    await shot('stamps');
  },

  async outline() {
    await chapter('outline', 'Chapter 6', 'Outline', 'Type a whole screen, one line per element. It is the same screen as text.');
    await newFrame();
    await vo('outline.lines');
    await dm('cap', 'Outline', 'One line = one element; indent to put things inside a card');
    await clickSel('textarea[aria-label="Add elements"]');
    const lines = ['header Acme | text Pricing | text Docs', 'columns 1:1', '  card Starter', '    text Free for one person', '    button Choose Starter', '  card Team', '    text $12 a person a month', '    button Choose Team'];
    for (const [i, l] of lines.entries()) { await typeSlow(l, 28); if (i < lines.length - 1) await page.keyboard.press('Shift+Enter'); }
    await sleep(500); await page.keyboard.press('Enter'); await sleep(1500);
    await vo('outline.rename');
    await dm('cap', 'Outline', 'Rename anything in the outline and the screen follows');
    const inputs = page.locator('#pOutline .rows input');
    const idx = await inputs.evaluateAll((els) => els.findIndex((e) => e.value === 'Choose Team'));
    const row = inputs.nth(idx);
    await row.scrollIntoViewIfNeeded();
    const rb = await row.boundingBox();
    await clickAt(rb.x + rb.width - 20, rb.y + rb.height / 2);
    await page.keyboard.press('Control+a'); await typeSlow('Start free trial'); await page.keyboard.press('Enter');
    await sleep(1500);
    await blur();
    await shot('outline');
  },

  async select() {
    await chapter('select', 'Chapter 7', 'Select, Grid and Roles', 'Move, resize and tidy up. Everything snaps to a 20px grid. `V`');
    await calm(); await key('1'); await fit();
    await tool('select', 'v');
    await vo('select.drag');
    await dm('cap', 'Select', 'Drag to move: it snaps to the grid');
    const [bx, by, hw] = await where(1, 'Sign in');
    const gx = bx - hw + 6; // the box's edge, not the words in it (those move on their own)
    await move(gx, by); await page.mouse.down(); await move(gx - 80, by, 30); await page.mouse.up(); await sleep(700);
    await vo('select.nudge');
    await dm('cap', 'Select', 'Arrow keys nudge the selection');
    await key('ArrowRight', '→'); await key('ArrowRight', '→');
    await calm();
    await vo('select.grid');
    await dm('cap', 'Grid', '`G` turns the grid and snapping off and on');
    await button('#tGrid', 'G'); await sleep(900); await button('#tGrid', 'G');
    await vo('select.roles');
    await dm('cap', 'Roles', '`O` shows or hides what each element is');
    await button('#tRoles', 'O'); await sleep(1100); await button('#tRoles', 'O');
    await page.keyboard.press('Escape'); await sleep(400);
    await shot('select');
  },

  async erase() {
    await chapter('erase', 'Chapter 8', 'Erase', 'Rub things out. `E`');
    await tool('erase', 'e');
    await vo('erase.drag');
    await dm('cap', 'Erase', 'Drag over anything to remove it. One drag is one undo');
    await stroke(scribble(380, 330, 260, 4, 8), { pace: 14 });
    await sleep(700);
    await vo('erase.undo');
    await dm('cap', 'Undo', '`Esc` undoes, `Shift`+`Esc` redoes');
    await key('Escape', 'Esc'); await sleep(900);
    await key('Shift+Escape', 'Shift Esc'); await sleep(700);
    await tool('draw', 'd');
    await shot('erase');
  },

  async frames() {
    await chapter('frames', 'Chapter 9', 'Frames and click-through', 'Each frame is a screen. Link them, then click through like a real app.');
    await vo('frames.strip');
    await dm('cap', 'Frames', 'The strip at the bottom is your storyboard. `1`–`9` jump to a frame');
    await calm(); await key('3'); await sleep(500); await key('1'); await fit();
    await tool('select', 'v');
    await vo('frames.link');
    await dm('cap', 'Link', 'Select a button, then `Space` `L`, and pick the frame it opens');
    const [bx, by, hw] = await where(1, 'Sign in');
    await clickAt(bx - hw + 6, by);
    await key(' ', 'Space'); await page.waitForSelector('#dKeys[open]'); await sleep(700);
    await page.keyboard.press('l'); await dm('keys', ['L']); await sleep(400); await dm('keys', null);
    await page.waitForSelector('#dLink[open]'); await sleep(900);
    await clickSel('#lres button:has(.fr:text-is("3"))'); await sleep(900);
    await calm();
    await vo('frames.play');
    await dm('cap', 'Play', '`I` plays it: click the link and it goes to that screen');
    await key('i', 'I'); await sleep(900);
    await clickAt(bx, by); await sleep(1600);
    await key('Escape', 'Esc'); await calm();
    await vo('frames.phone');
    await dm('cap', 'Phone', '`M` switches a frame between desktop and phone');
    await key('m', 'M'); await sleep(1600); await key('m', 'M'); await sleep(600);
    await shot('frames');
  },

  async image() {
    await chapter('image', 'Chapter 10', 'Start from a screenshot', 'Wireframe something that already exists. `P`');
    await calm(); await key('3'); await sleep(400);
    await vo('image.drop');
    await dm('cap', 'Image', 'Drop, paste or pick a screenshot: it goes on a new frame, behind the canvas');
    await clickSel('#bShot');
    await page.setInputFiles('#fileIn', join(here, 'source-screen.png'));
    await sleep(2000); await fit();
    await tool('draw', 'd');
    await vo('image.draw');
    await dm('cap', 'Image', 'Draw over it: the screenshot stays faint, your wireframe stays clean');
    await stroke(roughBox(40, 110, 220, 440));
    await stroke(roughBox(300, 110, 620, 440));
    await stroke(roughBox(40, 30, 880, 50));
    await sleep(800); await shot('image-drawn');
    await vo('image.hide');
    await dm('cap', 'Image', 'Hide the screenshot when you are done, or let your AI rebuild it for you');
    await page.locator('#bShotX').click().catch(() => {}); await sleep(1600);
    await shot('image');
  },

  async find() {
    await chapter('find', 'Chapter 11', 'Find', 'Search every frame: captions, labels and notes. `Ctrl`+`F`');
    await key('Control+f', 'Ctrl F');
    await page.waitForSelector('#dSearch[open]');
    await typeSlow('trial', 90); await sleep(1200);
    await page.keyboard.press('Enter'); await sleep(1600);
    await shot('find');
  },

  async review() {
    await chapter('review', 'Chapter 12', 'Review', 'Leave notes on the screen. Your AI reads them, makes the change and replies. `R`');
    await fit();
    await tool('review', 'r');
    await vo('review.note');
    await dm('cap', 'Review', 'Tap what you mean, write the note, Add note');
    const [bx, by] = await where(3, 'Start free trial');
    await clickAt(bx, by); await sleep(400);
    await clickSel('#change');
    await typeSlow('Make Team the recommended plan: badge it and say "Most popular".', 34);
    await clickSel('#bNote'); await sleep(1400);
    await vo('review.ask');
    await dm('chat', true);
    await dm('say', '<div class="u">I left a note on frame 3, please action it.</div>');
    await sleep(1200);
    await dm('say', '<div class="t">→ <b>get_review</b></div>'); await ai('get_review'); await sleep(900);
    await dm('say', '<div class="a">Adding a "Most popular" badge to the Team card.</div>'); await sleep(900);
    await dm('say', '<div class="t">→ <b>edit_element</b> frame:3 label:"Team"</div>');
    await ai('edit_element', { frame: 3, label: 'Team', role: 'card', set_label: 'Team · Most popular' }); await sleep(1300);
    const notes = JSON.parse((await ai('get_board', { format: 'json' })).text).frames[2].notes;
    await vo('review.done');
    await dm('say', '<div class="t">→ <b>resolve_notes</b></div>');
    await ai('resolve_notes', { ids: notes.map((n) => n.id), reply: 'Team is now marked "Most popular".' }); await sleep(1200);
    await dm('say', '<div class="a">Done, and I replied on your note.</div>'); await sleep(2200);
    await dm('chat', false); await dm('clearChat');
    await tool('draw', 'd');
    await shot('review');
  },

  async preview() {
    await chapter('preview', 'Chapter 13', 'Preview and Export', 'See it as a real UI, then take it anywhere. `Shift`+`V`, `W`');
    // the preview opens in a new tab; show it in a window over the app so it is in the recording
    await page.evaluate(() => {
      window.open = (url) => {
        const w = document.createElement('div');
        w.className = 'dm-win';
        w.style.cssText = 'position:fixed;z-index:99960;inset:40px 60px 90px;background:#fff;border-radius:12px;box-shadow:0 0 0 100vmax #0006,0 20px 60px #0008;overflow:hidden;display:flex;flex-direction:column';
        w.innerHTML = '<div style="background:#ece8e3;padding:8px 14px;font:13px system-ui;color:#5b4636">Preview (opens in a new tab)</div><iframe style="flex:1;border:0;width:100%"></iframe>';
        document.body.append(w); w.querySelector('iframe').src = url;
        return w.querySelector('iframe').contentWindow;
      };
    });
    await vo('preview.open');
    await dm('cap', 'Preview', 'Every frame drawn as a real interface');
    await button('#bPreview', 'Shift V'); await sleep(2200);
    const fr = page.frameLocator('.dm-win iframe');
    await vo('preview.style');
    await dm('cap', 'Preview', '`S` switches the style: clean, material, dark, brand, minimal');
    const styles = await fr.locator('#sty option').evaluateAll((os) => os.map((o) => o.value));
    for (const v of [...styles.slice(1), styles[0]]) { await dm('keys', ['S']); await fr.locator('#sty').selectOption(v); await sleep(1500); await dm('keys', null); }
    await shot('preview-win');
    await page.evaluate(() => document.querySelector('.dm-win')?.remove()); await sleep(400);
    await vo('preview.export');
    await dm('cap', 'Export', 'PNG, SVG, Markdown for the spec, a clickable prototype, Figma, Excalidraw...');
    await button('#bExport', 'W'); await page.waitForSelector('#dExport[open]'); await sleep(900);
    for (const t of ['Markdown', 'Prototype', 'Figma']) { await clickSel(`#dExport .tabs button:has-text("${t}")`); await sleep(1100); }
    await page.keyboard.press('Escape'); await sleep(500);
    await shot('preview');
  },

  async keys() {
    await chapter('keys', 'Chapter 14', 'Every key, one place', 'Press `Space` to see every shortcut, stamp and part, and search them.');
    await key(' ', 'Space'); await page.waitForSelector('#dKeys[open]'); await sleep(1500);
    await clickSel('#palq'); await typeSlow('frame', 90); await sleep(1800);
    await page.evaluate(() => document.getElementById('dKeys').close()); await sleep(400);
    await voice.done();
    await dm('title', '', 'Sketch it. Your AI builds it.', 'squiggle.axstack.dev · `Space` for every key · `?` for the animated guide');
    await vo('outro'); await sleep(3200); await voice.done(); await sleep(800);
    await shot('keys');
  },
};

// ---------- run ----------
await page.goto(`${BRIDGE}/`);
await page.waitForSelector('#bAi');
if (await page.locator('#bFresh').isVisible().catch(() => false)) { await page.click('#bFresh'); await sleep(300); }
if (!ONLY) { await dm('title', '', 'Get the most out of axSquiggle', 'Every mode, one chapter each, in the real app. Skip to the one you need.'); await vo('intro'); await sleep(3800); await voice.done(); await dm('untitle'); await sleep(500); }
for (const [id, run] of Object.entries(scenes)) if (!ONLY || ONLY.includes(id)) await run();

if (SHOTS) { console.log('shots in', process.env.SHOT_DIR ?? work); await browser.close(); bridge.kill(); process.exit(0); }

// ---------- encode: mp4 with chapter markers, chapters.json for the site, a poster ----------
await ctx.close();
const total = (Date.now() - t0) / 1000;
const webm = join(work, readdirSync(work).find((f) => f.endsWith('.webm')));
const outDir = join(root, 'docs/video'); mkdirSync(outDir, { recursive: true });
const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
const meta = [';FFMETADATA1', ...chapters.map((c, i) => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(c.start * 1000)}\nEND=${Math.round((chapters[i + 1]?.start ?? total) * 1000)}\ntitle=${c.title}`)].join('\n');
writeFileSync(join(work, 'chapters.txt'), meta + '\n');
const mix = mixArgs(webm, voice.clips), ci = String(mix.next);
ff([...mix.inputs, '-i', join(work, 'chapters.txt'), ...mix.out, '-map_metadata', ci, '-map_chapters', ci, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-preset', 'slow', '-movflags', '+faststart', join(outDir, 'axsquiggle-modes.mp4')]);
writeFileSync(join(outDir, 'axsquiggle-modes.chapters.json'), JSON.stringify(chapters.map(({ id, title, start }) => ({ id, title, start: Math.round(start * 10) / 10 })), null, 2) + '\n');
const posterAt = chapters.find((c) => c.id === 'preview')?.start ?? 5;
ff(['-ss', String(posterAt + 6), '-i', webm, '-frames:v', '1', join(root, 'docs/img/modes-poster.png')]);
console.log(`${Math.round(total)}s, ${chapters.length} chapters`);
bridge.kill(); await browser.close();
rmSync(work, { recursive: true, force: true });
process.exit(0);
