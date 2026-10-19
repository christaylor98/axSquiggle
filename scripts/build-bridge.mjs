// Bundles the bridge + MCP server + the whole app into ONE file: dist/axsquiggle.mjs.
// Needs nothing but Node 18+:   node axsquiggle.mjs     (no npm install, no node_modules)
import { build } from 'esbuild';
import { readFileSync, statSync } from 'node:fs';

const html = readFileSync(new URL('../dist/axsquiggle.html', import.meta.url), 'utf8');
await build({
  entryPoints: [new URL('../server/main.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
  outfile: new URL('../dist/axsquiggle.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  bundle: true, platform: 'node', target: 'node18', format: 'esm', minify: true, legalComments: 'none',
  define: { __APP_HTML__: JSON.stringify(html) },
  // some bundled CommonJS dependencies call require(); give them one
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
const size = statSync(new URL('../dist/axsquiggle.mjs', import.meta.url)).size;
console.log(`dist/axsquiggle.mjs   ${(size / 1024 / 1024).toFixed(1)} MB (bridge + MCP + app, run with: node axsquiggle.mjs)`);
