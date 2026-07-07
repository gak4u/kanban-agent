---
id: 002
title: Serve the MCP over Streamable HTTP with per-user Bearer auth
type: feature
priority: P1
created: 2026-07-07
status: pending
stacks_on: 001
---

## Summary
Today the MCP is stdio-only (one local user). Hosted mode: the same tool set served
over the MCP Streamable HTTP transport so many users' agents connect to one server,
each authenticated by their Bearer token from item 001.

## Scope
- In scope:
  - Refactor `mcp/server.js` minimally so the server construction (tools + prompts
    + handlers) is a reusable factory (e.g. `mcp/core.js` exporting
    `buildServer(context)`), keeping `mcp/server.js` as the unchanged-behaviour
    stdio entrypoint. `context` carries `{ user }` (null in stdio/local mode).
  - New `server/mcp-http.js`: Node `http` server exposing the MCP at `POST/GET/DELETE
    /mcp` via the SDK's `StreamableHTTPServerTransport` (session-per-client as per
    SDK docs). Every request must carry `Authorization: Bearer <token>` that
    `verifyToken` (item 001) resolves — else 401 JSON-RPC error. Resolved user is
    attached to that session's context (tools can read who is calling).
    Port: `KANBAN_MCP_PORT`, default 4401. Bind 0.0.0.0 (it's a team server).
  - `npm run mcp-http` script. README gets a short "hosted MCP" note incl. client
    registration one-liner:
    `claude mcp add --transport http kanban-agent http://<server>:4401/mcp --header "Authorization: Bearer <token>"`.
- Out of scope: TLS (document "put nginx in front"), project registry changes
  (item 003), attribution (item 004), dashboard (item 005).

## Pointers
- `mcp/server.js` (current tool defs), `@modelcontextprotocol/sdk` server +
  streamableHttp modules (already installed — check `mcp/node_modules/...` for the
  exact import paths and API of the installed version rather than guessing).

## Acceptance criteria (binary, testable)
- [x] Scripted HTTP check on a test port: initialize → tools/list returns the same
      8 tools + 2 prompts as stdio; request WITHOUT token → 401; request with a
      revoked token → 401; two different users' sessions work concurrently.
- [x] stdio mode still passes the existing handshake (initialize → tools/list) —
      byte-for-byte same tool list; local `claude mcp list` still shows
      kanban-agent Connected.
- [x] `node --check` green on all entrypoints; no new npm deps.

## Result (worker fills in)
- Commit: c5b12f1 `feat(mcp): serve the MCP over Streamable HTTP with per-user Bearer auth [work-item 002]`
- What changed: `mcp/server.js` refactored into `mcp/core.js` exporting `buildServer(context)` (all tools/prompts; `context = { user }`, null in stdio mode, passed as second arg to every tool handler; also re-exports `StreamableHTTPServerTransport` + `isInitializeRequest` so code outside `mcp/` can resolve the SDK) — `mcp/server.js` is now a thin unchanged-behaviour stdio entrypoint. New `server/mcp-http.js`: Node `http` server for `POST/GET/DELETE /mcp` via `StreamableHTTPServerTransport` (SDK 1.29.0), session-per-client, every request auth'd with `Authorization: Bearer <token>` via `verifyToken` (401 JSON-RPC error when missing/invalid/revoked; 403 when a valid token uses another user's session; resolved user attached to the session's `buildServer` context). Port `KANBAN_MCP_PORT` default 4401, bind 0.0.0.0. `npm run mcp-http` script + README "Hosted MCP" section with the `claude mcp add --transport http … --header` one-liner and put-nginx-in-front TLS note. Zero new deps.
- Verification output: throwaway `/private/tmp/kanban-002-check.mjs` (cleaned up), HTTP server on test port 4460 with `KANBAN_DATA_DIR=/private/tmp/kanban-002-data`:

```
ok: request without token → 401 JSON-RPC error
ok: invalid token → 401
ok: revoked token → 401
ok: two users' sessions work concurrently (admin=38e42d3f…, carol=fe0cb7df…)
ok: HTTP tools/prompts byte-for-byte identical to stdio baseline (8 tools + 2 prompts)
ok: another user's session id with a different token → 403
ok: queue_status tool call over HTTP returns counts
ALL HTTP CHECKS PASSED
```

stdio: initialize → tools/list → prompts/list captured before and after the refactor — `diff` empty ("STDIO BYTE-FOR-BYTE IDENTICAL", 8 tools + 2 prompts). `claude mcp list` → `kanban-agent: node …/mcp/server.js - ✔ Connected`. `node --check` green on `server.js`, `mcp/server.js`, `mcp/core.js`, `server/mcp-http.js`, `server/lib/users.js`, `server/bootstrap.js`. No new npm deps (only `@modelcontextprotocol/sdk`, already present). Port 4400 untouched; test instance on 4460 killed by the script.
