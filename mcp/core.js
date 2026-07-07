// kanban-agent MCP core — transport-agnostic server factory.
// Scaffolds and operates the file-based work-item queue convention that the
// cockpit (../server.js) visualises: work-items/{pending,in-progress,blocked,done}
// with NNN-slug.md items. The cockpit is the read side; this is the write side.
// Entrypoints: ./server.js (stdio, local single-user) and ../server/mcp-http.js
// (Streamable HTTP, hosted multi-user) — both call buildServer(context).
//
// Only dependency: @modelcontextprotocol/sdk. All queue parsing mirrors the
// cockpit exactly (lenient frontmatter, folder-is-authoritative-status).

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Hosted-mode stores (side-effect free to import; local stdio mode never
// touches them unless a hosted-only tool or a `project` name is used).
import * as usersLib from '../server/lib/users.js';
import * as projectRegistry from '../server/lib/projects.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
// Same override the cockpit honours, so tests can point both at a fixture config.
const CONFIG_PATH = process.env.PROJECTS_CONFIG || path.join(REPO_ROOT, 'projects.json');
// Read-only fallback for fresh clones where the cockpit has not yet seeded
// projects.json (the cockpit copies the example on first start; this server
// never writes outside project work-items/ dirs).
const EXAMPLE_CONFIG_PATH = path.join(REPO_ROOT, 'projects.example.json');

const STATUSES = ['pending', 'in-progress', 'blocked', 'done'];
const SCAFFOLD_DIRS = [...STATUSES, '_artifacts'];
// Work items are NNN-slug.md; no path separators — same regex as the cockpit.
const ITEM_RE = /^\d+-[^/\\]*\.md$/;

// ---------------------------------------------------------------------------
// Path + input validation
// ---------------------------------------------------------------------------

function fail(message) {
  const err = new Error(message);
  err.expected = true;
  return err;
}

function validateProjectPath(projectPath) {
  if (typeof projectPath !== 'string' || !projectPath.trim()) {
    throw fail('project_path is required');
  }
  if (!path.isAbsolute(projectPath)) {
    throw fail(`project_path must be absolute, got: ${projectPath}`);
  }
  const abs = path.resolve(projectPath);
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    throw fail(`project_path does not exist: ${abs}`);
  }
  if (!st.isDirectory()) throw fail(`project_path is not a directory: ${abs}`);
  return abs;
}

function workItemsDir(projectPath, ...segments) {
  const base = path.join(projectPath, 'work-items');
  const p = path.resolve(base, ...segments.map(String));
  if (p !== base && !p.startsWith(base + path.sep)) {
    throw fail(`path escapes work-items/: ${segments.join('/')}`);
  }
  return p;
}

// Item ids arrive as "001", "1" or 1 — anything else (slashes, "..", slugs) is
// rejected before it can reach the filesystem.
function normalizeId(id) {
  const s = String(id ?? '').trim();
  if (!/^\d{1,6}$/.test(s)) throw fail(`invalid item id (expected a number like "001"): ${JSON.stringify(id)}`);
  return parseInt(s, 10);
}

// Queue tools accept EITHER an absolute project_path (local mode, unchanged)
// OR a server-managed project name resolved through the hosted registry.
function resolveProjectDir(args) {
  const name = requireString(args, 'project', { optional: true });
  if (name !== undefined) {
    const dir = libCall(() => projectRegistry.resolveProject(name).dir);
    return validateProjectPath(dir);
  }
  if (!args?.project_path) throw fail('one of project_path (absolute path) or project (registry name) is required');
  return validateProjectPath(args.project_path);
}

// Admin tools exist only in hosted mode, where the HTTP transport put the
// authenticated caller on the context (context.user is null over stdio).
function requireAdmin(context) {
  if (!context?.user) {
    throw fail('hosted mode only — this tool needs an authenticated admin (serve via server/mcp-http.js)');
  }
  if (context.user.role !== 'admin') {
    throw fail(`admin required — user "${context.user.username}" has role "${context.user.role}"`);
  }
}

// Store-layer errors (unknown user, duplicate project, …) are expected
// operator mistakes, not server bugs — mark them so they aren't stack-logged.
function libCall(fn) {
  try {
    return fn();
  } catch (err) {
    throw fail(err.message);
  }
}

function requireString(args, key, { optional = false } = {}) {
  const v = args?.[key];
  if (v === undefined || v === null || v === '') {
    if (optional) return undefined;
    throw fail(`${key} is required`);
  }
  if (typeof v !== 'string') throw fail(`${key} must be a string`);
  return v;
}

// Accepts a string or an array of strings; returns array of non-empty lines.
function toLines(value) {
  if (value === undefined || value === null) return [];
  const arr = Array.isArray(value) ? value : [String(value)];
  return arr.map((s) => String(s).trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Queue parsing (mirrors the cockpit: lenient, folder is authoritative)
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
    if (!m) continue;
    fields[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return { fields, body: lines.slice(close + 1).join('\n') };
}

function listItems(projectPath, status) {
  const dir = workItemsDir(projectPath, status);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => ITEM_RE.test(f));
  } catch {
    return [];
  }
  return files
    .map((file) => {
      const num = parseInt(/^(\d+)/.exec(file)[1], 10);
      let id = /^(\d+)/.exec(file)[1];
      let title = file.replace(/^\d+-/, '').replace(/\.md$/i, '').replace(/[-_]+/g, ' ');
      try {
        const { fields } = splitFrontmatter(fs.readFileSync(path.join(dir, file), 'utf8'));
        if (fields.id) id = String(fields.id);
        if (fields.title) title = fields.title;
      } catch {}
      return { id, number: num, title, file };
    })
    .sort((a, b) => a.number - b.number || a.file.localeCompare(b.file));
}

function findItem(projectPath, id) {
  const num = normalizeId(id);
  for (const status of STATUSES) {
    const dir = workItemsDir(projectPath, status);
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => ITEM_RE.test(f));
    } catch {
      continue;
    }
    const file = files
      .sort()
      .find((f) => parseInt(/^(\d+)/.exec(f)[1], 10) === num);
    if (file) return { status, dir, file, path: path.join(dir, file) };
  }
  return null;
}

function nextItemNumber(projectPath) {
  let max = 0;
  for (const status of STATUSES) {
    for (const item of listItems(projectPath, status)) {
      if (item.number > max) max = item.number;
    }
  }
  return String(max + 1).padStart(3, '0');
}

function slugify(title) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'item';
}

// Reads verify_command / app_url back from WORKER_PROMPT.md frontmatter, where
// attach_workflow records them.
function projectConfig(projectPath) {
  const cfg = { verify_command: null, app_url: null };
  try {
    const text = fs.readFileSync(workItemsDir(projectPath, 'WORKER_PROMPT.md'), 'utf8');
    const { fields } = splitFrontmatter(text);
    if (fields.verify_command) cfg.verify_command = fields.verify_command;
    if (fields.app_url) cfg.app_url = fields.app_url;
  } catch {}
  return cfg;
}

// ---------------------------------------------------------------------------
// Moves: git mv is the claim/lock when the project is a git repo
// ---------------------------------------------------------------------------

function isGitRepo(projectPath) {
  try {
    return (
      execFileSync('git', ['-C', projectPath, 'rev-parse', '--is-inside-work-tree'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim() === 'true'
    );
  } catch {
    return false;
  }
}

function moveItem(projectPath, fromPath, toPath) {
  if (isGitRepo(projectPath)) {
    try {
      execFileSync('git', ['-C', projectPath, 'mv', fromPath, toPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return 'git mv';
    } catch {
      // e.g. file not yet tracked — plain rename is still a valid claim
    }
  }
  fs.renameSync(fromPath, toPath);
  return 'rename';
}

// ---------------------------------------------------------------------------
// Item file editing
// ---------------------------------------------------------------------------

function setFrontmatterStatus(text, status) {
  const lines = text.split(/\r?\n/);
  if (!/^---\s*$/.test(lines[0] || '')) return text;
  for (let i = 1; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) break;
    if (/^status\s*:/.test(lines[i])) {
      lines[i] = `status: ${status}`;
      return lines.join('\n');
    }
  }
  return text;
}

// Updates key in the frontmatter, or inserts it before the closing --- when
// missing. No-frontmatter files are returned untouched (lenient, like the rest).
function setFrontmatterField(text, key, value) {
  const lines = text.split(/\r?\n/);
  if (!/^---\s*$/.test(lines[0] || '')) return text;
  for (let i = 1; i < lines.length; i++) {
    if (new RegExp(`^${key}\\s*:`).test(lines[i])) {
      lines[i] = `${key}: ${value}`;
      return lines.join('\n');
    }
    if (/^---\s*$/.test(lines[i])) {
      lines.splice(i, 0, `${key}: ${value}`);
      return lines.join('\n');
    }
  }
  return text;
}

// ---------------------------------------------------------------------------
// Attribution + server-side git (hosted mode only)
// ---------------------------------------------------------------------------

// git needs "Name <email>"; users without an email get a synthetic local one.
function authorString(user) {
  return `${user.username} <${user.email || `${user.username}@kanban-agent.local`}>`;
}

// Server-side queue commits happen only for server-managed projects, i.e. when
// an authenticated user addresses the project by registry name.
function isHostedProject(args, context) {
  return Boolean(context?.user && args?.project);
}

// Commit the queue mutation in the project tree. The committer is the repo-local
// server identity (set at create_project); `author` carries the human. Queue
// state on disk is the source of truth, so a failed commit is logged, not fatal.
function gitCommitQueue(projectPath, message, author) {
  try {
    execFileSync('git', ['-C', projectPath, 'add', '-A', '--', 'work-items'], { stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync('git', ['-C', projectPath, 'commit', '-m', message, `--author=${author}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    console.error(`[queue-commit] ${projectPath}: ${String(err.stderr || err.message).trim()}`);
  }
}

function asBullet(label, value) {
  const v = String(value ?? '').trim();
  if (!v.includes('\n')) return `- ${label}: ${v}`;
  return `- ${label}:\n${v.split('\n').map((l) => `  ${l}`).join('\n')}`;
}

// Replaces the content under the `## Result` heading (up to the next heading)
// with the filled-in report; appends the section if the item lacks one.
function fillResultSection(text, { commit, what_changed, verification }) {
  const filled = [
    asBullet('Commit/branch', commit || '(none)'),
    asBullet('What changed', what_changed),
    asBullet('Verification output', verification),
  ].join('\n');
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}\s+Result\b/i.test(l));
  if (start === -1) {
    return text.replace(/\s*$/, '') + `\n\n## Result (worker fills in)\n${filled}\n`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const out = [...lines.slice(0, start + 1), filled, ''];
  if (end < lines.length) out.push(...lines.slice(end));
  return out.join('\n').replace(/\s*$/, '') + '\n';
}

function appendBlockedNote(text, reason) {
  return text.replace(/\s*$/, '') + `\n\n## Blocked\n\n${String(reason).trim()}\n`;
}

// ---------------------------------------------------------------------------
// Scaffold content (generic — parameterized by verify_command / app_url)
// ---------------------------------------------------------------------------

function readmeContent() {
  return `# Work-item queue

A file-based task queue between the **PM agent** (writes items) and the **worker
agent** (executes them). Operated by hand or via the \`kanban-agent\` MCP server.

## Folders = status (a file's location IS its state)

- \`pending/\`     — ready to be picked up. Worker pulls from here.
- \`in-progress/\` — claimed by a worker (move here on claim).
- \`done/\`        — finished + verified.
- \`blocked/\`     — cannot proceed; needs PM/human input (see the item's \`## Blocked\` note).
- \`_artifacts/\`  — supporting files (screenshots, logs). Not work items.

## File naming

\`NNN-short-slug.md\`  e.g. \`007-fix-login-redirect.md\`

\`NNN\` is a zero-padded, monotonically increasing number = priority/FIFO order.
Worker always claims the **lowest-numbered** file in \`pending/\`.

## Lifecycle

1. PM verifies the request (against the live app when the project has one), then
   writes a fully-specified item into \`pending/\` — use \`_TEMPLATE.md\`, or the
   \`create_work_item\` MCP tool.
2. Worker claims the lowest \`NNN\` → \`git mv\` it to \`in-progress/\`.
3. Worker implements the scope, verifies, checks every acceptance criterion.
4. Worker fills in the \`## Result\` section and moves the file to \`done/\`
   (or \`blocked/\` with a \`## Blocked\` note).
5. Worker loops back to step 2 until \`pending/\` is empty.

## Rules

- One item = one self-contained, independently shippable change.
- The PM writes acceptance criteria specific enough that "done" is unambiguous
  (binary, testable).
- The worker never edits an item's Scope or Acceptance criteria; if an item is
  wrong or ambiguous, it goes to \`blocked/\` with a note and the worker moves on.
- Never two workers on the same file — the \`git mv\` to \`in-progress/\` is the
  claim/lock.
- Don't leave test data behind: clean up anything created while verifying.

## Tooling

The \`kanban-agent\` MCP server operates this queue: \`queue_status\`,
\`create_work_item\`, \`claim_next_item\`, \`complete_item\`, \`block_item\`,
\`get_item\`. Prefer those over hand-rolled file operations.
\`WORKER_PROMPT.md\` is the ready-to-use worker loop prompt.
`;
}

function templateContent(verifyCommand, appUrl) {
  const verifyLine = verifyCommand
    ? `- [ ] \`${verifyCommand}\` passes (build/verify green)`
    : '- [ ] Project build/verify passes (<verify command — see WORKER_PROMPT.md>)';
  const appLine = appUrl
    ? `- [ ] Verified in the live app at ${appUrl} (no new console/server errors)`
    : '- [ ] Verified in the running app, when the project has one (no new errors)';
  return `---
id: NNN
title: <imperative, one line>
type: feature | bug | chore
priority: P1 | P2 | P3
created: YYYY-MM-DD
status: pending
---

## Summary
<1–3 sentences: what is wanted and why.>

## Verification (what the PM observed)
- Where: <URL/route/command where the problem or gap is visible>
- Current behaviour: <what actually happens now>
- Expected behaviour: <what it should do>
- Evidence: <screenshot under _artifacts/, console error, log line — if any>

## Scope
- In scope: <bullet the exact changes>
- Out of scope: <explicitly excluded, to prevent drift>

## Pointers (where to work)
- Files likely involved: <path:line if known, from a quick grep>
- Related modules/APIs: <stores, endpoints, schemas>

## Acceptance criteria (binary, testable)
- [ ] <criterion 1>
- [ ] <criterion 2>
${verifyLine}
${appLine}

## Result (worker fills in)
- Commit/branch:
- What changed:
- Verification output:
`;
}

function workerPromptContent(projectPath, projectName, verifyCommand, appUrl) {
  const fm = ['---'];
  if (verifyCommand) fm.push(`verify_command: ${verifyCommand}`);
  if (appUrl) fm.push(`app_url: ${appUrl}`);
  fm.push('---');
  const frontmatter = verifyCommand || appUrl ? fm.join('\n') + '\n\n' : '';
  const verifyStep = verifyCommand
    ? `Run \`${verifyCommand}\` and make sure it is green.`
    : `Run the project's build/verify command (check the README or CI config; ask the PM if unclear) and make sure it is green.`;
  const liveStep = appUrl
    ? ` Then verify the behaviour in the live app at ${appUrl}: reproduce each acceptance criterion and confirm no new console/server errors.`
    : ` If the project has a running app, verify the behaviour there too.`;
  return `${frontmatter}# Worker agent — ${projectName} work-item queue (POLLING mode)

You are the WORKER agent on ${projectName} (\`${projectPath}\`).
Pull tasks from the file queue in \`./work-items\` and execute them in a continuous loop.

Read \`./work-items/README.md\` first for the protocol. Then run this loop:

1. **CLAIM**: List \`./work-items/pending/\`.
   - If it is EMPTY: this is polling mode — do NOT exit. Sleep 30s (\`sleep 30\`),
     then check again. Keep polling. Only give up and exit after **60 consecutive
     empty checks (~30 min idle)**, printing "Idle 30m, exiting."
   - If it is non-empty: pick the LOWEST-numbered file (\`NNN-*.md\`). Claim it
     atomically: \`git mv work-items/pending/<file> work-items/in-progress/<file>\`
     (plain \`mv\` if the project is not a git repo). This is your lock — never
     touch a file already in \`in-progress/\`. Reset the idle counter.
     The \`kanban-agent\` MCP tool \`claim_next_item\` does this in one call.

2. **UNDERSTAND**: Read the item fully. If it is ambiguous, self-contradictory, or
   its premise is false, move it to \`work-items/blocked/\` with a \`## Blocked\`
   note explaining why (MCP: \`block_item\`), and go back to step 1 — do NOT guess
   at scope.

3. **IMPLEMENT**: Make ONLY the changes in "Scope". Match the surrounding code
   style. Use the "Pointers" as a starting point but verify against the real code.
   Respect \`depends_on\` / \`stacks_on\` front-matter — those lower-numbered items
   are already done, so build on their result.

4. **VERIFY**: ${verifyStep}${liveStep}
   Check off EVERY box in "Acceptance criteria". Clean up any test data you
   created so the app/repo state stays clean.

5. **RECORD + CLOSE**: Fill in the item's \`## Result\` section (commit, what
   changed, verification output), then move the file to \`work-items/done/\`
   (MCP: \`complete_item\` does both in one call). Commit with the item id in the
   message (e.g. \`feat: … [work-item 002]\`). Do NOT push unless told.

6. **LOOP** back to step 1.

## Rules

- One item at a time. The \`git mv\` to \`in-progress/\` is the lock.
- One item = one self-contained, independently shippable change — don't batch.
- Never edit an item's Scope or Acceptance criteria to make it pass.
- If a build or verification fails and you cannot fix it within the item's scope,
  move the item to \`blocked/\` with a \`## Blocked\` note and continue with the next.
- Don't leave test data behind — remove anything you created while verifying.
- In hosted mode, commit your code with \`--author\` set to the \`commit_author\`
  returned by \`complete_item\`, and push before/with completion.
`;
}

function instructionsSection() {
  return `## Work-item queue

This project uses a file-based work-item queue in \`work-items/\` — the folder a
file sits in is its status (\`pending/\`, \`in-progress/\`, \`blocked/\`, \`done/\`).
Read \`work-items/README.md\` for the protocol before touching the queue, and use
\`work-items/WORKER_PROMPT.md\` as the worker-loop prompt. Prefer the
\`kanban-agent\` MCP tools (\`queue_status\`, \`create_work_item\`,
\`claim_next_item\`, \`complete_item\`, \`block_item\`, \`get_item\`) over
hand-rolled file operations.
`;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

// Exported: the cockpit's admin API applies the same scaffold on project creation.
export function attachWorkflow(args) {
  const projectPath = resolveProjectDir(args);
  const projectName = requireString(args, 'project_name', { optional: true }) || path.basename(projectPath);
  const verifyCommand = requireString(args, 'verify_command', { optional: true });
  const appUrl = requireString(args, 'app_url', { optional: true });

  const created = [];
  const skipped = [];
  const rel = (p) => path.relative(projectPath, p);

  for (const dirName of SCAFFOLD_DIRS) {
    const dir = workItemsDir(projectPath, dirName);
    if (fs.existsSync(dir)) {
      skipped.push(rel(dir) + '/');
    } else {
      fs.mkdirSync(dir, { recursive: true });
      created.push(rel(dir) + '/');
    }
    const keep = path.join(dir, '.gitkeep');
    if (fs.readdirSync(dir).length === 0) {
      fs.writeFileSync(keep, '');
      created.push(rel(keep));
    } else if (fs.existsSync(keep)) {
      skipped.push(rel(keep));
    }
  }

  const scaffold = [
    ['README.md', readmeContent()],
    ['_TEMPLATE.md', templateContent(verifyCommand, appUrl)],
    ['WORKER_PROMPT.md', workerPromptContent(projectPath, projectName, verifyCommand, appUrl)],
  ];
  for (const [name, content] of scaffold) {
    const p = workItemsDir(projectPath, name);
    if (fs.existsSync(p)) {
      skipped.push(rel(p));
    } else {
      fs.writeFileSync(p, content);
      created.push(rel(p));
    }
  }

  // Agent instructions: CLAUDE.md if present, else AGENTS.md (created if needed).
  const claudeMd = path.join(projectPath, 'CLAUDE.md');
  const agentsMd = path.join(projectPath, 'AGENTS.md');
  const target = fs.existsSync(claudeMd) ? claudeMd : agentsMd;
  let instructions;
  if (fs.existsSync(target)) {
    const existing = fs.readFileSync(target, 'utf8');
    if (/^##\s+Work-item queue\b/m.test(existing)) {
      instructions = { file: rel(target), action: 'skipped (section already present)' };
    } else {
      const sep = existing === '' ? '' : existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
      fs.appendFileSync(target, sep + instructionsSection());
      instructions = { file: rel(target), action: 'appended `## Work-item queue` section' };
    }
  } else {
    fs.writeFileSync(target, `# Agent instructions — ${projectName}\n\n` + instructionsSection());
    instructions = { file: rel(target), action: 'created with `## Work-item queue` section' };
  }

  return {
    project: projectName,
    project_path: projectPath,
    verify_command: verifyCommand || null,
    app_url: appUrl || null,
    created,
    skipped,
    instructions,
    no_op: created.length === 0 && instructions.action.startsWith('skipped'),
  };
}

function queueStatus(args) {
  const projectPath = resolveProjectDir(args);
  const counts = {};
  const items = {};
  for (const status of STATUSES) {
    const list = listItems(projectPath, status).map(({ id, title, file }) => ({ id, title, file }));
    counts[status] = list.length;
    items[status] = list;
  }
  return { project_path: projectPath, counts, total: STATUSES.reduce((n, s) => n + counts[s], 0), items };
}

function createWorkItem(args, context) {
  const projectPath = resolveProjectDir(args);
  const title = requireString(args, 'title');
  const type = requireString(args, 'type');
  const priority = requireString(args, 'priority');
  const summary = requireString(args, 'summary');
  if (!['feature', 'bug', 'chore'].includes(type)) throw fail(`type must be feature|bug|chore, got: ${type}`);
  if (!['P1', 'P2', 'P3'].includes(priority)) throw fail(`priority must be P1|P2|P3, got: ${priority}`);
  const scope = toLines(args.scope);
  if (scope.length === 0) throw fail('scope is required (string or array of strings)');
  const outOfScope = toLines(args.out_of_scope);
  const pointers = toLines(args.pointers);
  const criteria = toLines(args.acceptance_criteria);
  if (criteria.length === 0) throw fail('acceptance_criteria is required (array of binary, testable criteria)');

  const pendingDir = workItemsDir(projectPath, 'pending');
  if (!fs.existsSync(pendingDir)) {
    throw fail(`no work-items/pending/ in ${projectPath} — run attach_workflow first`);
  }

  const cfg = projectConfig(projectPath);
  const verifyCommand = requireString(args, 'verify_command', { optional: true }) || cfg.verify_command;
  const appUrl = requireString(args, 'app_url', { optional: true }) || cfg.app_url;

  const nnn = nextItemNumber(projectPath);
  const file = `${nnn}-${slugify(title)}.md`;
  if (!ITEM_RE.test(file)) throw fail(`generated filename is invalid: ${file}`);
  const filePath = workItemsDir(projectPath, 'pending', file);
  if (fs.existsSync(filePath)) throw fail(`file already exists: ${filePath}`);

  const fm = ['---', `id: ${nnn}`, `title: ${title.replace(/\r?\n/g, ' ')}`, `type: ${type}`, `priority: ${priority}`, `created: ${new Date().toISOString().slice(0, 10)}`, 'status: pending'];
  if (context?.user) fm.push(`created_by: ${context.user.username}`);
  if (args.depends_on !== undefined && args.depends_on !== null && args.depends_on !== '') {
    fm.push(`depends_on: ${String(normalizeId(args.depends_on)).padStart(3, '0')}`);
  }
  if (args.stacks_on !== undefined && args.stacks_on !== null && args.stacks_on !== '') {
    fm.push(`stacks_on: ${String(normalizeId(args.stacks_on)).padStart(3, '0')}`);
  }
  fm.push('---');

  const sections = [fm.join('\n'), '', '## Summary', summary.trim(), '', '## Scope'];
  sections.push(...scope.map((s) => `- In scope: ${s}`));
  sections.push(...outOfScope.map((s) => `- Out of scope: ${s}`));
  if (pointers.length) {
    sections.push('', '## Pointers (where to work)');
    sections.push(...pointers.map((p) => `- ${p}`));
  }
  sections.push('', '## Acceptance criteria (binary, testable)');
  sections.push(...criteria.map((c) => `- [ ] ${c.replace(/^\s*-?\s*\[[ xX]\]\s*/, '')}`));
  // The two standard trailing criteria — always appended.
  sections.push(
    verifyCommand
      ? `- [ ] \`${verifyCommand}\` passes (build/verify green)`
      : '- [ ] Project build/verify passes (no verify command configured — run the project’s standard checks)'
  );
  if (appUrl) {
    sections.push(`- [ ] Verified in the live app at ${appUrl} (no new console/server errors)`);
  }
  sections.push('', '## Result (worker fills in)', '- Commit/branch:', '- What changed:', '- Verification output:', '');

  fs.writeFileSync(filePath, sections.join('\n'));
  if (isHostedProject(args, context)) {
    gitCommitQueue(projectPath, `chore(queue): create work-item ${nnn} — ${slugify(title)} [work-item ${nnn}]`, authorString(context.user));
  }
  return { id: nnn, file, path: filePath, status: 'pending' };
}

function claimNextItem(args, context) {
  const projectPath = resolveProjectDir(args);
  const pending = listItems(projectPath, 'pending');
  if (pending.length === 0) {
    throw fail(`nothing to claim: work-items/pending/ is empty in ${projectPath}`);
  }
  const item = pending[0];
  const from = workItemsDir(projectPath, 'pending', item.file);
  const to = workItemsDir(projectPath, 'in-progress', item.file);
  if (fs.existsSync(to)) throw fail(`cannot claim ${item.file}: already exists in in-progress/`);
  const via = moveItem(projectPath, from, to);
  let text = fs.readFileSync(to, 'utf8');
  let updated = setFrontmatterStatus(text, 'in-progress');
  if (context?.user) updated = setFrontmatterField(updated, 'claimed_by', context.user.username);
  if (updated !== text) {
    fs.writeFileSync(to, updated);
    text = updated;
  }
  if (isHostedProject(args, context)) {
    gitCommitQueue(projectPath, `chore(queue): claim work-item ${item.id} [work-item ${item.id}]`, authorString(context.user));
  }
  return { id: item.id, file: item.file, path: to, status: 'in-progress', moved_via: via, markdown: text };
}

function completeItem(args, context) {
  const projectPath = resolveProjectDir(args);
  const num = normalizeId(args.id);
  const what = requireString(args, 'what_changed');
  const verification = requireString(args, 'verification');
  const commit = requireString(args, 'commit', { optional: true });

  const found = findItem(projectPath, num);
  if (!found) throw fail(`item ${args.id} not found in any status folder`);
  if (found.status !== 'in-progress') {
    throw fail(`item ${args.id} is in ${found.status}/, not in-progress/ — claim it first`);
  }

  let text = fs.readFileSync(found.path, 'utf8');
  const { fields } = splitFrontmatter(text);
  text = fillResultSection(text, { commit, what_changed: what, verification });
  text = setFrontmatterStatus(text, 'done');
  fs.writeFileSync(found.path, text);

  const to = workItemsDir(projectPath, 'done', found.file);
  const via = moveItem(projectPath, found.path, to);
  const id = found.file.match(/^(\d+)/)[1];
  const result = { id, file: found.file, path: to, status: 'done', moved_via: via };

  if (context?.user) {
    // The completion commit is authored by the item's CREATOR — and the agent
    // is handed the same author string for its own code commits.
    const creatorName = fields.created_by || context.user.username;
    const creator = libCall(() => usersLib.listUsers()).find((u) => u.username === creatorName);
    const author = authorString(creator || { username: creatorName, email: '' });
    result.commit_author = author;
    if (isHostedProject(args, context)) {
      gitCommitQueue(projectPath, `chore(queue): complete work-item ${id} [work-item ${id}]`, author);
      const { project } = libCall(() => projectRegistry.resolveProject(args.project));
      if (project.gitUrl) {
        // Push failure never fails the completion — the queue move already
        // happened; the caller just learns the push needs attention.
        try {
          execFileSync('git', ['-C', projectPath, 'push', 'origin', 'HEAD'], { stdio: ['ignore', 'pipe', 'pipe'] });
          result.pushed = true;
        } catch (err) {
          result.pushed = false;
          result.push_error = String(err.stderr || err.message).trim();
        }
      }
    }
  }
  return result;
}

function blockItem(args, context) {
  const projectPath = resolveProjectDir(args);
  const num = normalizeId(args.id);
  const reason = requireString(args, 'reason');

  const found = findItem(projectPath, num);
  if (!found) throw fail(`item ${args.id} not found in any status folder`);
  if (found.status !== 'pending' && found.status !== 'in-progress') {
    throw fail(`item ${args.id} is in ${found.status}/ — only pending or in-progress items can be blocked`);
  }

  let text = fs.readFileSync(found.path, 'utf8');
  text = appendBlockedNote(text, reason);
  text = setFrontmatterStatus(text, 'blocked');
  fs.writeFileSync(found.path, text);

  const to = workItemsDir(projectPath, 'blocked', found.file);
  const via = moveItem(projectPath, found.path, to);
  const id = found.file.match(/^(\d+)/)[1];
  if (isHostedProject(args, context)) {
    gitCommitQueue(projectPath, `chore(queue): block work-item ${id} [work-item ${id}]`, authorString(context.user));
  }
  return { id, file: found.file, path: to, status: 'blocked', from: found.status, moved_via: via };
}

function getItem(args) {
  const projectPath = resolveProjectDir(args);
  const found = findItem(projectPath, args.id);
  if (!found) throw fail(`item ${args.id} not found in any status folder`);
  return {
    id: found.file.match(/^(\d+)/)[1],
    file: found.file,
    status: found.status,
    path: found.path,
    markdown: fs.readFileSync(found.path, 'utf8'),
  };
}

// list_projects reuses the cockpit's discovery: explicit projects.json list +
// autoDiscoverRoots children that have a work-items/ with a status folder.
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function hasQueue(projectDir) {
  const wi = path.join(projectDir, 'work-items');
  return isDir(wi) && STATUSES.some((s) => isDir(path.join(wi, s)));
}

function listProjects(args, context) {
  // Hosted mode: the server-managed registry is the source of truth —
  // non-archived projects only, each with its queue counts.
  if (context?.user) {
    return {
      registry: projectRegistry.REGISTRY_PATH,
      projects: libCall(() => projectRegistry.listRegistry()).map((p) => {
        const counts = {};
        for (const status of STATUSES) counts[status] = listItems(p.dir, status).length;
        return { name: p.name, gitUrl: p.gitUrl, createdBy: p.createdBy, createdAt: p.createdAt, path: p.dir, has_queue: hasQueue(p.dir), counts };
      }),
    };
  }
  const configPath = fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : EXAMPLE_CONFIG_PATH;
  // Relative paths in the config resolve against the config file's directory,
  // mirroring the cockpit — the shipped example points at examples/demo-project.
  const configDir = path.dirname(path.resolve(configPath));
  let cfg = { projects: [], autoDiscoverRoots: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    cfg.projects = Array.isArray(parsed.projects) ? parsed.projects.filter((p) => p && p.path) : [];
    cfg.autoDiscoverRoots = Array.isArray(parsed.autoDiscoverRoots) ? parsed.autoDiscoverRoots : [];
  } catch (err) {
    throw fail(`cannot read projects config ${configPath}: ${err.message}`);
  }

  const byPath = new Map();
  const out = [];
  for (const p of cfg.projects) {
    const abs = path.resolve(configDir, String(p.path));
    if (byPath.has(abs)) continue;
    const proj = { name: String(p.name || path.basename(abs)), path: abs, discovered: false };
    byPath.set(abs, proj);
    out.push(proj);
  }
  for (const root of cfg.autoDiscoverRoots) {
    const absRoot = path.resolve(configDir, String(root));
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
      const proj = { name: e.name, path: abs, discovered: true };
      byPath.set(abs, proj);
      out.push(proj);
    }
  }

  return {
    config: configPath,
    projects: out.map((proj) => {
      const counts = {};
      for (const status of STATUSES) counts[status] = listItems(proj.path, status).length;
      return { ...proj, has_queue: hasQueue(proj.path), counts };
    }),
  };
}

// ---------------------------------------------------------------------------
// Admin tools (hosted mode only — see requireAdmin)
// ---------------------------------------------------------------------------

function createProjectTool(args, context) {
  requireAdmin(context);
  const name = requireString(args, 'name');
  const gitUrl = requireString(args, 'git_url', { optional: true });
  const { project, dir } = libCall(() =>
    projectRegistry.createProject({ name, gitUrl, createdBy: context.user.username })
  );
  const scaffold = attachWorkflow({ project_path: dir, project_name: name });
  return { ...project, path: dir, scaffold: { created: scaffold.created, instructions: scaffold.instructions } };
}

function archiveProjectTool(args, context) {
  requireAdmin(context);
  const name = requireString(args, 'name');
  const project = libCall(() => projectRegistry.archiveProject(name));
  return { ...project, note: 'archived — hidden from lists; files kept on disk' };
}

function createUserTool(args, context) {
  requireAdmin(context);
  const username = requireString(args, 'username');
  const email = requireString(args, 'email', { optional: true }) || '';
  const role = requireString(args, 'role');
  const { user, token } = libCall(() => usersLib.createUser({ username, email, role }));
  return { user, token, note: 'This token is shown ONCE (stored only as a hash) — pass it to the user now.' };
}

function revokeUserTool(args, context) {
  requireAdmin(context);
  const username = requireString(args, 'username');
  const user = libCall(() => usersLib.revokeUser(username));
  return { user, note: 'token revoked — issue a new one with rotate_token' };
}

function rotateTokenTool(args, context) {
  requireAdmin(context);
  const username = requireString(args, 'username');
  const token = libCall(() => usersLib.rotateToken(username));
  return { username, token, note: 'This token is shown ONCE (stored only as a hash) — the old token is now invalid.' };
}

// ---------------------------------------------------------------------------
// Tool + prompt registry
// ---------------------------------------------------------------------------

const PROJECT_PATH_PROP = {
  project_path: {
    type: 'string',
    description: 'Absolute path to the project root (the directory that contains, or will contain, work-items/). Local mode; alternative to `project`.',
  },
  project: {
    type: 'string',
    description: 'Name of a server-managed project from the hosted registry — alternative to project_path.',
  },
};

const TOOLS = [
  {
    name: 'attach_workflow',
    description:
      'Scaffold the work-item queue into a project: work-items/{pending,in-progress,blocked,done,_artifacts}/, README.md (protocol), _TEMPLATE.md, WORKER_PROMPT.md (polling worker loop), and a `## Work-item queue` section in the project’s CLAUDE.md/AGENTS.md. Idempotent: never overwrites existing files or re-appends the section; returns a created/skipped report.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_PATH_PROP,
        project_name: { type: 'string', description: 'Display name for the project (default: directory basename)' },
        verify_command: {
          type: 'string',
          description: 'The project’s build/verify command (e.g. "npm test && npm run build"); baked into WORKER_PROMPT.md and the standard acceptance criteria',
        },
        app_url: {
          type: 'string',
          description: 'URL of the running app for live verification (e.g. http://localhost:5173); omit if the project has no live app',
        },
      },
      required: [],
    },
    handler: attachWorkflow,
  },
  {
    name: 'queue_status',
    description: 'Per-status counts plus {id, title, file} lists for a project’s work-item queue.',
    inputSchema: { type: 'object', properties: { ...PROJECT_PATH_PROP }, required: [] },
    handler: queueStatus,
  },
  {
    name: 'create_work_item',
    description:
      'Write a fully-specified work item into work-items/pending/. Allocates the next NNN across all four status folders, slugifies the title, follows the template, and always appends the two standard trailing acceptance criteria (verify command green; live-verified when an app URL is configured — both read back from WORKER_PROMPT.md unless passed here). Returns the file path.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_PATH_PROP,
        title: { type: 'string', description: 'Imperative, one line' },
        type: { type: 'string', enum: ['feature', 'bug', 'chore'] },
        priority: { type: 'string', enum: ['P1', 'P2', 'P3'] },
        summary: { type: 'string', description: '1–3 sentences: what is wanted and why' },
        scope: {
          type: 'array',
          items: { type: 'string' },
          description: 'Exact changes that are in scope (one bullet per change)',
        },
        out_of_scope: { type: 'array', items: { type: 'string' }, description: 'Explicitly excluded, to prevent drift' },
        pointers: { type: 'array', items: { type: 'string' }, description: 'Where to work: files (path:line), modules, endpoints' },
        acceptance_criteria: {
          type: 'array',
          items: { type: 'string' },
          description: 'Binary, testable criteria (without checkbox markers)',
        },
        depends_on: { type: 'string', description: 'Item number this depends on (e.g. "003")' },
        stacks_on: { type: 'string', description: 'Item number this stacks on (e.g. "003")' },
        verify_command: { type: 'string', description: 'Override the verify command for the standard trailing criterion' },
        app_url: { type: 'string', description: 'Override the app URL for the standard trailing criterion' },
      },
      required: ['title', 'type', 'priority', 'summary', 'scope', 'acceptance_criteria'],
    },
    handler: createWorkItem,
  },
  {
    name: 'claim_next_item',
    description:
      'Claim the lowest-numbered pending item: moves it to in-progress/ (git mv when the project is a git repo — that is the lock) and returns its full markdown. Errors when pending/ is empty.',
    inputSchema: { type: 'object', properties: { ...PROJECT_PATH_PROP }, required: [] },
    handler: claimNextItem,
  },
  {
    name: 'complete_item',
    description:
      'Finish an in-progress item: fills its `## Result` section (commit, what changed, verification output) and moves it to done/.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_PATH_PROP,
        id: { type: 'string', description: 'Item number (e.g. "001")' },
        commit: { type: 'string', description: 'Commit hash/branch of the change' },
        what_changed: { type: 'string', description: 'What was changed, concretely' },
        verification: { type: 'string', description: 'How it was verified (command output, live-app checks)' },
      },
      required: ['id', 'what_changed', 'verification'],
    },
    handler: completeItem,
  },
  {
    name: 'block_item',
    description:
      'Block a pending or in-progress item: appends a `## Blocked` note with the reason and moves it to blocked/.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_PATH_PROP,
        id: { type: 'string', description: 'Item number (e.g. "002")' },
        reason: { type: 'string', description: 'Why the item cannot proceed / what input is needed' },
      },
      required: ['id', 'reason'],
    },
    handler: blockItem,
  },
  {
    name: 'get_item',
    description: 'Fetch one item by number, searching all four status folders; returns its status folder and raw markdown.',
    inputSchema: {
      type: 'object',
      properties: { ...PROJECT_PATH_PROP, id: { type: 'string', description: 'Item number (e.g. "014")' } },
      required: ['id'],
    },
    handler: getItem,
  },
  {
    name: 'list_projects',
    description:
      'All tracked projects with per-status counts. Local mode: the cockpit view (explicit projects.json list + auto-discovered work-items/ queues under autoDiscoverRoots). Hosted mode: the server-managed registry (non-archived projects).',
    inputSchema: { type: 'object', properties: {} },
    handler: listProjects,
  },
  {
    name: 'create_project',
    description:
      'ADMIN, hosted mode only: create a server-managed project at data/projects/<name> — clones git_url when given, else git init + an initial commit — then scaffolds the work-item queue (attach_workflow). Members operate it via the `project` name afterwards.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name, [a-z0-9-_]{2,32} — doubles as the directory name' },
        git_url: { type: 'string', description: 'Optional git URL to clone; omit for a fresh empty repo' },
      },
      required: ['name'],
    },
    handler: createProjectTool,
  },
  {
    name: 'archive_project',
    description:
      'ADMIN, hosted mode only: archive a server-managed project — hides it from list_projects and name resolution. Files are never deleted.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Registry name of the project to archive' } },
      required: ['name'],
    },
    handler: archiveProjectTool,
  },
  {
    name: 'create_user',
    description:
      'ADMIN, hosted mode only: create a user and return their API token. The token appears ONCE in this result (stored only as a hash) — pass it to the user immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Username, [a-z0-9-_]{2,32}, unique' },
        email: { type: 'string', description: 'Contact email (optional)' },
        role: { type: 'string', enum: ['admin', 'member'] },
      },
      required: ['username', 'role'],
    },
    handler: createUserTool,
  },
  {
    name: 'revoke_user',
    description:
      'ADMIN, hosted mode only: invalidate a user’s API token (deletes its hash). The user stays in the registry; issue a fresh token with rotate_token.',
    inputSchema: {
      type: 'object',
      properties: { username: { type: 'string', description: 'User whose token to revoke' } },
      required: ['username'],
    },
    handler: revokeUserTool,
  },
  {
    name: 'rotate_token',
    description:
      'ADMIN, hosted mode only: issue a user a new API token, invalidating the old one. The new token appears ONCE in this result.',
    inputSchema: {
      type: 'object',
      properties: { username: { type: 'string', description: 'User whose token to rotate' } },
      required: ['username'],
    },
    handler: rotateTokenTool,
  },
];

const PROMPTS = [
  {
    name: 'worker-loop',
    description: 'The project’s WORKER_PROMPT.md — the polling worker loop for its work-item queue.',
    arguments: [{ name: 'project_path', description: 'Absolute path to the project root', required: true }],
    handler(args) {
      const projectPath = validateProjectPath(args.project_path);
      const p = workItemsDir(projectPath, 'WORKER_PROMPT.md');
      if (!fs.existsSync(p)) {
        throw fail(`no work-items/WORKER_PROMPT.md in ${projectPath} — run attach_workflow first`);
      }
      return fs.readFileSync(p, 'utf8');
    },
  },
  {
    name: 'pm-write-items',
    description: 'A PM prompt for the project: verify requests, then write fully-specified work items via create_work_item.',
    arguments: [{ name: 'project_path', description: 'Absolute path to the project root', required: true }],
    handler(args) {
      const projectPath = validateProjectPath(args.project_path);
      const name = path.basename(projectPath);
      const cfg = projectConfig(projectPath);
      const verifyHow = cfg.app_url
        ? `against the live app at ${cfg.app_url} — reproduce the problem or confirm the gap yourself and note the current behaviour`
        : `against the code and, when the project has a running app, the app itself — reproduce the problem or confirm the gap yourself and note the current behaviour`;
      return `You are the PM agent for ${name} (\`${projectPath}\`). Your job is to turn
requests into fully-specified work items in the file queue at \`work-items/\` —
you write items, you never implement them. Read \`work-items/README.md\` for the
protocol first.

For each request:

1. **Verify the premise** ${verifyHow}. Never write an item from an unverified
   assumption.
2. **Write the item with the \`kanban-agent\` MCP tool \`create_work_item\`**
   (project_path: ${projectPath}). Include: a crisp summary (what + why), the
   exact scope (and explicit out-of-scope to prevent drift), pointers into the
   code from a quick grep, and BINARY acceptance criteria — each one objectively
   pass/fail, no "works well". The standard build/verify and live-check criteria
   are appended automatically.
3. **Keep scope to ONE self-contained, independently shippable change per item.**
   Split bigger requests into multiple items; order them by number and use
   depends_on/stacks_on for items that build on earlier ones.
4. **Monitor with \`queue_status\`.** Items in \`blocked/\` need your input: read
   the \`## Blocked\` note, then either write a corrected replacement item or
   resolve the blocker. Never edit the scope of an item a worker has claimed.`;
    },
  },
];

