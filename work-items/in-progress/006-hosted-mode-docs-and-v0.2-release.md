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
- [ ] `grep -riE 'bytee|anil|open\.guru' .` (excluding node_modules, .git, data)
      → zero hits on the tree being pushed; work-items/ queue files included in
      the sweep.
- [ ] Pushed; `git log origin/main` contains items 001–006 commits; tag v0.2.0
      pushed.
- [ ] Fresh clone in /private/tmp: local mode works (cockpit on a 44xx port
      serves demo project; stdio tools/list = 8 tools + admin tools per 003's
      wiring decision — assert the actual expected count); hosted mode works
      (bootstrap → mcp-http on a test port → admin creates a project via HTTP
      MCP → queue_status by name). Clone removed afterwards.
- [ ] Local production cockpit on :4400 still serving the real config, untouched.

## Result (worker fills in)
- Commit:
- What changed:
- Verification output:
