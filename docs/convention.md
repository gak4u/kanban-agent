# The work-item queue convention

The queue is a directory tree; the state machine is `git mv`. This document is
the full spec that both the cockpit (read side) and the MCP server (write
side) implement.

## Layout

Each participating project has a `work-items/` directory at its root:

```
work-items/
  pending/        NNN-slug.md   ← ready to be picked up
  in-progress/    NNN-slug.md   ← claimed by a worker
  blocked/        NNN-slug.md   ← stuck, has a "## Blocked" note
  done/           NNN-slug.md   ← finished + verified
  _artifacts/                   ← supporting files (screenshots, logs)
  _TEMPLATE.md                  ← blank item to copy
  README.md                     ← the protocol, for agents landing here
  WORKER_PROMPT.md              ← ready-to-use polling worker loop prompt
```

Only files matching `NNN-*.md` inside the four status folders are work items.
Everything else (`README.md`, `_TEMPLATE.md`, `_artifacts/`, …) is ignored by
tooling.

## Rules

1. **The folder a file sits in is the authoritative status.** Items carry a
   `status:` frontmatter field for human convenience, but it goes stale the
   moment a file moves; tools must always trust the folder. (The cockpit
   flags a stale frontmatter status in the item drawer.)
2. **`NNN` is allocated once, across all four folders.** It is a zero-padded,
   monotonically increasing number: `max(existing) + 1`, padded to three
   digits. It doubles as priority/FIFO order — workers always claim the
   lowest-numbered pending item.
3. **The move is the lock.** A worker claims an item with
   `git mv work-items/pending/NNN-slug.md work-items/in-progress/` (plain
   `mv`/rename when the project is not a git repo). Two workers cannot both
   win the move. Never touch a file that is already in `in-progress/`.
4. **One item = one self-contained, independently shippable change.** Bigger
   requests are split into multiple items ordered by number, linked with
   `depends_on` / `stacks_on`.
5. **The worker never edits an item's Scope or Acceptance criteria.** If an
   item is ambiguous, self-contradictory, or its premise is false, it moves to
   `blocked/` with a `## Blocked` note and the worker takes the next item.
6. **Done means verified.** Before moving an item to `done/`, the worker
   checks off every acceptance criterion, fills in the `## Result` section
   (commit, what changed, verification output), and cleans up any test data
   it created.

## Item format

```markdown
---
id: 007
title: Fix login redirect loop
type: bug
priority: P1
created: 2026-07-05
status: pending
depends_on: 003
---

## Summary
1–3 sentences: what is wanted and why.

## Verification (what the PM observed)
Where the problem is visible, current vs expected behaviour, evidence.

## Scope
- In scope: the exact changes
- Out of scope: explicitly excluded, to prevent drift

## Pointers (where to work)
- Files likely involved: path:line from a quick grep

## Acceptance criteria (binary, testable)
- [ ] Each criterion objectively pass/fail
- [ ] `npm test` passes (build/verify green)

## Result (worker fills in)
- Commit/branch:
- What changed:
- Verification output:

## Blocked            ← only on blocked items
Why it is stuck / what input is needed.
```

### Frontmatter fields

All fields are optional and parsed leniently (simple `key: value` lines only;
a malformed file must never crash a tool — fall back to filename-derived
id/title):

| Field | Meaning |
| --- | --- |
| `id` | Item number, normally matching the filename prefix. |
| `title` | Imperative one-liner. |
| `type` | `feature` \| `bug` \| `chore`. |
| `priority` | `P1` \| `P2` \| `P3`. |
| `created` | `YYYY-MM-DD`. |
| `status` | Convenience copy of the folder — goes stale, never trust it. |
| `depends_on` | Item number this depends on. |
| `stacks_on` | Item number this builds directly on top of. |
| `needs_migration` | Boolean; flags items that require a data migration. |

### Derived data

Tools derive per item: checkbox progress (checked/total across the whole
file), last activity (file mtime), the first paragraph of `## Summary`, and
the `## Blocked` note text for blocked items.

## Lifecycle

1. The **PM agent** verifies a request (against the live app when there is
   one), then writes a fully-specified item into `pending/` — acceptance
   criteria specific enough that "done" is unambiguous.
2. A **worker agent** claims the lowest `NNN` in `pending/` via `git mv` to
   `in-progress/`.
3. The worker implements exactly the Scope, verifies, and checks every
   acceptance criterion.
4. The worker fills in `## Result` and moves the file to `done/` — or to
   `blocked/` with a `## Blocked` note.
5. The worker loops back to step 2 until `pending/` is empty (polling mode:
   sleep and re-check rather than exiting immediately).