// ---------------------------------------------------------------------------
// Server factory — one Server per transport connection. `context` carries the
// authenticated caller: { user } from server/lib/users.js in hosted HTTP mode,
// { user: null } in local stdio mode. Handlers receive it as their second
// argument so tools can read who is calling.
// ---------------------------------------------------------------------------

export function buildServer(context = { user: null }) {
  const server = new Server({ name: 'kanban-agent', version: '0.1.0' }, { capabilities: { tools: {}, prompts: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) {
      return { content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }], isError: true };
    }
    try {
      const result = tool.handler(req.params.arguments ?? {}, context);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      if (!err.expected) console.error(`[${req.params.name}]`, err.stack || err);
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPTS.map(({ name, description, arguments: args }) => ({ name, description, arguments: args })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const prompt = PROMPTS.find((p) => p.name === req.params.name);
    if (!prompt) throw fail(`Unknown prompt: ${req.params.name}`);
    const text = prompt.handler(req.params.arguments ?? {});
    return {
      description: prompt.description,
      messages: [{ role: 'user', content: { type: 'text', text } }],
    };
  });

  return server;
}

// Re-exported for server/mcp-http.js: the SDK only exists in mcp/node_modules,
// so bare-specifier imports must resolve from a file inside this package.
export { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
export { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
