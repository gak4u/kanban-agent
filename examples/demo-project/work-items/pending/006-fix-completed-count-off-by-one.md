---
id: 006
title: Fix completed counter off-by-one after delete
type: bug
priority: P1
created: 2026-07-03
status: pending
---

## Summary
Deleting a completed task leaves the "N completed" footer counter one too high
until the next toggle. The counter reads a cached value instead of deriving
from the store.

## Verification (what the PM observed)
- Where: footer counter, after deleting any completed task
- Current behaviour: counter keeps the pre-delete value (e.g. "3 completed" with 2 left)
- Expected behaviour: counter always equals the number of completed tasks in the list

## Scope
- In scope: derive the completed count from store state on every render
- Out of scope: footer redesign, other counters

## Pointers (where to work)
- Files likely involved: src/components/Footer.js

## Acceptance criteria (binary, testable)
- [ ] Deleting a completed task decrements the counter immediately
- [ ] Counter is correct after any sequence of add/toggle/delete
- [ ] Regression test covers delete-then-read-counter
- [ ] `npm test` passes (build/verify green)

## Result (worker fills in)
- Commit/branch:
- What changed:
- Verification output:
