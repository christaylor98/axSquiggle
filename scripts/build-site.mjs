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
<meta name="description" content="Fast wireframe and storyboard tool for writing specs. Sketch or type; connect your AI over MCP.">
<meta property="og:title" content="axSquiggle"><meta property="og:description" content="Sketch it. Your AI builds it. Up and running in 5 minutes."><meta property="og:image" content="media/demo-poster.png">
<style>
:root{--o:#e8590c;--ink:#2b2118;--bg:#fff8f2}
@media(prefers-color-scheme:dark){:root{--ink:#f4ece4;--bg:#1b1612}}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.55 system-ui,sans-serif}
main{max-width:960px;margin:0 auto;padding:32px 16px 64px}
img,video{width:100%;height:auto;border-radius:12px;display:block}
h1{font-size:clamp(30px,6vw,52px);line-height:1.1;margin:.2em 0 .1em;color:var(--o)}
.cta{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0 32px}
.cta a{background:var(--o);color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px}
.cta a.alt{background:transparent;color:var(--ink);border:2px solid var(--ink)}
section{margin-top:40px}h2{margin:0 0 6px}
code{background:#0002;border-radius:6px;padding:2px 7px}
</style></head><body><main>
<h1>axSquiggle</h1>
<p>Fast wireframe and storyboard tool for writing specs. Sketch with mouse, touch or pen, or type an outline; rough input becomes clean, labelled wireframe parts. Connect your AI over MCP and it drafts, reads your notes and acts on them.</p>
<div class="cta"><a href="app.html">Open the app</a><a class="alt" href="how-to.html">How-to guide</a><a class="alt" href="https://github.com/christaylor98/axsquiggle">GitHub</a></div>
<video controls preload="metadata" poster="media/demo-poster.png" playsinline><source src="media/demo.mp4" type="video/mp4"></video>
<section><h2>1. Connect</h2><p>Run <code>node axsquiggle.mjs</code>, add it to your AI client, press MCP in the app.</p><img src="media/demo-connect.gif" alt="Connecting the app and an AI client over MCP" loading="lazy"></section>
<section><h2>2. Replicate</h2><p>Drop in a screenshot of a screen you already have; your AI rebuilds it as a wireframe.</p><img src="media/demo-replicate.gif" alt="A screenshot rebuilt as a wireframe by an AI" loading="lazy"></section>
<section><h2>3. Change it, send it back</h2><p>Edit, leave a note, tell your AI. It acts and replies on the note.</p><img src="media/demo-review.gif" alt="Review note actioned by an AI" loading="lazy"></section>
</main></body></html>`);
// leave dist/ as the plain app (no hosted button): that is what gets downloaded and run locally
execSync('npm run dist', { stdio: 'inherit', env: { ...process.env, VITE_HOSTED_BRIDGE: '' } });
console.log(`_site ready (${bridge ? 'hosted bridge: ' + bridge : 'local-only, no hosted bridge'})`);
