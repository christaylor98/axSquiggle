# Hosted bridge (Cloudflare Worker)

The same tools as `node axsquiggle.mjs`, reachable by URL, so nobody has to install anything. The hosted app has an
**Activate MCP** button: it asks this Worker for a private session, connects the page to it, and shows the address to
paste into an AI client.

```
app (browser)  --/s/<secret>/api/*-->  Worker  -->  Durable Object "Session" (boards, one per secret)
AI client      --/s/<secret>/mcp---->  Worker  -->  same Durable Object
```

- `POST /api/sessions` mints `<nonce>.<hmac>`. That string is the session's name and its only credential.
- Anything under `/s/<secret>/` with a bad signature gets 404 before a Durable Object is touched, so made-up addresses cost nothing.
- The boards are kept in the Durable Object (SQLite-backed) and deleted after `SESSION_DAYS` (30) without use.
- A request body is limited to 8 MB (a board with pictures included).
- Browsers: only `ALLOWED_ORIGINS`, localhost and `file://` pages may call it.

## Deploy

```bash
npx wrangler login
npx wrangler secret put SESSION_KEY --config worker/wrangler.toml   # any long random string; keep it, changing it ends every session
npm run worker:deploy
```

Then in the dashboard (Workers & Pages, axsquiggle-mcp, Settings, Domains) add the custom domain `squiggle-mcp.axstack.dev`,
and add a rate-limiting rule for `POST /api/sessions` (Security, WAF, Rate limiting: for example 10 per minute per IP).
Build the app with the same address: `VITE_HOSTED_BRIDGE=https://squiggle-mcp.axstack.dev npm run dist` (`npm run site` does it).

## Develop and check

```bash
echo 'SESSION_KEY=local-dev-key' > worker/.dev.vars
npm run worker:dev          # http://localhost:8788
npm run worker:smoke        # in another terminal: sessions, REST, MCP over HTTP, live events, CORS, isolation
```
