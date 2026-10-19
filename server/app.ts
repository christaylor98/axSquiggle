import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Filled in by scripts/build-bridge.mjs: the whole app as one HTML string, so the bridge is a single file. */
declare const __APP_HTML__: string | undefined;

/** The app's HTML: embedded in the bundled bridge, or read from dist/ when running from source. */
export function appHtml(): string | null {
  if (typeof __APP_HTML__ === 'string') return __APP_HTML__;
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [join(here, '..', 'dist', 'axsquiggle.html'), join(here, 'axsquiggle.html')]) if (existsSync(p)) return readFileSync(p, 'utf8');
  return null;
}

/** The app with the bridge address and token written into it, so opening it connects with no typing. */
export function appPage(url: string, token: string | null): string | null {
  const html = appHtml();
  if (!html) return null;
  const cfg = JSON.stringify(token ? { url, token } : { url }).replace(/</g, '\\u003c'); // no token on a shared server: people type it once
  return html.replace('<head>', `<head><script>window.__AXSQ__=${cfg}</script>`);
}
