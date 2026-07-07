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
- [x] A scripted check (throwaway node script under /private/tmp) proves:
      bootstrap creates admin + prints token; `verifyToken` accepts it and
      returns role admin; `createUser` returns a working member token;
      `revokeUser` makes that token verify to null; `rotateToken` issues a new
      working token and invalidates the old; duplicate username rejected;
      invalid username rejected; `data/users.json` contains no plaintext tokens.
- [x] Second bootstrap run refuses (exit 1) and changes nothing.
- [x] `KANBAN_DATA_DIR` override respected (store lands in the given dir).
- [x] `data/` is gitignored; nothing under it is tracked.
- [x] `node --check` green on all entrypoints.

## Result (worker fills in)
- Commit: 7d37ff7 `feat(users): multi-user foundation — user registry, API tokens, roles [work-item 001]`
- What changed: New `server/` ESM package (`server/package.json` with `"type": "module"`, mirroring `mcp/`): `server/lib/users.js` — JSON user store at `data/users.json` (`KANBAN_DATA_DIR` override honoured), users `{username, email, role, tokenHash, createdAt}`, tokens random 32-byte hex stored only as sha256 hashes, `createUser` / `verifyToken` (timing-safe compare) / `listUsers` / `revokeUser` (deletes tokenHash) / `rotateToken`, username validated against `[a-z0-9-_]{2,32}` + uniqueness, atomic temp+rename writes (mode 0600). `server/bootstrap.js` — seeds the store with an `admin` user, prints the token once with a banner; exits 1 with "already bootstrapped" if the store exists. `.gitignore` — added `data/`.
- Verification output: throwaway script `/private/tmp/kanban-001-check.mjs` (cleaned up) against `KANBAN_DATA_DIR=/private/tmp/kanban-001-data`:

```
ok: bootstrap created admin and printed a 64-hex-char token
ok: second bootstrap refused (exit 1), store unchanged
ok: verifyToken(adminToken) → role admin
ok: createUser member token verifies
ok: revoked member token verifies to null
ok: rotateToken issues new token, old one dead
ok: duplicate username rejected
ok: invalid usernames rejected
ok: no plaintext token in users.json
ok: KANBAN_DATA_DIR override respected
ok: listUsers returns sanitized users
ALL CHECKS PASSED
```

`node --check` green on `server.js`, `mcp/server.js`, `server/lib/users.js`, `server/bootstrap.js` (node v25.6.0). `git check-ignore data/` → matched by `.gitignore:5`; `git ls-files data` empty.
