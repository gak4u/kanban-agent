---
id: 001
title: Multi-user foundation — user registry, API tokens, roles
type: feature
priority: P1
created: 2026-07-07
status: pending
---

## Summary
Hosted mode needs identities: a server-side user registry with per-user API tokens
and two roles (`admin`, `member`). This item builds the storage + auth module that
items 002–005 ride on. No transport/UI yet.

## Scope
- In scope:
  - `server/lib/users.js` (ES module): load/save a JSON store at `data/users.json`
    (path overridable via `KANBAN_DATA_DIR` env; default `<repo>/data/`).
    Shape: `{ users: [{ username, email, role: "admin"|"member",
    tokenHash, createdAt }] }`. Tokens are random 32-byte hex, stored ONLY as
    sha256 hashes; the plaintext is returned exactly once at creation.
    Functions: `createUser({username, email, role})` → `{user, token}`,
    `verifyToken(token)` → user or null, `listUsers()`, `revokeUser(username)`
    (regenerates nothing, marks token invalid by deleting tokenHash),
    `rotateToken(username)` → new token. Username: `[a-z0-9-_]{2,32}`, unique.
    Atomic writes (write temp + rename). Concurrent-safe enough for one process.
  - Bootstrap: `server/bootstrap.js` — if `data/users.json` is missing, creates it
    with an `admin` user and prints the admin token ONCE to stdout with a clear
    banner; if it exists, prints "already bootstrapped" and exits 1.
  - `.gitignore`: add `data/`.
- Out of scope: HTTP anything, MCP wiring, password auth, token expiry.

## Pointers
- New directory `server/`. Follow the code style of `server.js` (plain Node,
  small focused functions, no deps).

## Acceptance criteria (binary, testable)
- [ ] A scripted check (throwaway node script under /private/tmp) proves:
      bootstrap creates admin + prints token; `verifyToken` accepts it and
      returns role admin; `createUser` returns a working member token;
      `revokeUser` makes that token verify to null; `rotateToken` issues a new
      working token and invalidates the old; duplicate username rejected;
      invalid username rejected; `data/users.json` contains no plaintext tokens.
- [ ] Second bootstrap run refuses (exit 1) and changes nothing.
- [ ] `KANBAN_DATA_DIR` override respected (store lands in the given dir).
- [ ] `data/` is gitignored; nothing under it is tracked.
- [ ] `node --check` green on all entrypoints.

## Result (worker fills in)
- Commit:
- What changed:
- Verification output:
