# Design

Two small programs share one convention ([convention.md](convention.md)): the
cockpit reads queues, the MCP server writes them. Anything the MCP server
writes shows up on the board immediately because both sides parse identically.

## Cockpit (`server.js` + `public/`)

A zero-dependency Node server (`node:http` / `node:fs` / `node:path` only —
no npm packages, no build step) serving a static `public/` (plain JS/CSS, no
framework) and a small JSON API.

### Config and discovery

- `projects.json` at the repo root, gitignored. On first start it is seeded
  from `projects.example.json` (which points at the bundled demo project), so
  a fresh clone renders a populated board. `PROJECTS_CONFIG` overrides the
  path; relative paths inside the config resolve against the config file's
  directory.
- Two sources of projects, deduped by absolute path: an explicit `projects`
  list, and `autoDiscoverRoots` — every direct child of a root that contains
  a `work-items/` dir with at least one status subfolder is picked up
  automatically. Project names are made unique (`name-2`, …) because names
  key `/api/item` lookups.

### Parsing

Hand-rolled and deliberately lenient, mirroring the convention:

- Frontmatter: simple `key: value` lines between `---` fences; anything else
  is skipped. A malformed file never throws — it falls back to
  filename-derived id/title and is flagged `parseError`.
- The folder is the authoritative status; frontmatter `status` is reported so
  the UI can flag it when stale.
- Derived per item: checkbox progress (`- [x]` vs `- [ ]` across the file),
  first paragraph of `## Summary`, `## Blocked` section text, file mtime.
- The markdown renderer is minimal (headings, bold, code spans/fences, nested
  lists, checkboxes) and **all file content is HTML-escaped before any markup
  is applied** — queue files are untrusted input.

### API

- `GET /api/projects` — every project with parsed item summaries per status.
- `GET /api/item?project=&status=&file=` — one item, raw + rendered.
  `file` must match `NNN-*.md`, contain no path separators, and resolve
  strictly inside that project's status folder — traversal is rejected.
- `GET /api/events` — SSE. The server `fs.watch`es each project's
  `work-items/` and status folders, debounces bursts (editors fire several
  events per save), and emits `refresh`; the client falls back to 10-second
  polling when SSE fails. A 30-second rescan picks up projects that appear
  under auto-discover roots after startup.

The server binds to 127.0.0.1 and is read-only by design: v1 never moves or
edits item files. Writing belongs to the agents (the claim protocol is *their*
lock) and to the MCP server.

## MCP server (`mcp/server.js`)

Stdio transport; sole dependency `@modelcontextprotocol/sdk`. Exposes 8 tools
(`attach_workflow`, `queue_status`, `create_work_item`, `claim_next_item`,
`complete_item`, `block_item`, `get_item`, `list_projects`) and 2 prompts
(`worker-loop`, `pm-write-items`).

Key decisions:

- **Same parsing as the cockpit** — the lenient frontmatter splitter and the
  folder-is-authoritative rule are duplicated verbatim rather than shared, to
  keep each program a single self-contained file.
- **`git mv` when possible.** Moves use `git mv` when the project is a git
  repo (that is the claim lock) and fall back to `fs.renameSync` (e.g. a file
  not yet tracked is still a valid claim).
- **Confined writes.** Every write path is resolved and must stay inside
  `<project_path>/work-items/`; item ids must match `\d{1,6}`; generated
  filenames must match `NNN-*.md`. The single exception is `attach_workflow`
  appending a `## Work-item queue` section to the project's `CLAUDE.md` /
  `AGENTS.md`.
- **Idempotent scaffolding.** `attach_workflow` never overwrites an existing
  file or re-appends the instructions section; it returns a created/skipped
  report. Scaffolded content (`README.md`, `_TEMPLATE.md`,
  `WORKER_PROMPT.md`) is generic, parameterized by an optional
  `verify_command` and `app_url`, which are recorded in `WORKER_PROMPT.md`
  frontmatter and read back by `create_work_item` for its two standard
  trailing acceptance criteria.
- **Expected errors are messages, not stacks.** Validation failures throw a
  flagged error that is returned as a plain tool error; only unexpected
  errors are logged.
