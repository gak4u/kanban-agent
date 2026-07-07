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
- [x] Scripted HTTP check with an admin token and a member token
      (KANBAN_DATA_DIR pointed at a /private/tmp fixture): admin
      `create_project` (fresh init) → `data/projects/<name>/work-items/pending`
      exists and the tree is a git repo with ≥1 commit; member `create_project`
      → admin-required error; member `create_work_item`/`claim_next_item`/
      `complete_item` by project NAME work end-to-end; `queue_status` by name
      matches; `archive_project` hides it from `list_projects`.
- [x] `create_user` via MCP (admin) returns a token that immediately works on the
      HTTP transport; `revoke_user` kills it.
- [x] Local stdio mode with absolute `project_path` still passes the pre-existing
      end-to-end flow (attach → create → claim → status on a /private/tmp git
      fixture) unchanged.
- [x] `node --check` green; no new npm deps; nothing under `data/` tracked by git.

## Result (worker fills in)
- Commit: 89d69e2 `feat(hosted): server-managed projects + admin MCP tools [work-item 003]`
- What changed: New `server/lib/projects.js` — registry at `data/projects.json` (`{name, gitUrl, createdBy, createdAt, archived}`), projects live at `data/projects/<name>/` as git working trees (`git clone` when `git_url` given, else `git init` + initial commit with an explicit kanban-agent committer identity), name rules `[a-z0-9-_]{2,32}`, atomic temp+rename writes, `archiveProject` only flips the flag. `mcp/core.js` — five new ADMIN tools wired into the 002 factory (`create_project` → registry + tree + existing `attach_workflow` scaffold, `archive_project`, `create_user` / `revoke_user` / `rotate_token` returning one-time tokens in the tool result); `requireAdmin(context)` gives members "admin required" and stdio (null user) "hosted mode only"; all eight queue tools now resolve either absolute `project_path` (local, unchanged) or the new `project` registry-name arg via `resolveProjectDir`; `list_projects` returns the non-archived registry in hosted mode; schemas updated (`project` prop added, `project_path` no longer in `required`).
- Verification output: throwaway `/private/tmp/kanban-003-check.mjs` (cleaned up), HTTP on test port 4461, `KANBAN_DATA_DIR=/private/tmp/kanban-003-data`:

```
ok: create_user via MCP → token works on the HTTP transport immediately
ok: admin create_project → scaffolded git tree at data/projects/demo-app (1 commit)
ok: member create_project denied: Error: admin required — user "dave" has role "member"
ok: member create_work_item → claim → complete → queue_status by project NAME
ok: archive_project hides the project from list_projects and name resolution (files kept)
ok: revoke_user via MCP → member token now 401
ALL HOSTED CHECKS PASSED
ok: stdio attach → create → claim → status via absolute project_path unchanged
ok: admin tool over stdio → Error: hosted mode only — this tool needs an authenticated admin (serve via server/mcp-http.js)
ALL CHECKS PASSED
```

`node --check` green on `server.js`, `mcp/server.js`, `mcp/core.js`, `server/mcp-http.js`, `server/lib/{users,projects}.js`, `server/bootstrap.js`. No new npm deps. `git ls-files data` → empty (nothing under data/ tracked). Fixtures under /private/tmp removed.
