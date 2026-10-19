// Turns dist/ (the normal Vite build) into ONE self-contained file: dist/axsquiggle.html.
// Double-click it, e-mail it, host it anywhere: no server, no install, works offline. Run via `npm run dist`.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url);
const path = (f) => join(dist.pathname.replace(/^\/([A-Za-z]:)/, '$1'), f);
let html = readFileSync(path('index.html'), 'utf8');

const assets = readdirSync(path('assets'));
const read = (name) => readFileSync(path(`assets/${name}`), 'utf8');

// stylesheet -> <style>
html = html.replace(/<link rel="stylesheet"[^>]*href="\.?\/?assets\/([^"]+\.css)"[^>]*>/g, (_m, name) => `<style>${read(name)}</style>`);
// module script -> inline module script (escape anything that could close it early)
html = html.replace(/<script type="module"[^>]*src="\.?\/?assets\/([^"]+\.js)"[^>]*><\/script>/g, (_m, name) => `<script type="module">${read(name).replace(/<\/script/gi, '<\\/script')}</script>`);

if (/assets\//.test(html.replace(/data:[^"')]+/g, ''))) {
  const left = html.match(/[^"'(\s]*assets\/[^"')\s]+/g);
  throw new Error(`Still references separate files: ${left?.slice(0, 3).join(', ')}`);
}
void assets;
writeFileSync(path('axsquiggle.html'), html);
// The animated guide as a standalone page too (the app opens its own copy; this one can be hosted or shared on its own).
writeFileSync(path('how-to.html'), readFileSync(new URL('../src/ui/howto.html', import.meta.url), 'utf8'));
console.log(`dist/axsquiggle.html  ${(html.length / 1024).toFixed(0)} KB (one file, no dependencies)`);
