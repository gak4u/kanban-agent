# Hosted mode — one kanban-agent server for a whole team

Local mode (the default, see the [README](../README.md)) is single-user: the
cockpit reads queues from your filesystem and the MCP server runs over stdio
inside each agent. Hosted mode runs the same code as **one server a team
shares**: projects live on the server, agents connect over HTTP with per-user
tokens, and every queue change is committed — and pushed — with the right
human attached.

## Architecture

```
                       one host (or container)
  ┌──────────────────────────────────────────────────────────────┐
  │  cockpit            server.js            :4400  (reads open) │
  │  MCP over HTTP      server/mcp-http.js   :4401  (Bearer auth)│
  │                                                              │
  │  data/                     ← KANBAN_DATA_DIR, gitignored     │
  │  ├── users.json            user registry (sha256 token hashes)│
  │  ├── projects.json         project registry                  │
  │  └── projects/<name>/      one git working tree per project  │
  │        └── work-items/{pending,in-progress,blocked,done}/    │
  └──────────────────────────────────────────────────────────────┘
        ▲ browser: board + /admin        ▲ each user's agents:
        │ (no token needed to read)      │ claude mcp add --transport http …
```

- **Cockpit (`:4400`)** — the same dashboard as local mode. It lists
  filesystem-configured projects *and* every non-archived project from the
  registry (tagged `server-managed`), and serves the admin panel at `/admin`.
- **MCP over Streamable HTTP (`:4401`, `KANBAN_MCP_PORT`)** — the same tool
  set as the stdio server (`mcp/core.js` is shared), one session per client.
- **Data dir (`data/`, override with `KANBAN_DATA_DIR`)** — everything hosted
  mode owns: both registries and the project trees. It is gitignored; treat it
  as the server's database.

### Auth model

- **Reads are open.** Anyone who can reach the cockpit can watch the boards —
  same as local mode. Don't expose it beyond your network without a proxy.
- **Writes need a token.** Every MCP HTTP request and every `/api/admin/*`
  call carries `Authorization: Bearer <token>`. Tokens are per-user, random
  32-byte hex, stored **only as sha256 hashes** — the plaintext appears exactly
  once, at creation/rotation. Roles: `admin` (user + project management) and
  `member` (queue operations). Revocation is immediate: tokens are re-verified
  against the store on every request.
- **Sessions are user-bound.** An MCP session opened with one user's token
  rejects requests bearing another user's token (403).

### Attribution & push flow

Items carry their humans in frontmatter (`created_by`, stamped on creation;
`claimed_by`, stamped on claim), and every queue mutation on a server-managed
project is committed in that project's git tree. The committer is always the
repo-local server identity (`kanban-agent server <server@kanban-agent.local>`);
`--author` carries the human.

`complete_item` is the interesting one — completion is credited to the item's
**creator**, and the agent is handed the same author string for its code:

```
worker agent          MCP HTTP server           project tree            origin
     │  complete_item(id)   │                        │                    │
     │──────────────────────▶  read created_by ──────▶                    │
     │                       │  fill ## Result, move to done/             │
     │                       │  git commit --author="creator <email>" ───▶│
     │                       │  git push origin HEAD  (if gitUrl) ────────▶
     │◀── result: commit_author, pushed ──────────────│                    │
     │  (agent commits its code with --author=commit_author and pushes)   │
```

Create/claim/block commits are authored by the *acting* user instead. A failed
push never fails the completion — the item still moves to `done/` and the tool
result carries `pushed: false` plus the git error, so the queue never lies
about work that actually finished.

## Team quickstart

On the server (Node ≥ 20, git):

```sh
git clone https://github.com/gak4u/kanban-agent.git && cd kanban-agent
cd mcp && npm install && cd ..

node server/bootstrap.js     # 1. creates data/users.json + the admin user
                             #    → prints the ADMIN TOKEN — shown once, save it
npm start &                  # 2. cockpit on :4400
npm run mcp-http &           # 3. MCP HTTP on :4401
```

Then, as the admin (any MCP client with the admin token, or the `/admin` panel):

```sh
# 4. one user per teammate — each token is returned once
create_user {"username": "alice", "email": "alice@example.com", "role": "member"}

# 5. a server-managed project: clones git_url (or fresh-inits) into
#    data/projects/<name>/ and scaffolds work-items/
create_project {"name": "webshop", "git_url": "git@github.com:acme/webshop.git"}
```

Each teammate registers the shared server with *their* token:

```sh
claude mcp add --transport http kanban-agent http://<server>:4401/mcp \
  --header "Authorization: Bearer <their-token>"
```

From here it's the normal loop, addressed by project **name** instead of path:

- the PM agent verifies requests and writes items —
  `create_work_item {"project": "webshop", …}` (stamped `created_by: pm`),
- workers claim and execute — `claim_next_item {"project": "webshop"}`
  (stamped `claimed_by: worker`),
- completion commits the queue change **authored by the item's creator**,
  pushes to origin when the project has one, and returns `commit_author` so
  the worker's code commits carry the same attribution,
- everyone watches it live on the cockpit: claims strip, user chips,
  server-managed tags.

## Ops notes

- **TLS / exposure**: both ports speak plain HTTP. For anything beyond a
  trusted network, put nginx (or any TLS-terminating reverse proxy) in front
  of `:4400` and `:4401`, and let the proxy do IP allow-listing for the
  cockpit if the boards themselves are sensitive.
- **Backups**: `data/` is the whole state — registries plus the project trees
  (which are ordinary git repos; trees with an origin are also recoverable
  from it). Snapshot the directory, or at minimum `users.json` +
  `projects.json`.
- **Token hygiene**: there is no expiry in v0.2 — rotate with `rotate_token`
  (MCP) or the `/admin` panel; revoke on offboarding. Hashes only on disk, so
  a leaked backup does not leak tokens.
- **Ports**: cockpit `PORT` (default 4400, binds 127.0.0.1 — proxy in front
  for the team), MCP `KANBAN_MCP_PORT` (default 4401, binds 0.0.0.0).
- **Local mode is untouched**: without a `data/` dir nothing here activates;
  `npm start` and the stdio `mcp/server.js` behave exactly as in v0.1.
