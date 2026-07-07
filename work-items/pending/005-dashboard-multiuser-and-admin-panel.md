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
- [ ] Test instance on a 44xx port with a hosted fixture (from 004's shape):
      overview shows the registry project with a server-managed indicator and the
      active-claims strip; board cards show creator/claimer chips; item drawer
      shows both fields in the frontmatter header.
- [ ] `/admin`: with admin token — create user (token displayed once), revoke,
      create project, archive project, all reflected in the registry files; with
      member token — every `/api/admin/*` call 403s and the UI says so.
- [ ] Local-only mode (no data dir): cockpit behaves exactly as before (no admin
      link errors, no registry section), verified against `examples/demo-project`.
- [ ] Browser check (real browser): no console errors on overview, board, drawer,
      and admin pages; no horizontal page scroll.
- [ ] `node --check` green; no new npm deps.

## Result (worker fills in)
- Commit:
- What changed:
- Verification output:
