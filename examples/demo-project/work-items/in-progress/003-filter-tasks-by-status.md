---
id: 003
title: Filter tasks by status
type: feature
priority: P2
created: 2026-06-29
status: in-progress
---

## Summary
Long lists are unmanageable. Add All / Active / Completed filter tabs above the
list so users can focus on what is left to do.

## Scope
- In scope: filter tabs, filtered rendering, remembering the active filter across reloads
- Out of scope: text search, sorting, per-filter counts

## Pointers (where to work)
- Files likely involved: src/components/FilterTabs.js (new), src/components/TaskList.js, src/store.js

## Acceptance criteria (binary, testable)
- [x] Tabs render with the current filter visually highlighted
- [x] Active shows only incomplete tasks
- [ ] Completed shows only completed tasks
- [ ] The chosen filter survives a page reload
- [ ] `npm test` passes (build/verify green)

## Result (worker fills in)
- Commit/branch:
- What changed:
- Verification output:
