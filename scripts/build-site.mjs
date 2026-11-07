// Builds _site/: a landing page with the demo video, plus the hosted app and the how-to.
// Host it anywhere static (Cloudflare Pages: build "npm ci && npm run site", output "_site").
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Local-first: the site serves the plain app. Set VITE_HOSTED_BRIDGE=https://... to also offer one-click "Activate MCP" against a deployed worker/.
const bridge = process.env.VITE_HOSTED_BRIDGE ?? '';
execSync('npm run dist', { stdio: 'inherit', env: { ...process.env, VITE_HOSTED_BRIDGE: bridge } });
rmSync('_site', { recursive: true, force: true });
mkdirSync('_site/media', { recursive: true });
cpSync('dist/axsquiggle.html', '_site/app.html');
cpSync('dist/how-to.html', '_site/how-to.html');
cpSync('docs/video/axsquiggle-in-5-minutes.mp4', '_site/media/demo.mp4');
for (const f of ['demo-poster.png', 'demo-connect.gif', 'demo-replicate.gif', 'demo-review.gif']) cpSync(`docs/img/${f}`, `_site/media/${f}`);
cpSync('docs/img/banner.svg', '_site/media/banner.svg');
// the app opened from the site works offline; the AI bridge download is linked from the repo
writeFileSync('_site/index.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>axSquiggle: sketch it, it cleans itself up</title>
<meta name="description" content="Fast wireframe and storyboard tool for writing specs. Download one file, sketch or type, and let your AI build and revise screens over MCP.">
<meta property="og:title" content="axSquiggle"><meta property="og:description" content="Sketch it. Your AI builds it. Download one file and go."><meta property="og:image" content="media/demo-poster.png">
<style>
:root{--paper:#EAE9E3;--ink:#191D19;--ink2:#3A403A;--dim:#6E736C;--rule:#C6C4BB;--accent:#166B60;--deep:#0C4A42;--soft:#CFE2DD;--panel:#DEDCD5}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink2);font:clamp(17px,1.2vw,18px)/1.6 "IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace}
main{max-width:1020px;margin:0 auto;padding:20px 28px 72px}
@media(max-width:720px){main{padding:16px 18px 56px}}
nav{display:flex;flex-wrap:wrap;gap:4px 20px;align-items:baseline;padding:0 0 18px;border-bottom:1px solid var(--rule);margin-bottom:36px;font-size:14px}
nav b{font-size:16px;margin-right:auto;color:var(--ink)}nav a{color:var(--dim);text-decoration:none}nav a:hover{color:var(--accent)}
h1{font-size:clamp(30px,5vw,46px);line-height:1.15;margin:0 0 14px;color:var(--deep);font-weight:600}
h2{font-size:clamp(20px,2.4vw,24px);margin:0 0 6px;color:var(--deep);font-weight:600}
p{margin:0 0 14px;max-width:62ch}
a{color:var(--accent)}
.kick{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin-bottom:10px}
.cta{display:flex;flex-wrap:wrap;gap:12px;margin:22px 0 36px}
.cta a{background:var(--accent);color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:4px}
.cta a.alt{background:transparent;color:var(--ink);border:1px solid var(--ink)}
img,video{width:100%;height:auto;display:block;border:1px solid var(--rule);background:#fff}
section{margin-top:52px}
table{border-collapse:collapse;width:100%;font-size:16px}
td,th{padding:10px 12px;border-top:1px solid var(--rule);text-align:left;vertical-align:top}th{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);font-weight:500;border-top:0}
code,pre{background:var(--panel);border-radius:3px;font:15px ui-monospace,Menlo,Consolas,monospace}code{padding:1px 6px}
pre{padding:14px 16px;overflow-x:auto;margin:10px 0 0}
.steps{counter-reset:s;list-style:none;padding:0;margin:0}.steps li{counter-increment:s;margin:0 0 10px;padding-left:34px;position:relative}.steps li::before{content:counter(s);position:absolute;left:0;top:1px;width:24px;height:24px;border-radius:50%;background:var(--soft);color:var(--deep);font-size:14px;display:grid;place-items:center}
@media(max-width:720px){table,tbody,tr,td{display:block}tr:first-child{display:none}td{border-top:0;padding:2px 0}tr{border-top:1px solid var(--rule);padding:12px 0}}
footer{margin-top:64px;border-top:1px solid var(--rule);padding-top:16px;font-size:14px;color:var(--dim)}
</style></head><body><main>
<nav><b>axSquiggle</b><a href="#download">Download</a><a href="app.html">Open the app</a><a href="how-to.html">How-to</a><a href="https://github.com/christaylor98/axSquiggle">GitHub</a></nav>
<div class="kick">Wireframes for specs</div>
<h1>Sketch it. Your AI builds it.</h1>
<p>A fast wireframe and storyboard tool for writing specs. Sketch with mouse, touch or pen, or type an outline; rough input becomes clean, labelled screens. Connect your AI over MCP and it drafts screens, reads your notes and acts on them.</p>
<div class="cta"><a href="#download">Download</a><a class="alt" href="app.html">Try the app (no AI, nothing to install)</a></div>
<video controls preload="metadata" poster="media/demo-poster.png" playsinline><source src="media/demo.mp4" type="video/mp4"></video>

<section id="download"><h2>Download</h2>
<p>One file, on your machine. Nothing is sent anywhere: the bridge listens on <code>127.0.0.1</code> only and your boards are files in <code>~/.axsquiggle/</code>.</p>
<table>
<tr><th>File</th><th>What it is</th><th>Needs</th></tr>
<tr><td><a href="https://github.com/christaylor98/axSquiggle/releases/latest/download/axsquiggle.mjs"><b>axsquiggle.mjs</b></a></td><td>The app <b>plus the AI bridge</b> (MCP). Run it and the app opens already connected.</td><td><a href="https://nodejs.org">Node 18+</a>. No <code>npm install</code>.</td></tr>
<tr><td><a href="https://github.com/christaylor98/axSquiggle/releases/latest/download/axsquiggle.html"><b>axsquiggle.html</b></a></td><td>Just the app, one file, works offline.</td><td>Nothing: double-click it.</td></tr>
<tr><td><a href="https://github.com/christaylor98/axSquiggle/releases/latest/download/how-to.html">how-to.html</a></td><td>The animated guide.</td><td>Nothing.</td></tr>
</table>
<p style="margin-top:14px">All files, checksums and notes: <a href="https://github.com/christaylor98/axSquiggle/releases/latest">the Releases page</a>.</p></section>

<section><h2>Up and running in a minute</h2>
<ol class="steps">
<li>Download <code>axsquiggle.mjs</code>, then run <code>node axsquiggle.mjs</code>. The app opens in your browser, already connected.</li>
<li>Add it to your AI client (use the real path to the file):<pre>claude mcp add axsquiggle -- node /path/to/axsquiggle.mjs mcp</pre></li>
<li>Drop in a screenshot of a screen you already have and ask your AI to replicate it. Change it, leave a note, tell your AI: it acts and replies on the note.</li>
</ol></section>

<section><h2>1. Download and connect</h2><p>The app opens connected: the MCP button goes green and your AI joins the same board.</p><img src="media/demo-connect.gif" alt="Running axsquiggle.mjs, the app opening already connected, and adding it to an AI client" loading="lazy"></section>
<section><h2>2. Replicate a screen</h2><p>Drop in a screenshot; your AI rebuilds it as a wireframe.</p><img src="media/demo-replicate.gif" alt="A screenshot rebuilt as a wireframe by an AI" loading="lazy"></section>
<section><h2>3. Change it, send it back</h2><p>Edit, leave a note on what bothers you, tell your AI. It acts and replies on the note.</p><img src="media/demo-review.gif" alt="A review note actioned by an AI" loading="lazy"></section>

<footer>axSquiggle is <a href="https://github.com/christaylor98/axSquiggle/blob/main/LICENSE">MIT licensed</a>. The AI side of these recordings is scripted with the same tool calls an MCP client makes.</footer>
</main></body></html>`);
// leave dist/ as the plain app (no hosted button): that is what gets downloaded and run locally
execSync('npm run dist', { stdio: 'inherit', env: { ...process.env, VITE_HOSTED_BRIDGE: '' } });
console.log(`_site ready (${bridge ? 'hosted bridge: ' + bridge : 'local-only, no hosted bridge'})`);
