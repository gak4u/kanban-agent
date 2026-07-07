---
id: 003
title: Server-managed projects + admin MCP tools (create/manage projects & users)
type: feature
priority: P1
created: 2026-07-07
status: pending
stacks_on: 002
---

## Summary
In hosted mode, projects live on the server and are managed by the admin: a project
registry, a per-project git working tree under the data dir, and admin-only MCP
tools for project + user management. Members operate queues by project NAME instead
of absolute paths.

## Scope
- In scope:
  - `server/lib/projects.js`: registry at `data/projects.json`
    (`{ projects: [{ name, gitUrl?, createdBy, createdAt, archived }] }`); each
    project is a git working tree at `data/projects/<name>/` — `create_project`
    clones `gitUrl` when given, else `git init` + initial commit; then runs the
    existing attach_workflow scaffold on it. Name rules like usernames.
  - New MCP tools (wired into the factory from 002):
    - `create_project({name, git_url?})` — ADMIN only
    - `archive_project({name})` — ADMIN only (sets archived, hides from lists;
      never deletes files)
    - `create_user({username, email, role})` — ADMIN only, returns the one-time
      token in the tool result
    - `revoke_user({username})`, `rotate_token({username})` — ADMIN only
    - Non-admin callers get a clear "admin required" error. In stdio/local mode
      (context.user null) admin tools error with "hosted mode only".
  - Existing queue tools (`queue_status`, `create_work_item`, `claim_next_item`,
    `complete_item`, `block_item`, `get_item`, `attach_workflow`, `list_projects`)
    accept EITHER the existing absolute `project_path` (local mode, unchanged)
    OR a `project` name resolved through the registry (hosted mode).
    `list_projects` in hosted mode lists the registry (non-archived).
- Out of scope: attribution fields (item 004), dashboard/admin UI (item 005),
  per-project ACLs (all members see all projects in v0.2).

## Pointers
- `mcp/core.js` (from 002), `mcp/server.js` attach/scaffold + queue helpers,
  `server/lib/users.js` (001).

## Acceptance criteria (binary, testable)
- [ ] Scripted HTTP check with an admin token and a member token
      (KANBAN_DATA_DIR pointed at a /private/tmp fixture): admin
      `create_project` (fresh init) → `data/projects/<name>/work-items/pending`
      exists and the tree is a git repo with ≥1 commit; member `create_project`
      → admin-required error; member `create_work_item`/`claim_next_item`/
      `complete_item` by project NAME work end-to-end; `queue_status` by name
      matches; `archive_project` hides it from `list_projects`.
- [ ] `create_user` via MCP (admin) returns a token that immediately works on the
      HTTP transport; `revoke_user` kills it.
- [ ] Local stdio mode with absolute `project_path` still passes the pre-existing
      end-to-end flow (attach → create → claim → status on a /private/tmp git
      fixture) unchanged.
- [ ] `node --check` green; no new npm deps; nothing under `data/` tracked by git.

## Result (worker fills in)
- Commit:
- What changed:
- Verification output:
