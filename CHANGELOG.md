# Changelog

## 0.2.0 — 2026-07-07

Hosted multi-user mode: one kanban-agent server for a whole team. Local
single-user mode (filesystem cockpit + stdio MCP) is unchanged.

- **User registry + API tokens** (`server/lib/users.js`, `server/bootstrap.js`):
  roles `admin`/`member`; random 32-byte hex tokens stored only as sha256
  hashes and shown exactly once; create / verify / revoke / rotate.
- **MCP over Streamable HTTP** (`server/mcp-http.js`, `npm run mcp-http`,
  `:4401`): the stdio tool set served session-per-client with per-user
  `Authorization: Bearer` auth; the shared factory lives in `mcp/core.js`
  (`mcp/server.js` stays the unchanged stdio entrypoint).
- **Server-managed projects + admin tools** (`server/lib/projects.js`):
  registry at `data/projects.json` with one git working tree per project under
  `data/projects/<name>/`; admin-only MCP tools `create_project`,
  `archive_project`, `create_user`, `revoke_user`, `rotate_token`; queue tools
  accept a hosted `project` name alongside the local `project_path`.
- **Attribution + git push on completion**: items are stamped
  `created_by`/`claimed_by`; every hosted queue mutation is committed in the
  project tree (committer: the server; `--author`: the human);
  `complete_item` commits as the item's **creator**, pushes `origin HEAD` when
  the project has a remote (push failure never fails the completion), and
  returns `commit_author` for the agent's own code commits.
- **Dashboard**: server-managed projects listed from the registry (tagged),
  creator/claimer chips with a prominent claimer on in-progress cards, an
  active-claims strip on the overview, and an `/admin` panel (users +
  projects, one-time token reveal) backed by admin-only `/api/admin/*`
  endpoints. Board reads stay unauthenticated.
- **Docs**: `docs/hosted.md` — architecture, team quickstart,
  attribution/push flow, ops notes.

## 0.1.0

Initial public release: the work-item queue convention (`docs/convention.md`),
the zero-dependency live cockpit (`server.js` + `public/`), and the stdio MCP
server (`mcp/`) that scaffolds and operates queues.
