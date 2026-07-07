// kanban-agent hosted-mode project registry — JSON store at data/projects.json.
// Each project is a git working tree at data/projects/<name>/: created either
// by cloning gitUrl or by git init + an initial commit. Archiving only flips a
// flag (hides the project from lists); files are never deleted. Same atomic
// write + reload-per-operation discipline as lib/users.js.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const DATA_DIR = process.env.KANBAN_DATA_DIR || path.join(REPO_ROOT, 'data');
export const REGISTRY_PATH = path.join(DATA_DIR, 'projects.json');
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects');

// Same shape as usernames — the name doubles as the directory name.
const NAME_RE = /^[a-z0-9-_]{2,32}$/;

function loadRegistry() {
  let text;
  try {
    text = fs.readFileSync(REGISTRY_PATH, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { projects: [] };
    throw err;
  }
  const registry = JSON.parse(text);
  if (!Array.isArray(registry.projects)) registry.projects = [];
  return registry;
}

function saveRegistry(registry) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = path.join(DATA_DIR, `.projects.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2) + '\n');
  fs.renameSync(tmp, REGISTRY_PATH);
}

function projectDir(name) {
  return path.join(PROJECTS_DIR, name);
}

// Commits run with an explicit identity so they work on hosts with no
// global git config.
function git(dir, ...argv) {
  execFileSync('git', ['-C', dir, '-c', 'user.name=kanban-agent', '-c', 'user.email=kanban-agent@localhost', ...argv], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function requireProject(registry, name) {
  const project = registry.projects.find((p) => p.name === name);
  if (!project) throw new Error(`unknown project: ${JSON.stringify(name)}`);
  return project;
}

export function createProject({ name, gitUrl, createdBy } = {}) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new Error(`invalid project name (expected /${NAME_RE.source}/): ${JSON.stringify(name)}`);
  }
  const registry = loadRegistry();
  if (registry.projects.some((p) => p.name === name)) throw new Error(`project already exists: ${name}`);
  const dir = projectDir(name);
  if (fs.existsSync(dir)) throw new Error(`project directory already exists: ${dir}`);

  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  if (gitUrl) {
    execFileSync('git', ['clone', '--', gitUrl, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  } else {
    fs.mkdirSync(dir);
    git(dir, 'init');
  }
  // Repo-local committer identity: queue mutations are committed by the server
  // (with --author carrying the human), regardless of the host's git config.
  git(dir, 'config', 'user.name', 'kanban-agent server');
  git(dir, 'config', 'user.email', 'server@kanban-agent.local');
  if (!gitUrl) {
    fs.writeFileSync(path.join(dir, 'README.md'), `# ${name}\n\nServer-managed kanban-agent project.\n`);
    git(dir, 'add', 'README.md');
    git(dir, 'commit', '-m', `init: server-managed project ${name}`);
  }

  const project = {
    name,
    gitUrl: gitUrl || null,
    createdBy: String(createdBy || ''),
    createdAt: new Date().toISOString(),
    archived: false,
  };
  registry.projects.push(project);
  saveRegistry(registry);
  return { project: { ...project }, dir };
}

export function archiveProject(name) {
  const registry = loadRegistry();
  const project = requireProject(registry, name);
  project.archived = true;
  saveRegistry(registry);
  return { ...project };
}

export function listRegistry({ includeArchived = false } = {}) {
  return loadRegistry()
    .projects.filter((p) => includeArchived || !p.archived)
    .map((p) => ({ ...p, dir: projectDir(p.name) }));
}

export function resolveProject(name) {
  const project = requireProject(loadRegistry(), name);
  if (project.archived) throw new Error(`project is archived: ${name}`);
  return { project: { ...project }, dir: projectDir(name) };
}
