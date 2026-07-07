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
- [ ] Scripted hosted-mode check (fixture data dir; admin creates users `alice`
      (creator) + `bob` (worker) and a project with a local bare repo as
      `git_url`): alice creates item 001; bob claims it (frontmatter shows
      `created_by: alice`, `claimed_by: bob`); bob completes it → `git log` in
      the project tree shows the completion commit AUTHORED by
      `alice <alice's email>`, the claim commit authored by bob, and the bare
      "origin" received the push (done/ file present in a fresh clone of it).
      complete_item result contains `commit_author` = alice.
- [ ] Push-failure path: project with unreachable gitUrl → complete_item still
      moves the file to done/ and returns `pushed: false` with an error string.
- [ ] `/api/projects` (cockpit, test instance on a 44xx port) shows
      `created_by`/`claimed_by` for the fixture items.
- [ ] Local stdio flow on an absolute path still produces NO stamps and NO
      automatic commits (assert `git status` shows only the file moves the tools
      have always made via git mv).
- [ ] `node --check` green; no new npm deps.

## Result (worker fills in)
- Commit:
- What changed:
- Verification output:
