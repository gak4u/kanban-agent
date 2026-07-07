---
id: 001
title: Scaffold the todo list CRUD
type: feature
priority: P1
created: 2026-06-24
status: done
---

## Summary
Stand up the core todo list: add a task, list tasks, toggle complete, delete.
Everything later builds on this.

## Scope
- In scope: task model, list view, add/toggle/delete interactions
- Out of scope: persistence, filters, visual polish

## Pointers (where to work)
- Files likely involved: src/store.js, src/components/TaskList.js

## Acceptance criteria (binary, testable)
- [x] A task can be added from the input field and appears in the list
- [x] Clicking a task's checkbox toggles its completed state
- [x] The delete button removes the task from the list
- [x] `npm test` passes (build/verify green)

## Result (worker fills in)
- Commit/branch: `a41f9c2` on `main`
- What changed: Added the in-memory task store and the list/add/toggle/delete UI components.
- Verification output: `npm test` — 12 passing. Exercised add, toggle and delete in the running app; no console errors.
