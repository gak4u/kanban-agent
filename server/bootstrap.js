#!/usr/bin/env node
// One-time hosted-mode bootstrap: creates data/users.json with an admin user
// and prints the admin token — the only time it is ever shown in plaintext.
// Refuses to run against an existing store (rotate/revoke via lib/users.js).

import fs from 'node:fs';
import { createUser, STORE_PATH } from './lib/users.js';

if (fs.existsSync(STORE_PATH)) {
  console.error(`already bootstrapped: ${STORE_PATH} exists`);
  process.exit(1);
}

const { user, token } = createUser({ username: 'admin', email: '', role: 'admin' });

const bar = '='.repeat(72);
console.log(bar);
console.log('kanban-agent bootstrap — admin user created');
console.log(`  username: ${user.username}`);
console.log(`  role:     ${user.role}`);
console.log(`  token:    ${token}`);
console.log('');
console.log('  This token is shown ONCE and stored only as a sha256 hash.');
console.log(`  Store: ${STORE_PATH}`);
console.log(bar);
