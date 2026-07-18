/**
 * XFinder — Frontend Logic
 *
 * All data comes from the Tauri backend via window.__TAURI__.core.invoke().
 * No fake data, no CORS issues — the Rust layer handles all HTTP to servers.
 */

const { invoke } = window.__TAURI__.core;

// ─── App State ────────────────────────────────────────────────────────────────
let servers          = [];          // Server[] from list_servers
let currentResult    = null;        // SearchResult currently open
let currentSeason    = 1;
let screenStack      = ['home'];

// ─── Boot ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  await loadServers();
  setupSearch();
  setupKeyboard();
});

async function loadServers() {
  try {
    servers = await invoke('list_servers');
  } catch (e) {
    console.error('list_servers failed:', e);
    servers = [];
  }
  renderServerCount();
  renderServersManage();

  const hasServers = servers.length > 0;
  el('noServersState').style.display = hasServers ? 'none' : 'block';
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function goTo(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  el('screen-' + name).classList.add('active');
  if (screenStack[screenStack.length - 1] !== name) screenStack.push(name);
}

function goBack() {
  if (screenStack.length > 1) {
    screenStack.pop();
    const prev = screenStack[screenStack.length - 1];
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    el('screen-' + prev).classList.add('active');
  }
}

// ─── Keyboard ────────────────────────────────────────────────────────────────
function setupKeyboard() {
  window.addEventListener('keydown', e => {
    const tag = document.activeElement.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA';

    if (e.key === 'Escape') {
      e.preventDefault();
      if (typing) {
        document.activeElement.blur();
        clearSearch();
      } else {
        goBack();
      }
    }
  });
}

// ─── Search ───────────────────────────────────────────────────────────────────
function setupSearch() {
  const input = el('searchInput');

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
  });

  // Clear results when user empties the box
  input.addEventListener('input', e => {
    if (!e.target.value.trim()) clearSearch();
  });
}

async function runSearch() {
  const q = el('searchInput').value.trim();
  if (!q) { clearSearch(); return; }

  const activeServers = servers.filter(s => s.status === 'ok');
  if (activeServers.length === 0) {
    showToast('Nenhum servidor sincronizado. Adicione e sincronize um servidor primeiro.');
    return;
  }

  // Show animated scan rows
  el('resultsHead').style.display = 'none';
  el('resultsList').innerHTML = '';
  el('emptyState').style.display = 'none';
  el('noServersState').style.display = 'none';

  const scanList = el('scanList');
  scanList.innerHTML = activeServers.map(s => `
    <div class="scan-row checking" id="scan-${s.id}">
      <div class="spinner"></div>
      <span class="sname mono">${esc(s.name)}</span>
      <span class="sstatus">buscando...</span>
    </div>`).join('');

  // Invoke search (instant SQLite FTS5)
  let results = [];
  try {
    results = await invoke('search', { query: q });
  } catch (err) {
    showToast('Erro na busca: ' + err);
  }

  // Animate each scan row result (staggered for visual feedback)
  const serverIds = new Set(results.flatMap(r => r.servers.map(s => s.server_id)));

  activeServers.forEach((s, i) => {
    setTimeout(() => {
      const row = el(`scan-${s.id}`);
      if (!row) return;
      const found = serverIds.has(s.id);
      row.classList.remove('checking');
      row.classList.add(found ? 'found' : 'empty');
      row.innerHTML = `
        <span class="sname mono">${esc(s.name)}</span>
        <span class="sstatus">${found ? '✓ encontrado' : 'sem resultado'}</span>`;

      if (i === activeServers.length - 1) {
        setTimeout(() => displayResults(results, q), 300);
      }
    }, 200 + i * 180);
  });
}

function displayResults(results, q) {
  el('scanList').innerHTML = '';

  if (results.length === 0) {
    el('emptyState').style.display = 'block';
    return;
  }

  el('resultsHead').style.display = 'block';
  el('resultsCount').textContent =
    `${results.length} resultado${results.length > 1 ? 's' : ''} para "${q}"`;

  el('resultsList').innerHTML = results.map((r, idx) => `
    <button class="result-row fx" onclick="openResult(${idx})">
      ${thumbHtml(r.cover_url, 'thumb')}
      <div class="r-info">
        <div class="r-title">${esc(r.title)}</div>
        <div class="r-meta">
          <span class="type-tag">${typeLabel(r.type)}</span>
          ${r.year ? `<span>${r.year}</span>` : ''}
        </div>
      </div>
      <div class="servers-count mono">${r.servers.length} servidor${r.servers.length > 1 ? 'es' : ''}</div>
    </button>`).join('');

  window._searchResults = results;
}

function clearSearch() {
  el('searchInput').value = '';
  el('scanList').innerHTML = '';
  el('resultsHead').style.display = 'none';
  el('resultsList').innerHTML = '';
  el('emptyState').style.display = 'none';
  el('noServersState').style.display = servers.length === 0 ? 'block' : 'none';
}

// ─── Open result ──────────────────────────────────────────────────────────────
async function openResult(idx) {
  const r = window._searchResults[idx];
  currentResult = r;

  if (r.type === 'series') {
    currentSeason = 1;
    await openSeriesScreen(r);
  } else {
    openDetailScreen(r);
  }
}

// ─── Series screen ────────────────────────────────────────────────────────────
async function openSeriesScreen(r) {
  el('seriesContent').innerHTML = '<div style="color:var(--text-faint);padding:20px 0;">Carregando episódios...</div>';
  goTo('series');

  // Fetch episode data from the first Xtream server that has this series
  const xtreamOcc = r.servers.find(s => s.server_type === 'xtream');
  let episodeData = null;

  if (xtreamOcc && r.external_id) {
    try {
      episodeData = await invoke('get_episodes', {
        serverType: xtreamOcc.server_type,
        host:       xtreamOcc.host,
        port:       xtreamOcc.port,
        username:   xtreamOcc.username,
        password:   xtreamOcc.password,
        seriesId:   r.external_id,
      });
    } catch (e) {
      console.warn('get_episodes failed:', e);
    }
  }

  renderSeriesScreen(r, episodeData);
}

function renderSeriesScreen(r, episodeData) {
  const seasons = episodeData?.episodes
    ? Object.entries(episodeData.episodes).map(([num, eps]) => ({ num: parseInt(num), episodes: eps }))
    : [];

  seasons.sort((a, b) => a.num - b.num);
  if (!seasons.find(s => s.num === currentSeason) && seasons.length > 0) {
    currentSeason = seasons[0].num;
  }

  const tabsHtml = seasons.map(s => `
    <button class="season-tab fx ${s.num === currentSeason ? 'active' : ''}" data-season="${s.num}" onclick="selectSeason(${s.num})">
      Temporada ${s.num}
    </button>`).join('');

  const season    = seasons.find(s => s.num === currentSeason);
  const episodes  = season?.episodes ?? [];

  const epsHtml = episodes.length
    ? episodes.map(ep => {
        const sid = ep.id || ep.stream_id || '';
        const ext = ep.container_extension || 'mp4';
        // Build stream URL for this episode from the first available server
        const occ = r.servers.find(s => s.server_type === 'xtream');
        const url = occ ? buildStreamUrl(occ, sid, ext, 'series') : '';
        return `
          <button class="episode-row fx" onclick="openStream('${esc(url)}')">
            <div class="ep-number">${ep.episode_num ?? ep.num ?? '?'}</div>
            <div class="ep-info">
              <div class="ep-title">${esc(ep.title || 'Episódio')}</div>
              <div class="ep-meta">${ep.info?.duration_secs
                ? formatDuration(ep.info.duration_secs)
                : ep.info?.duration || ''}</div>
            </div>
            <div class="ep-action">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              Assistir
            </div>
          </button>`;
      }).join('')
    : '<div style="color:var(--text-faint);font-size:13px;padding:16px 0;">Nenhum episódio disponível.</div>';

  const noSeasons = seasons.length === 0
    ? '<div style="color:var(--text-faint);font-size:13px;padding:16px 0;">Dados de episódios não disponíveis para M3U.</div>'
    : '';

  el('seriesContent').innerHTML = `
    <div class="series-head">
      ${thumbHtml(r.cover_url, 'series-thumb')}
      <div>
        <div class="series-title">${esc(r.title)}</div>
        <div class="series-meta">${r.year || ''} · ${r.servers.length} servidor${r.servers.length > 1 ? 'es' : ''}</div>
        ${seasons.length ? `<div class="series-meta" style="margin-top:4px;">${seasons.length} temporada${seasons.length > 1 ? 's'  : ''}</div>` : ''}
      </div>
    </div>
    ${seasons.length ? `<div class="season-tabs">${tabsHtml}</div>
    <div class="episodes-label">${episodes.length} Episódios — Temporada ${currentSeason}</div>
    ${epsHtml}` : noSeasons}`;
}

function selectSeason(num) {
  currentSeason = num;
  renderSeriesScreen(currentResult, window._lastEpisodeData);
}

// ─── Detail screen (movie / live / episode) ───────────────────────────────────
function openDetailScreen(r, episodeCtx) {
  // r: SearchResult | episodeCtx: { ep, occ } optional
  const title    = episodeCtx ? r.title : r.title;
  const tags     = episodeCtx
    ? [typeLabel('series'), `T${currentSeason} E${episodeCtx.ep.episode_num ?? episodeCtx.ep.num}`,
       episodeCtx.ep.info?.duration || '']
    : [typeLabel(r.type), r.year || (r.type === 'live' ? 'ao vivo' : '')];

  const serverItemsHtml = r.servers.map(occ => {
    const url = buildStreamUrl(occ, occ.stream_id, occ.container_extension, r.type);
    return `
      <div class="server-item">
        <div class="si-info">
          <span class="sname">${esc(occ.server_name)}</span>
          <div class="smeta">
            <span class="shost mono">${occ.host ? `${occ.host}:${occ.port}` : 'M3U'}</span>
            ${expiryBadge(occ.expiry)}
          </div>
        </div>
        <button class="watch-btn fx" onclick="openStream('${esc(url)}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          Assistir
        </button>
      </div>`;
  }).join('');

  el('mediaContent').innerHTML = `
    <div class="media-head">
      ${thumbHtml(r.cover_url, 'media-thumb')}
      <div>
        <div class="media-title">${esc(title)}</div>
        <div class="media-tags">${tags.filter(Boolean).map(t => `<span class="type-tag">${esc(t)}</span>`).join('')}</div>
      </div>
    </div>
    <div class="servers-section">
      <div class="label">Disponível em</div>
      ${serverItemsHtml}
    </div>`;

  goTo('detail');
}

// ─── Stream URL builder ───────────────────────────────────────────────────────
function buildStreamUrl(occ, streamId, ext, type) {
  if (occ.raw_url) return occ.raw_url; // M3U: use raw URL directly

  if (!occ.host) return '';
  const pathType = type === 'live' ? 'live' : type === 'series' ? 'series' : 'movie';
  const extension = type === 'live' ? 'ts' : (ext || 'mp4');
  return `http://${occ.host}:${occ.port}/${pathType}/${occ.username}/${occ.password}/${streamId}.${extension}`;
}

async function openStream(url) {
  if (!url) { showToast('URL de stream não disponível.'); return; }
  try {
    await invoke('open_stream', { url });
  } catch (e) {
    showToast('Falha ao abrir stream: ' + e);
  }
}

// ─── Settings / server management ─────────────────────────────────────────────
function renderServerCount() {
  const ok = servers.filter(s => s.status === 'ok').length;
  el('serverCountLabel').textContent = ok;
}

function renderServersManage() {
  const list = el('serversManageList');
  if (servers.length === 0) {
    list.innerHTML = '<div style="color:var(--text-faint);font-size:13px;padding:10px 0;">Nenhum servidor adicionado.</div>';
    return;
  }

  list.innerHTML = servers.map(s => {
    const statusLabel = { ok: 'sincronizado', syncing: 'sincronizando...', error: 'erro', pending: 'pendente' }[s.status] || s.status;
    const hostLine = s.type === 'xtream' ? `${s.host}:${s.port}` : s.m3u_url || '';
    return `
      <div class="servers-manage-item">
        <div class="info">
          <div class="sm-name">${esc(s.name)}</div>
          <div class="sm-host mono">
            ${esc(hostLine)}
            ${expiryBadge(s.expiry)}
          </div>
        </div>
        <span class="sm-status ${s.status}">${statusLabel}</span>
        <button class="icon-mini-btn fx" onclick="syncServer(${s.id})" title="Sincronizar" aria-label="Sincronizar">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <polyline points="23 4 23 10 17 10"></polyline>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
          </svg>
        </button>
        <button class="icon-mini-btn fx" onclick="removeServer(${s.id})" title="Remover" aria-label="Remover servidor">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
          </svg>
        </button>
      </div>`;
  }).join('');
}

function setAddMode(mode) {
  ['Xtream', 'M3u'].forEach(m => {
    el('tab'    + m).classList.toggle('active', m.toLowerCase() === mode);
    el('fields' + m).classList.toggle('active', m.toLowerCase() === mode);
  });
}

async function addServer(type) {
  let name, host, port, username, password, m3uUrl;

  if (type === 'xtream') {
    name     = el('xName').value.trim();
    host     = el('xHost').value.trim();
    port     = el('xPort').value.trim();
    username = el('xUser').value.trim();
    password = el('xPass').value.trim();
    if (!name || !host || !port) { showToast('Preencha Nome, Host e Porta.'); return; }
  } else {
    name   = el('mName').value.trim();
    m3uUrl = el('mUrl').value.trim();
    if (!name || !m3uUrl) { showToast('Preencha Nome e URL M3U.'); return; }
  }

  const btn = el(type === 'xtream' ? 'btnAddXtream' : 'btnAddM3u');
  btn.disabled = true;
  btn.textContent = 'Adicionando...';

  try {
    const id = await invoke('add_server', {
      name, serverType: type,
      host:     host     || null,
      port:     port     || null,
      username: username || null,
      password: password || null,
      m3uUrl:   m3uUrl   || null,
    });

    // Clear fields
    ['xName','xHost','xPort','xUser','xPass','mName','mUrl'].forEach(f => {
      const el2 = document.getElementById(f); if (el2) el2.value = '';
    });

    await loadServers();
    showToast('Servidor adicionado. Sincronizando...');

    // Auto-sync immediately
    syncServer(id);
  } catch (e) {
    showToast('Erro ao adicionar: ' + e);
  } finally {
    btn.disabled = false;
    btn.textContent = type === 'xtream' ? '+ Adicionar e sincronizar' : '+ Adicionar lista';
  }
}

async function removeServer(id) {
  try {
    await invoke('remove_server', { serverId: id });
    await loadServers();
  } catch (e) {
    showToast('Erro ao remover: ' + e);
  }
}

async function syncServer(id) {
  // Update UI immediately
  servers = servers.map(s => s.id === id ? { ...s, status: 'syncing' } : s);
  renderServersManage();
  renderServerCount();

  try {
    const msg = await invoke('sync_server', { serverId: id });
    showToast(msg);
  } catch (e) {
    showToast('Erro na sincronização: ' + e);
  }

  await loadServers();
}

async function refreshAll() {
  const btn = el('btnRefresh');
  btn.classList.add('spinning');
  btn.disabled = true;

  const pending = servers.filter(s => s.status !== 'syncing');
  for (const s of pending) {
    await syncServer(s.id);
  }

  btn.classList.remove('spinning');
  btn.disabled = false;
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function typeLabel(t) {
  return { movie: 'Filme', series: 'Série', live: 'Ao vivo' }[t] || t;
}

function thumbHtml(coverUrl, cls) {
  if (coverUrl) {
    return `<div class="${cls}"><img src="${esc(coverUrl)}" alt="" loading="lazy" onerror="this.parentElement.style.backgroundImage='none'"></div>`;
  }
  return `<div class="${cls}"></div>`;
}

function expiryBadge(expiry) {
  if (!expiry) return '';
  const days = Math.ceil((new Date(expiry) - new Date()) / 86400000);
  let cls, label;
  if      (days < 0)    { cls = 'danger'; label = 'Vencido'; }
  else if (days === 0)  { cls = 'danger'; label = 'Vence hoje'; }
  else if (days <= 7)   { cls = 'danger'; label = `Vence em ${days}d`; }
  else if (days <= 30)  { cls = 'warn';   label = `Vence em ${days}d`; }
  else {
    label = new Date(expiry).toLocaleDateString('pt-BR');
    cls   = 'ok';
  }
  return `<span class="expiry-badge ${cls}">${label}</span>`;
}

function formatDuration(secs) {
  const m = Math.floor(secs / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}min` : `${m}min`;
}

let _toastTimer;
function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = `
      position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
      background:#1A1D22; border:1px solid rgba(255,255,255,.12); color:#E9EAEC;
      padding:10px 18px; border-radius:10px; font-size:13px; z-index:999;
      box-shadow:0 4px 24px rgba(0,0,0,.6); max-width:90vw; text-align:center;
      transition: opacity .2s ease;`;
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 3500);
}
