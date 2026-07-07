---
id: 005
title: Dashboard — user badges, hosted-mode registry source, and an admin panel
type: feature
priority: P2
created: 2026-07-07
status: pending
stacks_on: 004
---

## Summary
Make the cockpit collaboration-aware: cards show who created/claimed items, the
dashboard can read the hosted project registry, and an admin panel manages users
and projects from the browser.

## Scope
- In scope:
  - Hosted source: when `data/projects.json` exists (hosted mode), the cockpit
    ALSO lists registry projects (non-archived) from `data/projects/<name>/`,
    alongside any filesystem-configured ones; project cards indicate which are
    server-managed.
  - Board cards: `created_by` / `claimed_by` rendered as small user chips
    (in-progress cards show the claimer prominently). Overview: an "active
    claims" strip — `user → #NNN title (project)` for every in-progress item.
  - Admin panel at `/admin`: token entry (kept in localStorage, sent as
    `Authorization: Bearer`); server-side, admin-only JSON endpoints under
    `/api/admin/*` (users list/create/revoke/rotate, projects create/archive)
    reusing 001/003 libs; non-admin tokens → 403. Panel shows one-time tokens on
    creation with a copy button and a "shown once" warning.
  - Read access to the board stays unauthenticated (unchanged) — write/admin is
    what tokens gate. Document this plainly in the README.
- Out of scope: per-user board filtering beyond the claims strip, websockets,
  themes, mobile polish.

## Pointers
- `server.js` (cockpit server + parser), `public/app.js` + `style.css`,
  `server/lib/users.js`, `server/lib/projects.js`.

## Acceptance criteria (binary, testable)
- [x] Test instance on a 44xx port with a hosted fixture (from 004's shape):
      overview shows the registry project with a server-managed indicator and the
      active-claims strip; board cards show creator/claimer chips; item drawer
      shows both fields in the frontmatter header.
- [x] `/admin`: with admin token — create user (token displayed once), revoke,
      create project, archive project, all reflected in the registry files; with
      member token — every `/api/admin/*` call 403s and the UI says so.
- [x] Local-only mode (no data dir): cockpit behaves exactly as before (no admin
      link errors, no registry section), verified against `examples/demo-project`.
- [x] Browser check (real browser): no console errors on overview, board, drawer,
      and admin pages; no horizontal page scroll.
- [x] `node --check` green; no new npm deps.

## Result (worker fills in)
- Commit: 216f749 `feat(dashboard): user badges, hosted registry source, admin panel [work-item 005]`
- What changed: `server.js` — cockpit merges non-archived registry projects (`data/projects.json`, `KANBAN_DATA_DIR`-aware) into `resolveProjects()` with `managed: true`; new admin-only `/api/admin/*` JSON endpoints (users list/create/revoke/rotate; projects create/archive — create applies the same `attach_workflow` scaffold, now exported from `mcp/core.js`) reusing the 001/003 ESM libs via cached dynamic `import()`; member tokens → 403 with a message, missing/invalid → 401; board reads stay unauthenticated; `/admin` serves the panel. `public/app.js` — overview active-claims strip (`user → #NNN title (project)` links), `server-managed` tag on project cards, `by <creator>` chips, prominent claimer line (avatar initial) on in-progress cards, `claimed: <user>` chip elsewhere; drawer needed no change (frontmatter renders all fields, now incl. the stamps). New `public/admin.html` + `public/admin.js` — token in localStorage sent as Bearer, users/projects tables with revoke/rotate/archive actions, create forms, one-time token reveal with copy button and "shown ONCE" warning, error banner. `public/style.css` — chips/strip/admin styles. README documents tokens gate writes/admin while reads stay open.
- Verification output: scripted `/private/tmp/kanban-005-check.mjs` (cleaned up; MCP on 4464, hosted cockpit 4465, local-only cockpit 4466):

```
ok: cockpit lists registry project (managed: true) with createdBy/claimedBy
ok: /api/item frontmatter has created_by/claimed_by (drawer header)
ok: admin create user via /api/admin/users → one-time token returned
ok: rotate + revoke reflected in data/users.json
ok: admin create + archive project via /api/admin/projects, reflected in registry file
ok: every /api/admin/* call → 403 with a member token (401 with none)
ok: GET /admin serves the admin panel
ok: local-only mode — demo project unchanged, no registry section, admin API cleanly rejects
```

Real-browser check (browser-use, headless Chromium, console-error + unhandled-rejection hooks, resource status scan): overview — claims strip `bob → #001 Hosted card (hosted-app)`, `server-managed` tag, 0 console errors, no horizontal scroll; board — 4 columns, claimer line `bob` + `by alice` chip, clean; drawer — visible with `created_by`/`claimed_by` rows, clean; /admin — member token → UI banner `admin required — "alice" has role "member"`, admin token → users (admin/alice/bob/carol) + projects (hosted-app, panel-proj archived) tables, UI create-user → one-time token reveal with Copy button, 0 console errors, no horizontal scroll on any page. `node --check` green (`server.js`, `mcp/core.js`, `public/app.js`, `public/admin.js`); no new npm deps. Production cockpit on 4400 untouched (verified still listening); test instances on 4464–4466 killed; fixtures removed.
