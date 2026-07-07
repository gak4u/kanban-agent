/* Kanban Agent — plain-JS frontend, no framework. Read-only. */
(() => {
  'use strict';

  const STATUSES = ['pending', 'in-progress', 'blocked', 'done'];
  const STATUS_LABEL = {
    pending: 'Pending',
    'in-progress': 'In progress',
    blocked: 'Blocked',
    done: 'Done',
  };

  const app = document.getElementById('app');
  const liveBadge = document.getElementById('live-badge');
  const drawer = document.getElementById('drawer');
  const overlay = document.getElementById('drawer-overlay');

  let state = null; // last /api/projects payload

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function relTime(ms) {
    if (!ms) return '';
    const s = (Date.now() - ms) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
    return new Date(ms).toISOString().slice(0, 10);
  }

  // ---------- data ----------

  async function load() {
    try {
      const res = await fetch('/api/projects');
      state = await res.json();
    } catch {
      if (!state) app.innerHTML = '<p class="empty">Cannot reach the server.</p>';
      return;
    }
    render();
  }

  // ---------- live updates: SSE with polling fallback ----------

  let pollTimer = null;
  let esFails = 0;

  function startPolling() {
    if (pollTimer) return;
    liveBadge.textContent = 'polling 10s';
    liveBadge.className = 'live-badge poll';
    pollTimer = setInterval(load, 10000);
  }

  function connectLive() {
    let es;
    try {
      es = new EventSource('/api/events');
    } catch {
      return startPolling();
    }
    es.addEventListener('refresh', () => load());
    es.onopen = () => {
      esFails = 0;
      liveBadge.textContent = 'live';
      liveBadge.className = 'live-badge live';
    };
    es.onerror = () => {
      esFails++;
      if (es.readyState === EventSource.CLOSED || esFails >= 3) {
        es.close();
        startPolling();
      }
    };
  }

  // ---------- overview ----------

  function projectCard(p) {
    const doneCount = p.counts.done || 0;
    const pct = p.total ? Math.round((doneCount / p.total) * 100) : 0;
    const inProgress = (p.items['in-progress'] || []).map(
      (it) => `<li title="${esc(it.title)}">${esc(`#${it.id} ${it.title}`)}</li>`
    );
    const blockedHot = (p.counts.blocked || 0) > 0 ? ' hot' : '';
    const stats = STATUSES.map(
      (s) => `<div class="stat ${s}${s === 'blocked' ? blockedHot : ''}">
        <div class="num">${p.counts[s] || 0}</div>
        <div class="lbl">${STATUS_LABEL[s]}</div>
      </div>`
    ).join('');
    return `<a class="project-card" href="#/project/${encodeURIComponent(p.name)}">
      <h2>${esc(p.name)} ${p.managed ? '<span class="tag managed">server-managed</span>' : ''}${p.discovered ? '<span class="tag">auto</span>' : ''}</h2>
      <div class="path">${esc(p.path)}</div>
      <div class="stat-row">${stats}</div>
      <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
      <div class="progress-caption"><span>${doneCount} of ${p.total} done</span><span>${pct}%</span></div>
      <div class="now-playing">
        <span class="lbl">In progress now</span>
        <ul>${inProgress.length ? inProgress.join('') : '<li class="idle">nothing in progress</li>'}</ul>
      </div>
    </a>`;
  }

  // Every in-progress item across all projects: user → #NNN title (project).
  function claimsStrip() {
    const claims = [];
    for (const p of state.projects || []) {
      for (const it of (p.items && p.items['in-progress']) || []) {
        claims.push({ user: it.claimedBy, id: it.id, title: it.title, project: p.name });
      }
    }
    if (!claims.length) return '';
    const rows = claims.map(
      (c) => `<li><a href="#/project/${encodeURIComponent(c.project)}">
        <span class="who">${esc(c.user || '—')}</span> → #${esc(c.id)} ${esc(c.title)}
        <span class="proj">(${esc(c.project)})</span></a></li>`
    );
    return `<div class="claims-strip">
      <span class="lbl">Active claims</span>
      <ul>${rows.join('')}</ul>
    </div>`;
  }

  function renderOverview() {
    const projects = state.projects || [];
    document.title = 'Kanban Agent';
    app.innerHTML = `
      <div class="page-title">Projects <span class="sub">${projects.length} tracked</span></div>
      ${claimsStrip()}
      ${projects.length ? `<div class="project-grid">${projects.map(projectCard).join('')}</div>` : '<p class="empty">No projects configured or discovered. Edit <code>projects.json</code>.</p>'}
    `;
  }

  // ---------- board ----------

  function itemCard(p, it) {
    const badges = [];
    if (it.type) badges.push(`<span class="badge type-${esc(it.type)}">${esc(it.type)}</span>`);
    if (it.priority) badges.push(`<span class="badge prio-${esc(it.priority)}">${esc(it.priority)}</span>`);
    if (it.created) badges.push(`<span class="badge">${esc(it.created)}</span>`);
    if (it.stacksOn) badges.push(`<span class="badge chip">stacks on #${esc(it.stacksOn)}</span>`);
    if (it.dependsOn) badges.push(`<span class="badge chip">depends on #${esc(it.dependsOn)}</span>`);
    if (it.needsMigration) badges.push(`<span class="badge">migration</span>`);
    if (it.parseError) badges.push(`<span class="badge">parse error</span>`);
    if (it.createdBy) badges.push(`<span class="badge user" title="created by ${esc(it.createdBy)}">by ${esc(it.createdBy)}</span>`);
    // In-progress cards show the claimer prominently (line below); elsewhere it's a chip.
    if (it.claimedBy && it.status !== 'in-progress') {
      badges.push(`<span class="badge user" title="claimed by ${esc(it.claimedBy)}">claimed: ${esc(it.claimedBy)}</span>`);
    }
    const claimerLine =
      it.status === 'in-progress' && it.claimedBy
        ? `<div class="claimer" title="claimed by ${esc(it.claimedBy)}"><span class="avatar">${esc(it.claimedBy[0].toUpperCase())}</span>${esc(it.claimedBy)}</div>`
        : '';

    const checks = it.checks && it.checks.total
      ? `<span class="checks${it.checks.done === it.checks.total ? ' full' : ''}">${it.checks.done}/${it.checks.total} ✓</span>`
      : '<span></span>';
    const blockedLine =
      it.status === 'blocked' && it.blockedNote
        ? `<div class="blocked-note" title="${esc(it.blockedNote)}">${esc(it.blockedNote.split('\n')[0])}</div>`
        : '';

    return `<button class="card" data-status="${esc(it.status)}" data-file="${esc(it.file)}">
      <div class="top"><span class="num">#${esc(it.id)}</span><span class="title">${esc(it.title)}</span></div>
      ${claimerLine}
      <div class="badges">${badges.join('')}</div>
      ${blockedLine}
      <div class="meta">${checks}<span title="last activity">${relTime(it.mtime)}</span></div>
    </button>`;
  }

  function renderBoard(name) {
    const p = (state.projects || []).find((x) => x.name === name);
    if (!p) {
      app.innerHTML = `<p class="empty">Unknown project “${esc(name)}”. <a href="#/">← back to overview</a></p>`;
      return;
    }
    document.title = `${p.name} — Kanban Agent`;
    const columns = STATUSES.map((s) => {
      const items = p.items[s] || [];
      return `<section class="column ${s}">
        <div class="column-head"><span>${STATUS_LABEL[s]}</span><span class="count">${items.length}</span></div>
        <div class="column-body">${items.length ? items.map((it) => itemCard(p, it)).join('') : `<div class="none">empty</div>`}</div>
      </section>`;
    }).join('');
    app.innerHTML = `
      <div class="board-head">
        <a class="back" href="#/">← all projects</a>
        <h1>${esc(p.name)}</h1>
        <span class="path">${esc(p.path)}</span>
      </div>
      <div class="board">${columns}</div>
    `;
    app.querySelectorAll('.card').forEach((el) => {
      el.addEventListener('click', () => openItem(p.name, el.dataset.status, el.dataset.file));
    });
  }

  // ---------- item drawer ----------

  async function openItem(project, status, file) {
    let item;
    try {
      const res = await fetch(
        `/api/item?project=${encodeURIComponent(project)}&status=${encodeURIComponent(status)}&file=${encodeURIComponent(file)}`
      );
      if (!res.ok) throw new Error(String(res.status));
      item = await res.json();
    } catch {
      return;
    }
    const fm = Object.entries(item.frontmatter || {})
      .map(([k, v]) => {
        // the folder is authoritative; flag a stale frontmatter status
        const stale = k === 'status' && v !== item.status ? ` <span class="stale">(stale — folder says ${esc(item.status)})</span>` : '';
        return `<dt>${esc(k)}</dt><dd>${esc(v)}${stale}</dd>`;
      })
      .join('');
    drawer.innerHTML = `
      <div class="drawer-top">
        <div>
          <div class="num">#${esc(item.id)} · ${esc(STATUS_LABEL[item.status] || item.status)} · ${esc(item.file)}</div>
          <h1>${esc(item.title)}</h1>
        </div>
        <button class="close" aria-label="Close">✕ close</button>
      </div>
      ${fm ? `<dl class="fm">${fm}</dl>` : ''}
      <div class="md">${item.html || '<p class="empty">(empty file)</p>'}</div>
    `;
    drawer.hidden = false;
    overlay.hidden = false;
    drawer.scrollTop = 0;
    drawer.querySelector('.close').addEventListener('click', closeDrawer);
  }

  function closeDrawer() {
    drawer.hidden = true;
    overlay.hidden = true;
  }
  overlay.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
  });

  // ---------- routing ----------

  function render() {
    if (!state) return;
    const m = /^#\/project\/(.+)$/.exec(location.hash);
    if (m) renderBoard(decodeURIComponent(m[1]));
    else renderOverview();
  }

  window.addEventListener('hashchange', () => {
    closeDrawer();
    render();
  });

  load();
  connectLive();
})();
