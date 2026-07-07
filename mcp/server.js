#!/usr/bin/env node
// kanban-agent MCP server — stdio transport (local single-user mode).
// All tools/prompts live in ./core.js; this entrypoint just wires them to
// stdio with no authenticated user. Hosted HTTP mode: ../server/mcp-http.js.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './core.js';

await buildServer({ user: null }).connect(new StdioServerTransport());
console.error('kanban-agent MCP server running (stdio)');
