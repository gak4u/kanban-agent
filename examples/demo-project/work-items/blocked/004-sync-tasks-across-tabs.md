---
id: 004
title: Sync tasks across browser tabs
type: feature
priority: P2
created: 2026-07-01
status: blocked
depends_on: 002
---

## Summary
Two open tabs drift apart: a task added in one tab does not appear in the other
until a manual reload. Propagate store changes across tabs.

## Scope
- In scope: cross-tab change propagation, conflict-free last-write-wins merge
- Out of scope: multi-device sync, offline queueing

## Pointers (where to work)
- Files likely involved: src/store.js

## Acceptance criteria (binary, testable)
- [ ] A task added in tab A appears in tab B within one second, without a reload
- [ ] Toggling a task in tab A updates it in tab B
- [ ] No duplicate tasks after rapid edits in both tabs
- [ ] `npm test` passes (build/verify green)

## Result (worker fills in)
- Commit/branch:
- What changed:
- Verification output:

## Blocked

Needs a PM decision on the transport: `storage` events fire only in *other*
tabs and drop writes that land in the same tick, while `BroadcastChannel` is
cleaner but changes the persistence layering introduced in item 002. Paused
until the approach is picked.
