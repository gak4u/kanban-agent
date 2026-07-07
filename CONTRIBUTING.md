# Contributing

Thanks for considering a contribution!

## Dev setup

```sh
git clone https://github.com/gak4u/kanban-agent.git
cd kanban-agent
npm start                 # cockpit on http://localhost:4400 (demo board)
cd mcp && npm install     # only the MCP server has a dependency
```

There is no build step and no framework — the cockpit is one `server.js` on
Node built-ins plus plain JS/CSS in `public/`, and the MCP server is one
`mcp/server.js`.

## Guidelines

- **Keep the dependency count where it is**: zero for the cockpit, one
  (`@modelcontextprotocol/sdk`) for the MCP server.
- Both programs implement [docs/convention.md](docs/convention.md). If a
  change affects parsing or the claim protocol, update the convention doc and
  keep the cockpit and MCP server consistent with each other.
- Queue files are untrusted input: parse leniently (a malformed file must
  never crash anything) and HTML-escape all file content before rendering.
- Manual verification for now (no test suite yet): exercise the cockpit
  against `examples/demo-project` and drive the MCP server over stdio
  (initialize → tools/list → tools/call) against a scratch project.
- Small, focused PRs with a clear description of what changed and how you
  verified it.

## Reporting issues

Open a GitHub issue with what you expected, what happened, and a minimal
reproduction (a tiny `work-items/` tree is usually enough).
