// kanban-agent hosted-mode user registry — JSON store at data/users.json.
// Tokens are random 32-byte hex, persisted ONLY as sha256 hashes; the
// plaintext surfaces exactly once (the createUser / rotateToken return value).
// Every operation re-reads the store and writes atomically (temp + rename) —
// concurrent-safe enough for a single server process.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const DATA_DIR = process.env.KANBAN_DATA_DIR || path.join(REPO_ROOT, 'data');
export const STORE_PATH = path.join(DATA_DIR, 'users.json');

const USERNAME_RE = /^[a-z0-9-_]{2,32}$/;
const ROLES = ['admin', 'member'];

function loadStore() {
  let text;
  try {
    text = fs.readFileSync(STORE_PATH, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { users: [] };
    throw err;
  }
  const store = JSON.parse(text);
  if (!Array.isArray(store.users)) store.users = [];
  return store;
}

function saveStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = path.join(DATA_DIR, `.users.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, STORE_PATH);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Public view of a user — never exposes tokenHash.
function publicUser(u) {
  return { username: u.username, email: u.email, role: u.role, createdAt: u.createdAt };
}

function requireUser(store, username) {
  const user = store.users.find((u) => u.username === username);
  if (!user) throw new Error(`unknown username: ${JSON.stringify(username)}`);
  return user;
}

export function createUser({ username, email, role } = {}) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    throw new Error(`invalid username (expected /${USERNAME_RE.source}/): ${JSON.stringify(username)}`);
  }
  if (!ROLES.includes(role)) {
    throw new Error(`invalid role (expected ${ROLES.join(' | ')}): ${JSON.stringify(role)}`);
  }
  const store = loadStore();
  if (store.users.some((u) => u.username === username)) {
    throw new Error(`username already exists: ${username}`);
  }
  const token = newToken();
  const user = {
    username,
    email: typeof email === 'string' ? email : '',
    role,
    tokenHash: hashToken(token),
    createdAt: new Date().toISOString(),
  };
  store.users.push(user);
  saveStore(store);
  return { user: publicUser(user), token };
}

export function verifyToken(token) {
  if (typeof token !== 'string' || !token) return null;
  const hash = hashToken(token);
  for (const u of loadStore().users) {
    if (typeof u.tokenHash !== 'string' || u.tokenHash.length !== hash.length) continue;
    if (crypto.timingSafeEqual(Buffer.from(u.tokenHash), Buffer.from(hash))) return publicUser(u);
  }
  return null;
}

export function listUsers() {
  return loadStore().users.map(publicUser);
}

// Marks the user's token invalid by deleting tokenHash; issues nothing new.
export function revokeUser(username) {
  const store = loadStore();
  const user = requireUser(store, username);
  delete user.tokenHash;
  saveStore(store);
  return publicUser(user);
}

export function rotateToken(username) {
  const store = loadStore();
  const user = requireUser(store, username);
  const token = newToken();
  user.tokenHash = hashToken(token);
  saveStore(store);
  return token;
}
