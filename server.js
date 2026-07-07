#!/usr/bin/env node
// Kanban Agent cockpit — zero-dependency server (node:http / node:fs / node:path only).
// Serves public/ and a small JSON API over the file-based work-item queues
// described in docs/convention.md. Read-only: never writes to tracked projects.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 4400;
// PROJECTS_CONFIG lets tests point at an alternate config without touching the shipped one.
const DEFAULT_CONFIG_PATH = path.join(ROOT, 'projects.json');
const CONFIG_PATH = process.env.PROJECTS_CONFIG || DEFAULT_CONFIG_PATH;
// Relative paths in the config resolve against the config file's directory,
// so the shipped example can point at examples/demo-project.
const CONFIG_DIR = path.dirname(path.resolve(CONFIG_PATH));
// Hosted mode (items 001/003): server-managed projects live under the data
// dir. When data/projects.json is absent the cockpit is purely local — none
// of the hosted paths below activate.
const DATA_DIR = process.env.KANBAN_DATA_DIR || path.join(ROOT, 'data');
const REGISTRY_PATH = path.join(DATA_DIR, 'projects.json');
const MANAGED_PROJECTS_DIR = path.join(DATA_DIR, 'projects');

// First run: seed projects.json from the example so a fresh clone shows the
// demo board immediately. Only the default location — an explicit
// PROJECTS_CONFIG pointing at a missing file stays an error.
if (CONFIG_PATH === DEFAULT_CONFIG_PATH && !fs.existsSync(CONFIG_PATH)) {
  const example = path.join(ROOT, 'projects.example.json');
  try {
    fs.copyFileSync(example, CONFIG_PATH);
    console.log(`[config] no projects.json found — created one from projects.example.json.`);
    console.log(`[config] Edit ${CONFIG_PATH} to track your own projects.`);
  } catch (err) {
    console.error(`[config] cannot seed ${CONFIG_PATH} from ${example}: ${err.message}`);
  }
}

const STATUSES = ['pending', 'in-progress', 'blocked', 'done'];
// Work items are NNN-slug.md; anything else (README, _TEMPLATE, …) is ignored.
// No path separators allowed — this same regex guards /api/item against traversal.
const ITEM_RE = /^\d+-[^/\\]*\.md$/;

// ---------------------------------------------------------------------------
// Config + project discovery
// ---------------------------------------------------------------------------

function loadConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return {
      projects: Array.isArray(cfg.projects) ? cfg.projects.filter((p) => p && p.path) : [],
      autoDiscoverRoots: Array.isArray(cfg.autoDiscoverRoots) ? cfg.autoDiscoverRoots : [],
    };
  } catch (err) {
    console.error(`[config] cannot read ${CONFIG_PATH}: ${err.message}`);
    return { projects: [], autoDiscoverRoots: [] };
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// A directory qualifies as a tracked project if it has work-items/ with at
// least one of the four status folders.
function hasQueue(projectDir) {
  const wi = path.join(projectDir, 'work-items');
  return isDir(wi) && STATUSES.some((s) => isDir(path.join(wi, s)));
}

// Non-archived projects from the hosted registry (written by
// server/lib/projects.js), shown alongside the filesystem-configured ones.
function registryProjects() {
  let reg;
  try {
    reg = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  } catch {
    return []; // no registry → local-only mode
  }
  if (!Array.isArray(reg.projects)) return [];
  return reg.projects
    .filter((p) => p && p.name && !p.archived)
    .map((p) => ({
      name: String(p.name),
      path: path.join(MANAGED_PROJECTS_DIR, String(p.name)),
      discovered: false,
      managed: true,
    }));
}

function resolveProjects() {
  const cfg = loadConfig();
  const byPath = new Map();
  const out = [];

  for (const p of cfg.projects) {
    const abs = path.resolve(CONFIG_DIR, String(p.path));
    if (byPath.has(abs)) continue;
    const proj = { name: String(p.name || path.basename(abs)), path: abs, discovered: false, managed: false };
    byPath.set(abs, proj);
    out.push(proj);
  }

  for (const proj of registryProjects()) {
    if (byPath.has(proj.path)) continue;
    byPath.set(proj.path, proj);
    out.push(proj);
  }

  for (const root of cfg.autoDiscoverRoots) {
    const absRoot = path.resolve(CONFIG_DIR, String(root));
    let entries = [];
    try {
      entries = fs.readdirSync(absRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const abs = path.join(absRoot, e.name);
      if (byPath.has(abs) || !hasQueue(abs)) continue;
      const proj = { name: e.name, path: abs, discovered: true, managed: false };
      byPath.set(abs, proj);
      out.push(proj);
    }
  }

  // Names key /api/item lookups — make them unique.
  const names = new Set();
  for (const proj of out) {
    let name = proj.name;
    for (let i = 2; names.has(name); i++) name = `${proj.name}-${i}`;
    proj.name = name;
    names.add(name);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Item parsing (lenient: any field may be missing, malformed files never throw)
// ---------------------------------------------------------------------------

function splitFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (!/^---\s*$/.test(lines[0] || '')) return { fields: {}, body: text };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) {
      close = i;
      break;
    }
  }
  if (close === -1) return { fields: {}, body: text };
  const fields = {};
  for (let i = 1; i < close; i++) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(lines[i]);
    if (!m) continue; // lenient: skip lines that aren't simple key: value
    fields[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return { fields, body: lines.slice(close + 1).join('\n') };
}

// Text of a `## <name>` section, up to the next heading.
function sectionText(body, name) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^#{1,6}\\s+${name}\\b`, 'i').test(l));
  if (start === -1) return null;
  const buf = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i])) break;
    buf.push(lines[i]);
  }
  const text = buf.join('\n').trim();
  return text || null;
}

