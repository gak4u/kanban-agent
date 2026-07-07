---
id: 004
title: Attribution — created_by/claimed_by stamps + git commit/push as the item creator on completion
type: feature
priority: P1
created: 2026-07-07
status: pending
stacks_on: 003
---

## Summary
Collaboration needs to show WHO: stamp items with their creator and claimer, and
when an item completes, the server commits the queue change to the project's git
repo authored as the item's CREATOR and pushes to origin when one is configured.
Completion also hands the agent the exact author string for its code commits.

## Scope
- In scope:
  - In hosted mode (authenticated user in context):
    - `create_work_item` writes `created_by: <username>` into frontmatter.
    - `claim_next_item` writes/updates `claimed_by: <username>` in frontmatter of
      the claimed file (edit in place before the move-commit).
  - Server-side git for hosted projects (all queue mutations, not just complete):
    `create_work_item`, `claim_next_item`, `complete_item`, `block_item` each end
    with a `git add`-and-commit in the project tree. Commit author:
    - complete_item: the item's CREATOR — `--author="<username> <email-from-user-registry>"`
    - all other mutations: the ACTING user as author.
    Committer stays the server's git identity; set a repo-local
    `user.name "kanban-agent server"` / `user.email "server@kanban-agent.local"`
    at project creation time (extend 003's create_project).
  - Push on completion: if the project has a `gitUrl` (registry, from 003),
    `complete_item` runs `git push origin HEAD` after the commit. Push failure
    does NOT fail the completion — the item still moves to done; the tool result
    carries `pushed: false` + the git error text.
  - `complete_item`'s result gains `commit_author: "<username> <email>"` (the
    creator) and the scaffolded `WORKER_PROMPT.md` template (attach_workflow)
    gains a rule: "commit your code with `--author` set to the `commit_author`
    returned by complete_item, and push before/with completion".
  - Cockpit parser: expose `created_by`/`claimed_by` in `/api/projects` item
    JSON (frontmatter is already parsed leniently — just include the fields).
  - Local stdio mode: no user in context → no stamps, no server commits (today's
    behaviour, unchanged).
- Out of scope: dashboard rendering of the badges (item 005), signed commits,
  attributing the ims queue retroactively.

## Pointers
- `mcp/core.js` queue tool handlers; `server/lib/projects.js` (003) for repo
  paths + gitUrl; frontmatter helpers shared with the cockpit parser in `server.js`.

## Acceptance criteria (binary, testable)
- [x] Scripted hosted-mode check (fixture data dir; admin creates users `alice`
      (creator) + `bob` (worker) and a project with a local bare repo as
      `git_url`): alice creates item 001; bob claims it (frontmatter shows
      `created_by: alice`, `claimed_by: bob`); bob completes it → `git log` in
      the project tree shows the completion commit AUTHORED by
      `alice <alice's email>`, the claim commit authored by bob, and the bare
      "origin" received the push (done/ file present in a fresh clone of it).
      complete_item result contains `commit_author` = alice.
- [x] Push-failure path: project with unreachable gitUrl → complete_item still
      moves the file to done/ and returns `pushed: false` with an error string.
- [x] `/api/projects` (cockpit, test instance on a 44xx port) shows
      `created_by`/`claimed_by` for the fixture items.
- [x] Local stdio flow on an absolute path still produces NO stamps and NO
      automatic commits (assert `git status` shows only the file moves the tools
      have always made via git mv).
- [x] `node --check` green; no new npm deps.

## Result (worker fills in)
- Commit: e0995ef `feat(attribution): created_by/claimed_by stamps + creator-authored commit and push on completion [work-item 004]`
- What changed: `mcp/core.js` — new `setFrontmatterField` (upsert), `authorString(user)` (empty email → `<username>@kanban-agent.local`), `isHostedProject` (authenticated user + registry-name addressing) and `gitCommitQueue` (add work-items + commit; failure logged, never fatal — queue files stay the source of truth). Hosted mode: `create_work_item` stamps `created_by`, `claim_next_item` stamps `claimed_by`; create/claim/block commit as the ACTING user; `complete_item` commits authored by the item's CREATOR (from `created_by`, email from the user registry), returns `commit_author`, and if the project has a `gitUrl` runs `git push origin HEAD` — push failure keeps the completion and returns `pushed: false` + `push_error`. `server/lib/projects.js` — `create_project` now sets repo-local `user.name "kanban-agent server"` / `user.email "server@kanban-agent.local"` for init AND clone trees. Scaffolded `WORKER_PROMPT.md` gains the commit-with-`--author`-from-`commit_author` rule. `server.js` cockpit parser exposes `createdBy`/`claimedBy` in `/api/projects`. Local stdio: no stamps, no commits, behaviour unchanged.
- Verification output: throwaway `/private/tmp/kanban-004-check.mjs` (cleaned up); MCP HTTP on 4462, cockpit test instance on 4463, `KANBAN_DATA_DIR=/private/tmp/kanban-004-data`, local bare origins under /private/tmp:

```
ok: frontmatter stamped created_by: alice, claimed_by: bob
ok: cockpit /api/projects shows createdBy/claimedBy
ok: complete_item → commit_author = alice <alice@example.com>, pushed: true
ok: git log — create+complete authored by alice, claim by bob, committer = kanban-agent server
ok: fresh clone of the bare origin contains work-items/done/001-*
ok: unreachable origin → item still done, pushed: false, push_error: fatal: '/private/tmp/kanban-004-origin2.git' does not appear to be a git repository
ALL HOSTED CHECKS PASSED
ok: local stdio flow — no created_by/claimed_by stamps, no automatic commits, only the usual file moves
   git status --porcelain:
   ?? work-items/done/001-local-item.md
ALL CHECKS PASSED
```

`node --check` green on all entrypoints; no new npm deps. Port 4400 untouched (tests on 4462/4463, killed by the script); all /private/tmp fixtures removed.
