---
id: 002
title: Persist tasks to localStorage
type: feature
priority: P1
created: 2026-06-26
status: done
stacks_on: 001
---

## Summary
Tasks vanish on reload. Persist the store to localStorage so the list survives
a refresh and a browser restart.

## Scope
- In scope: serialize the store on every mutation, hydrate on startup, schema version key
- Out of scope: cross-tab sync, server-side storage

## Pointers (where to work)
- Files likely involved: src/store.js

## Acceptance criteria (binary, testable)
- [x] Tasks added before a reload are present after the reload
- [x] Toggled/deleted state survives a reload
- [x] A corrupt localStorage payload falls back to an empty list without crashing
- [x] `npm test` passes (build/verify green)

## Result (worker fills in)
- Commit/branch: `b7203de` on `main`
- What changed: Store now writes through to `localStorage` under a versioned key and hydrates on boot; corrupt payloads are discarded with a console warning.
- Verification output: `npm test` — 15 passing. Reload and restart both keep the list; seeded a corrupt payload by hand and the app booted clean.