function firstParagraph(text) {
  if (!text) return null;
  const para = text.split(/\r?\n\s*\r?\n/)[0];
  return para.replace(/\s+/g, ' ').trim() || null;
}

function parseItem(status, dir, file) {
  const numMatch = /^(\d+)-/.exec(file);
  const item = {
    file,
    status,
    number: numMatch ? parseInt(numMatch[1], 10) : null,
    id: numMatch ? numMatch[1] : file.replace(/\.md$/i, ''),
    title: file.replace(/^\d+-/, '').replace(/\.md$/i, '').replace(/[-_]+/g, ' '),
    type: null,
    priority: null,
    created: null,
    stacksOn: null,
    dependsOn: null,
    createdBy: null,
    claimedBy: null,
    needsMigration: false,
    checks: { done: 0, total: 0 },
    summary: null,
    blockedNote: null,
    mtime: null,
    parseError: false,
  };
  const filePath = path.join(dir, file);
  try {
    item.mtime = fs.statSync(filePath).mtimeMs;
  } catch {}
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  } catch {
    item.parseError = true;
    return item;
  }
  try {
    const { fields, body } = splitFrontmatter(text);
    if (fields.id) item.id = String(fields.id);
    if (fields.title) item.title = fields.title;
    if (fields.type) item.type = fields.type;
    if (fields.priority) item.priority = fields.priority;
    if (fields.created) item.created = fields.created;
    if (fields.stacks_on) item.stacksOn = fields.stacks_on;
    if (fields.depends_on) item.dependsOn = fields.depends_on;
    if (fields.created_by) item.createdBy = fields.created_by;
    if (fields.claimed_by) item.claimedBy = fields.claimed_by;
    if (fields.needs_migration) item.needsMigration = /^(true|yes|1)$/i.test(fields.needs_migration);
    // fields.status is deliberately ignored: the folder is authoritative.
    item.checks = {
      done: (text.match(/^\s*[-*]\s+\[[xX]\]/gm) || []).length,
      total: (text.match(/^\s*[-*]\s+\[[ xX]\]/gm) || []).length,
    };
    item.summary = firstParagraph(sectionText(body, 'Summary'));
    item.blockedNote = sectionText(body, 'Blocked');
  } catch {
    item.parseError = true;
  }
  return item;
}

function scanProject(proj) {
  const items = {};
  const counts = {};
  for (const status of STATUSES) {
    const dir = path.join(proj.path, 'work-items', status);
    let list = [];
    try {
      list = fs
        .readdirSync(dir)
        .filter((f) => ITEM_RE.test(f))
        .map((f) => parseItem(status, dir, f));
    } catch {}
    list.sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.file.localeCompare(b.file));
    if (status === 'done') list.reverse(); // newest finished on top
    items[status] = list;
    counts[status] = list.length;
  }
  return {
    name: proj.name,
    path: proj.path,
    discovered: proj.discovered,
    managed: proj.managed || false,
    exists: hasQueue(proj.path),
    counts,
    total: STATUSES.reduce((n, s) => n + counts[s], 0),
    items,
  };
}

