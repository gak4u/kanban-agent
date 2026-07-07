---
id: 007
title: Add keyboard shortcuts for common actions
type: feature
priority: P3
created: 2026-07-05
status: pending
---

## Summary
Power users want to manage the list without the mouse: focus the add field,
toggle the selected task, and switch filters from the keyboard.

## Scope
- In scope: `n` focuses the add field, `x` toggles the selected task, `1/2/3` switch filters, a `?` overlay listing the shortcuts
- Out of scope: customizable bindings, vim-style navigation

## Pointers (where to work)
- Files likely involved: src/shortcuts.js (new), src/components/HelpOverlay.js (new)

## Acceptance criteria (binary, testable)
- [ ] Each shortcut performs its action when the list has focus
- [ ] Shortcuts do not fire while typing in the add field
- [ ] `?` opens and closes the shortcut overlay
- [ ] `npm test` passes (build/verify green)

## Result (worker fills in)
- Commit/branch:
- What changed:
- Verification output:
