/* Kanban Agent — admin panel (hosted mode). Token lives in localStorage and is
   sent as a Bearer header; the server enforces admin-only on /api/admin/*. */
(() => {
  'use strict';

  const TOKEN_KEY = 'kanban-admin-token';
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const authBadge = $('#auth-badge');
  const errorBanner = $('#error-banner');
  const tokenReveal = $('#token-reveal');

  let token = localStorage.getItem(TOKEN_KEY) || '';

  function setAuthBadge(text, cls) {
    authBadge.textContent = text;
    authBadge.className = `live-badge${cls ? ` ${cls}` : ''}`;
  }

  function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.hidden = false;
  }
  function clearError() {
    errorBanner.hidden = true;
  }

  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  // One-time token display: shown exactly once by the server, so make that loud.
  function revealToken(who, tok) {
    tokenReveal.innerHTML = `
      <div class="head">Token for <strong>${esc(who)}</strong> — shown ONCE, stored only as a hash. Copy it now.</div>
      <div class="row"><code>${esc(tok)}</code><button type="button" class="copy">Copy</button></div>
    `;
    tokenReveal.hidden = false;
    tokenReveal.querySelector('.copy').addEventListener('click', async (e) => {
      try {
        await navigator.clipboard.writeText(tok);
        e.target.textContent = 'Copied ✓';
      } catch {
        e.target.textContent = 'Copy failed — select manually';
      }
    });
  }

  function renderUsers(users) {
    const rows = users.map(
      (u) => `<tr>
        <td>${esc(u.username)}</td>
        <td>${esc(u.email) || '<span class="empty">—</span>'}</td>
        <td><span class="badge${u.role === 'admin' ? ' prio-P1' : ''}">${esc(u.role)}</span></td>
        <td>${esc((u.createdAt || '').slice(0, 10))}</td>
        <td class="actions">
          <button data-act="rotate" data-user="${esc(u.username)}">Rotate token</button>
          <button data-act="revoke" data-user="${esc(u.username)}" class="danger">Revoke</button>
        </td>
      </tr>`
    );
    $('#users-table tbody').innerHTML = rows.join('') || '<tr><td colspan="5" class="empty">no users</td></tr>';
  }

  function renderProjects(projects) {
    const rows = projects.map(
      (p) => `<tr${p.archived ? ' class="archived"' : ''}>
        <td>${esc(p.name)}${p.archived ? ' <span class="badge">archived</span>' : ''}</td>
        <td>${esc(p.gitUrl) || '<span class="empty">—</span>'}</td>
        <td>${esc(p.createdBy) || '<span class="empty">—</span>'}</td>
        <td>${esc((p.createdAt || '').slice(0, 10))}</td>
        <td class="actions">${p.archived ? '' : `<button data-act="archive" data-project="${esc(p.name)}" class="danger">Archive</button>`}</td>
      </tr>`
    );
    $('#projects-table tbody').innerHTML = rows.join('') || '<tr><td colspan="5" class="empty">no projects</td></tr>';
  }

  async function refresh() {
    if (!token) {
      setAuthBadge('no token');
      return;
    }
    clearError();
    try {
      const [u, p] = await Promise.all([api('GET', '/api/admin/users'), api('GET', '/api/admin/projects')]);
      renderUsers(u.users || []);
      renderProjects(p.projects || []);
      setAuthBadge('admin ✓', 'live');
    } catch (err) {
      setAuthBadge('rejected', 'poll');
      showError(err.message);
    }
  }

  // ---------- events ----------

  $('#token-form').addEventListener('submit', (e) => {
    e.preventDefault();
    token = $('#token-input').value.trim();
    localStorage.setItem(TOKEN_KEY, token);
    refresh();
  });

  $('#token-clear').addEventListener('click', () => {
    token = '';
    localStorage.removeItem(TOKEN_KEY);
    $('#token-input').value = '';
    setAuthBadge('no token');
  });

  $('#user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    clearError();
    try {
      const { user, token: newToken } = await api('POST', '/api/admin/users', {
        username: f.get('username'),
        email: f.get('email'),
        role: f.get('role'),
      });
      revealToken(user.username, newToken);
      e.target.reset();
      refresh();
    } catch (err) {
      showError(err.message);
    }
  });

  $('#project-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    clearError();
    try {
      await api('POST', '/api/admin/projects', { name: f.get('name'), git_url: f.get('git_url') || undefined });
      e.target.reset();
      refresh();
    } catch (err) {
      showError(err.message);
    }
  });

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    clearError();
    try {
      if (btn.dataset.act === 'revoke') {
        await api('POST', '/api/admin/users/revoke', { username: btn.dataset.user });
      } else if (btn.dataset.act === 'rotate') {
        const { username, token: newToken } = await api('POST', '/api/admin/users/rotate', { username: btn.dataset.user });
        revealToken(username, newToken);
      } else if (btn.dataset.act === 'archive') {
        await api('POST', '/api/admin/projects/archive', { name: btn.dataset.project });
      }
      refresh();
    } catch (err) {
      showError(err.message);
    }
  });

  if (token) $('#token-input').value = token;
  refresh();
})();