// ---------------------------------------------------------------------------
// Minimal markdown renderer (headings, bold, lists, checkboxes, code) — all
// file content is HTML-escaped before any markup is applied.
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderInline(escaped) {
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function renderListItem(text) {
  const box = /^\[([ xX])\]\s*(.*)$/.exec(text);
  if (box) {
    const checked = box[1] !== ' ' ? ' checked' : '';
    return `<label class="md-check"><input type="checkbox" disabled${checked}> <span>${renderInline(escapeHtml(box[2]))}</span></label>`;
  }
  return renderInline(escapeHtml(text));
}

// Parses a run of list lines (with indent-based nesting and hanging-indent
// continuations) starting at `start`; returns the HTML and the next index.
function renderList(lines, start) {
  const flat = [];
  let i = start;
  while (i < lines.length) {
    const m = /^([ \t]*)([-*]|\d+[.)])\s+(.*)$/.exec(lines[i]);
    if (m) {
      flat.push({
        indent: m[1].replace(/\t/g, '  ').length,
        ordered: /^\d/.test(m[2]),
        text: m[3],
      });
      i++;
    } else if (flat.length && /^[ \t]+\S/.test(lines[i]) && !/^\s*```/.test(lines[i])) {
      flat[flat.length - 1].text += ' ' + lines[i].trim();
      i++;
    } else {
      break;
    }
  }
  let html = '';
  const stack = []; // open lists: {indent, tag}
  for (const it of flat) {
    while (stack.length && it.indent < stack[stack.length - 1].indent) {
      html += `</li></${stack.pop().tag}>`;
    }
    if (!stack.length || it.indent > stack[stack.length - 1].indent) {
      const tag = it.ordered ? 'ol' : 'ul';
      html += `<${tag}><li>${renderListItem(it.text)}`;
      stack.push({ indent: it.indent, tag });
    } else {
      html += `</li><li>${renderListItem(it.text)}`;
    }
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`;
  return { html, next: i };
}

function renderMarkdown(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++; // closing fence
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      out.push(`<h${h[1].length}>${renderInline(escapeHtml(h[2]))}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }
    if (/^[ \t]*([-*]|\d+[.)])\s+/.test(line)) {
      const list = renderList(lines, i);
      out.push(list.html);
      i = list.next;
      continue;
    }
    const buf = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6})\s/.test(lines[i]) && !/^[ \t]*([-*]|\d+[.)])\s+/.test(lines[i]) && !/^\s*```/.test(lines[i])) {
      buf.push(lines[i++]);
    }
    out.push(`<p>${renderInline(escapeHtml(buf.join(' ')))}</p>`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function apiProjects(res) {
  const projects = [];
  for (const proj of resolveProjects()) {
    try {
      projects.push(scanProject(proj));
    } catch (err) {
      projects.push({ name: proj.name, path: proj.path, discovered: proj.discovered, exists: false, error: err.message, counts: {}, total: 0, items: {} });
    }
  }
  sendJson(res, 200, { generatedAt: Date.now(), projects });
}

function apiItem(url, res) {
  const name = url.searchParams.get('project') || '';
  const status = url.searchParams.get('status') || '';
  const file = url.searchParams.get('file') || '';

  if (!STATUSES.includes(status)) return sendJson(res, 400, { error: 'invalid status' });
  if (!ITEM_RE.test(file) || file !== path.basename(file) || file.includes('..')) {
    return sendJson(res, 400, { error: 'invalid file name' });
  }
  const proj = resolveProjects().find((p) => p.name === name);
  if (!proj) return sendJson(res, 404, { error: 'unknown project' });

  const dir = path.join(proj.path, 'work-items', status);
  const filePath = path.resolve(dir, file);
  if (!filePath.startsWith(dir + path.sep)) return sendJson(res, 400, { error: 'invalid path' });
  if (!fs.existsSync(filePath)) return sendJson(res, 404, { error: 'item not found' });

  const item = parseItem(status, dir, file);
  let raw = '';
  let body = '';
  let frontmatter = {};
  try {
    raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
    const split = splitFrontmatter(raw);
    frontmatter = split.fields;
    body = split.body;
  } catch {}
  sendJson(res, 200, { ...item, project: name, frontmatter, raw, html: renderMarkdown(body) });
}

// ---------------------------------------------------------------------------
// Admin API (hosted mode) — token-gated writes; the board itself stays
// unauthenticated read-only. The user/project stores are ES modules, so this
// CommonJS server pulls them in via cached dynamic import().
// ---------------------------------------------------------------------------

const libCache = new Map(); // repo-relative path -> import() promise
function adminLib(rel) {
  if (!libCache.has(rel)) libCache.set(rel, import(pathToFileURL(path.join(ROOT, rel)).href));
  return libCache.get(rel);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
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

async function apiAdmin(req, res, url) {
  const users = await adminLib('server/lib/users.js');
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  const user = m ? users.verifyToken(m[1].trim()) : null;
  if (!user) return sendJson(res, 401, { error: 'unauthorized: missing, invalid or revoked token' });
  if (user.role !== 'admin') {
    return sendJson(res, 403, { error: `admin required — "${user.username}" has role "${user.role}"` });
  }

  let body = {};
  if (req.method === 'POST') {
    try {
      body = JSON.parse((await readBody(req)) || '{}');
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON body' });
    }
  }

  try {
    switch (`${req.method} ${url.pathname}`) {
      case 'GET /api/admin/users':
        return sendJson(res, 200, { users: users.listUsers() });
      case 'POST /api/admin/users':
        // {user, token} — the only time the token is ever visible
        return sendJson(res, 200, users.createUser({ username: body.username, email: body.email || '', role: body.role }));
      case 'POST /api/admin/users/revoke':
        return sendJson(res, 200, { user: users.revokeUser(String(body.username || '')) });
      case 'POST /api/admin/users/rotate':
        return sendJson(res, 200, { username: String(body.username || ''), token: users.rotateToken(String(body.username || '')) });
      case 'GET /api/admin/projects': {
        const registry = await adminLib('server/lib/projects.js');
        return sendJson(res, 200, { projects: registry.listRegistry({ includeArchived: true }) });
      }
      case 'POST /api/admin/projects': {
        const registry = await adminLib('server/lib/projects.js');
        const { project, dir } = registry.createProject({
          name: body.name,
          gitUrl: body.git_url || undefined,
          createdBy: user.username,
        });
        // Same scaffold the MCP create_project applies (queue dirs + prompts).
        const { attachWorkflow } = await adminLib('mcp/core.js');
        attachWorkflow({ project_path: dir, project_name: project.name });
        return sendJson(res, 200, { project, path: dir });
      }
      case 'POST /api/admin/projects/archive': {
        const registry = await adminLib('server/lib/projects.js');
        return sendJson(res, 200, { project: registry.archiveProject(String(body.name || '')) });
      }
      default:
        return sendJson(res, 404, { error: 'unknown admin endpoint' });
    }
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }
}

// ---------------------------------------------------------------------------
// SSE + filesystem watching
// ---------------------------------------------------------------------------

const sseClients = new Set();

function apiEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 3000\n\n');
  sseClients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
}

let refreshTimer = null;
function broadcastRefresh(reason) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    for (const client of sseClients) client.write(`event: refresh\ndata: ${JSON.stringify({ reason })}\n\n`);
  }, 300); // debounce bursts (editors fire several events per save)
}

const watchers = new Map(); // dir -> fs.FSWatcher

function refreshWatchers() {
  const wanted = new Set();
  for (const proj of resolveProjects()) {
    const wi = path.join(proj.path, 'work-items');
    if (isDir(wi)) wanted.add(wi); // catches status folders being created
    for (const s of STATUSES) {
      const dir = path.join(wi, s);
      if (isDir(dir)) wanted.add(dir);
    }
  }
  for (const [dir, watcher] of watchers) {
    if (!wanted.has(dir)) {
      watcher.close();
      watchers.delete(dir);
    }
  }
  for (const dir of wanted) {
    if (watchers.has(dir)) continue;
    try {
      const watcher = fs.watch(dir, () => {
        broadcastRefresh(path.basename(dir));
        setTimeout(refreshWatchers, 350); // pick up newly created status folders
      });
      watcher.on('error', () => {
        watcher.close();
        watchers.delete(dir);
      });
      watchers.set(dir, watcher);
    } catch {}
  }
}

// Auto-discovery can surface brand-new projects whose dirs aren't watched yet;
// rescan periodically and tell clients when the project set changes.
let projectSignature = '';
setInterval(() => {
  refreshWatchers();
  const sig = resolveProjects()
    .map((p) => p.path)
    .join('\n');
  if (sig !== projectSignature) {
    projectSignature = sig;
    broadcastRefresh('projects-changed');
  }
}, 30000).unref();

try {
  fs.watch(CONFIG_PATH, () => {
    refreshWatchers();
    broadcastRefresh('config');
  });
} catch {}

// ---------------------------------------------------------------------------
// Static files + server
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, rel);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/projects') return apiProjects(res);
    if (url.pathname === '/api/item') return apiItem(url, res);
    if (url.pathname === '/api/events') return apiEvents(req, res);
    if (url.pathname.startsWith('/api/admin/')) {
      return void apiAdmin(req, res, url).catch((err) => {
        console.error(`[admin] ${req.url}: ${err.stack || err}`);
        if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
        else res.end();
      });
    }
    if (url.pathname === '/admin') return serveStatic('/admin.html', res);
    return serveStatic(url.pathname, res);
  } catch (err) {
    console.error(`[request] ${req.url}: ${err.stack || err}`);
    if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    else res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  refreshWatchers();
  projectSignature = resolveProjects()
    .map((p) => p.path)
    .join('\n');
  console.log(`Kanban Agent → http://localhost:${PORT}  (config: ${CONFIG_PATH})`);
});
