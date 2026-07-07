#!/usr/bin/env node
// kanban-agent hosted MCP — the stdio tool set served over the MCP Streamable
// HTTP transport at POST/GET/DELETE /mcp, one transport+server per session.
// Every request must carry `Authorization: Bearer <token>` resolving to a user
// in data/users.json (see bootstrap.js / lib/users.js); the resolved user is
// attached to the session's context so tools can read who is calling.
// No TLS here — put nginx (or any TLS-terminating proxy) in front for teams.

import http from 'node:http';
import crypto from 'node:crypto';
import { buildServer, StreamableHTTPServerTransport, isInitializeRequest } from '../mcp/core.js';
import { verifyToken } from './lib/users.js';

const PORT = Number(process.env.KANBAN_MCP_PORT) || 4401;
const HOST = '0.0.0.0'; // team server — reachable beyond localhost
const MAX_BODY = 4 * 1024 * 1024;

const sessions = new Map(); // sessionId -> { transport, username }

function sendRpcError(res, status, code, message) {
  const headers = { 'Content-Type': 'application/json' };
  if (status === 401) headers['WWW-Authenticate'] = 'Bearer';
  res.writeHead(status, headers);
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
}

function bearerToken(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  return m ? m[1].trim() : null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/mcp') return sendRpcError(res, 404, -32000, 'not found — the MCP endpoint is /mcp');
  if (!['POST', 'GET', 'DELETE'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, POST, DELETE' });
    return res.end();
  }

  // Auth first: every request, every method. verifyToken re-reads the store,
  // so revocation takes effect immediately.
  const token = bearerToken(req);
  const user = token ? verifyToken(token) : null;
  if (!user) return sendRpcError(res, 401, -32001, 'Unauthorized: missing, invalid or revoked Bearer token');

  const sessionId = req.headers['mcp-session-id'] ? String(req.headers['mcp-session-id']) : null;
  let session = null;
  if (sessionId) {
    session = sessions.get(sessionId);
    if (!session) return sendRpcError(res, 404, -32001, 'unknown or expired mcp-session-id');
    if (session.username !== user.username) {
      return sendRpcError(res, 403, -32001, 'Forbidden: session belongs to a different user');
    }
  }

  if (req.method === 'POST') {
    let body;
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : undefined;
    } catch (err) {
      return sendRpcError(res, 400, -32700, `parse error: ${err.message}`);
    }
    if (session) return session.transport.handleRequest(req, res, body);
    if (!isInitializeRequest(body)) {
      return sendRpcError(res, 400, -32000, 'no session — the first request must be initialize');
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sid) => sessions.set(sid, { transport, username: user.username }),
      onsessionclosed: (sid) => sessions.delete(sid),
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await buildServer({ user }).connect(transport);
    return transport.handleRequest(req, res, body);
  }

  // GET (server→client SSE stream) and DELETE (session termination)
  if (!session) return sendRpcError(res, 400, -32000, 'mcp-session-id header required');
  return session.transport.handleRequest(req, res);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(`[mcp-http] ${req.method} ${req.url}: ${err.stack || err}`);
    if (!res.headersSent) sendRpcError(res, 500, -32603, 'internal error');
    else res.end();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`kanban-agent MCP (Streamable HTTP) → http://${HOST}:${PORT}/mcp`);
  console.log('Auth: Authorization: Bearer <token>  (create users via server/bootstrap.js + lib/users.js)');
});
