# Work-item queue

A file-based task queue between the **PM agent** (writes items) and **worker agents**
(execute them). This project dogfoods its own convention — see `docs/convention.md`.

## Folders = status (a file's location IS its state)

- `pending/`     — ready to be picked up. Worker pulls from here.
- `in-progress/` — claimed by a worker (move here on claim).
- `done/`        — finished + verified.
- `blocked/`     — cannot proceed; needs PM/human input (see the item's `## Blocked` note).

## File naming

`NNN-short-slug.md` — `NNN` is a zero-padded, monotonically increasing number =
priority/FIFO order. Worker always claims the **lowest-numbered** file in `pending/`.

## Lifecycle

1. PM writes a fully-specified item into `pending/`.
2. Worker claims lowest `NNN` → `git mv` it to `in-progress/`.
3. Worker implements, verifies, checks every acceptance criterion.
4. Worker fills in the `## Result` section and moves the file to `done/` (or `blocked/`).
5. Worker loops back to step 2 until `pending/` is empty.

## Rules

- One item = one self-contained, independently shippable change.
- The worker must not edit `pending/` items' scope; if an item is wrong/ambiguous,
  move it to `blocked/` with a note and continue with the next.
- Never two workers on the same file — the `git mv` to `in-progress/` is the claim/lock.
