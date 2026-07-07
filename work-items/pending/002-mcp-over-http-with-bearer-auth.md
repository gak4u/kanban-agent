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
- [ ] Scripted HTTP check on a test port: initialize → tools/list returns the same
      8 tools + 2 prompts as stdio; request WITHOUT token → 401; request with a
      revoked token → 401; two different users' sessions work concurrently.
- [ ] stdio mode still passes the existing handshake (initialize → tools/list) —
      byte-for-byte same tool list; local `claude mcp list` still shows
      kanban-agent Connected.
- [ ] `node --check` green on all entrypoints; no new npm deps.

## Result (worker fills in)
- Commit:
- What changed:
- Verification output:
