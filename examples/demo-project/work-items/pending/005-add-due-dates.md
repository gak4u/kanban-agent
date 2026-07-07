---
id: 005
title: Add due dates to tasks
type: feature
priority: P2
created: 2026-07-02
status: pending
stacks_on: 003
---

## Summary
Tasks need an optional due date so users can see what is urgent. Overdue tasks
should stand out in the list.

## Scope
- In scope: optional due date on the task model, date picker in the add form, overdue highlight, sort-by-due-date within the Active filter
- Out of scope: reminders/notifications, recurring tasks

## Pointers (where to work)
- Files likely involved: src/store.js, src/components/TaskItem.js, src/components/AddForm.js

## Acceptance criteria (binary, testable)
- [ ] A task can be created with and without a due date
- [ ] Tasks with a due date in the past render with an overdue style
- [ ] Active filter orders dated tasks before undated ones, soonest first
- [ ] Due dates survive a reload (persisted with the task)
- [ ] `npm test` passes (build/verify green)

## Result (worker fills in)
- Commit/branch:
- What changed:
- Verification output:
