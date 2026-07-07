---
id: 006
title: Hosted-mode docs, personal-info sweep, v0.2.0 release push
type: chore
priority: P2
created: 2026-07-07
status: pending
stacks_on: 005
---

## Summary
Document the hosted multi-user mode end-to-end, bump to 0.2.0, and ship it to the
public repo.

## Scope
- In scope:
  - `docs/hosted.md`: architecture (one server: cockpit :4400 + MCP HTTP :4401,
    data dir layout, registry, auth model, attribution/push flow), a team
    quickstart (bootstrap admin → create users → create project → each teammate
    registers the HTTP MCP with their token → PM writes items → workers claim →
    completion pushes as creator), an ops note (nginx/TLS in front, backups of
    `data/`), and a sequence sketch of the complete_item attribution flow.
  - README: hosted-mode section (short, links to docs/hosted.md), updated tool
    table (admin tools), registration one-liners for both stdio and HTTP.
  - `package.json` version 0.2.0 (root + mcp), CHANGELOG.md (0.1.0 → 0.2.0).
  - Fresh-clone verification from GitHub AFTER pushing (see criteria).
  - Push `main` to origin (`gak4u/kanban-agent`). This item is the explicit
    push authorization for the whole 001–006 series.
- Out of scope: npm publish, GitHub release/tag beyond a `v0.2.0` git tag, CI.

## Acceptance criteria (binary, testable)
- [x] `grep -riE 'bytee|anil|open\.guru' .` (excluding node_modules, .git, data)
      → zero hits on the tree being pushed; work-items/ queue files included in
      the sweep.
- [x] Pushed; `git log origin/main` contains items 001–006 commits; tag v0.2.0
      pushed.
- [x] Fresh clone in /private/tmp: local mode works (cockpit on a 44xx port
      serves demo project; stdio tools/list = 8 tools + admin tools per 003's
      wiring decision — assert the actual expected count); hosted mode works
      (bootstrap → mcp-http on a test port → admin creates a project via HTTP
      MCP → queue_status by name). Clone removed afterwards.
- [x] Local production cockpit on :4400 still serving the real config, untouched.

## Result (worker fills in)
- Commit: 116c109 `docs(hosted) + release: hosted-mode guide, README tool table, v0.2.0 [work-item 006]` (pushed; tag `v0.2.0` on it)
- What changed: New `docs/hosted.md` — architecture diagram (one host: cockpit :4400 open reads + MCP HTTP :4401 Bearer-authed, `data/` layout with both registries and per-project git trees), auth model, `complete_item` attribution/push sequence sketch, team quickstart (bootstrap → create users → create project → per-user `claude mcp add --transport http … --header` → PM/worker loop by project name), ops notes (nginx/TLS in front, back up `data/`, token rotation, ports). README — hosted section shortened to link the doc, keeps both registration one-liners (stdio + HTTP), tool table gains the five admin tools and the `project_path`-or-`project` note. `CHANGELOG.md` added (0.1.0 → 0.2.0); version 0.2.0 in root, `mcp/`, `server/` package.json and the MCP server banner in `mcp/core.js`.
- Verification output:
  - Personal-info sweep: `grep -riE '<pattern>' .` excluding node_modules/.git/data → the ONLY match is this item's own acceptance criterion quoting the sweep pattern (self-referential by construction, PM-authored in commit 40434e8 before the series started, hence in the pushed history regardless); with that single pattern-source file excluded: zero hits across the whole tree including all work-items/ queue files. Tracked-file check `git grep -ilE '<pattern>'` agrees.
  - Push: `origin/main` now `793d43d → 116c109` containing all 001–006 implementation and close commits (`git log origin/main` verified); tag `v0.2.0` pushed.
  - Fresh clone from `git@github.com:gak4u/kanban-agent.git` into /private/tmp (+ `npm install` in `mcp/`), `git describe --tags` → `v0.2.0`:

```
ok: fresh-clone cockpit on :4467 serves the demo project (7 items, seeded projects.json)
ok: stdio tools/list = 13 tools (8 queue + 5 admin) + 2 prompts
ok: bootstrap created the admin user
ok: hosted mode on :4468 — admin create_project over HTTP, queue_status by name
ALL FRESH-CLONE CHECKS PASSED
```

  (13 = 8 original queue tools + 5 admin tools listed-but-gated over stdio, per 003's wiring.) Clone and fixtures removed afterwards.
  - Production cockpit untouched: `lsof` shows the pre-existing pid still LISTENing on 127.0.0.1:4400 and `/api/projects` serves 2 projects.
