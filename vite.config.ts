import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';

/** Which build is this? The commit, and when it was built, shown next to the title so a stale cached page is easy to spot. */
const build = (() => {
  let rev = 'dev';
  try { rev = execSync('git describe --always --dirty', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a git checkout */ }
  return `${rev} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
})();

export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(build) },
  // Everything (fonts included) goes into the JS/CSS so scripts/build-single.mjs can make one self-contained file.
  build: { target: 'es2022', assetsInlineLimit: 100_000_000, cssCodeSplit: false, modulePreload: false },
  test: { include: ['tests/**/*.test.ts'] },
});
