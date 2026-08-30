/**
 * XFinder — Frontend Logic (Webapp)
 *
 * Dados vêm do servidor Express local via fetch().
 * invoke() é um shim que mapeia os mesmos comandos IPC para endpoints REST,
 * mantendo o restante do código sem alterações.
 */

/**
 * Shim de invoke() — mapeia comandos para endpoints REST.
 * @param {string} cmd
 * @param {Record<string, unknown>} args
 */
async function invoke(cmd, args = {}) {
  const api = async (method, path, body) => {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch('/api' + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data;
  };

  switch (cmd) {
    case 'list_servers':
      return api('GET', '/servers');

    case 'add_server':
      return api('POST', '/servers', args).then(d => d.id);

    case 'remove_server':
      return api('DELETE', `/servers/${args.serverId}`);

    case 'sync_server':
      return api('POST', `/servers/${args.serverId}/sync`).then(d => d.message);

    case 'search':
      return api('GET', `/search?q=${encodeURIComponent(args.query ?? '')}`);

    case 'get_episodes':
      return api('GET',
        `/episodes?${new URLSearchParams({
          serverType: args.serverType ?? '',
          host:       args.host       ?? '',
          port:       args.port       ?? '',
          username:   args.username   ?? '',
          password:   args.password   ?? '',
          seriesId:   args.seriesId   ?? '',
        })}`
      );

    case 'open_stream':
      // Em modo webapp, abre o stream em nova aba do browser
      if (args.url) window.open(args.url, '_blank', 'noopener');
      return;

    default:
      throw new Error(`Comando desconhecido: ${cmd}`);
  }
}

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
  renderHomeLibrary();

  const xHost = el('xHost');
  if (xHost) {
    xHost.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      if (val.includes('get.php') || val.includes('username=') || val.includes('password=')) {
        try {
          const url = new URL(val);
          e.target.value = url.origin;
          const user = url.searchParams.get('username');
          const pass = url.searchParams.get('password');
          if (user) el('xUser').value = user;
          if (pass) el('xPass').value = pass;
        } catch (err) {}
      }
    });
  }
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
  const pModal = el('playerModal');
  if (pModal && pModal.style.display !== 'none') {
    closePlayer();
    return;
  }
  const choiceModal = el('playChoiceModal');
  if (choiceModal && choiceModal.style.display !== 'none') {
    closePlayChoice();
    return;
  }
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
    const pModal = el('playerModal');
    const isPlayerOpen = pModal && pModal.style.display !== 'none';

    if (e.key === 'Escape') {
      e.preventDefault();
      const choiceModal = el('playChoiceModal');
      if (choiceModal && choiceModal.style.display !== 'none') {
        closePlayChoice();
        return;
      }
      if (isPlayerOpen) {
        closePlayer();
        return;
      }
      if (typing) {
        document.activeElement.blur();
        clearSearch();
      } else {
        goBack();
      }
      return;
    }

    // Teclas de atalho para episódios quando o player está aberto
    if (isPlayerOpen && !typing) {
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        playNextEpisode();
        return;
      }
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        playPrevEpisode();
        return;
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
  if (el('homeLibrary')) el('homeLibrary').style.display = 'none';

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
  if (el('homeLibrary')) {
    el('homeLibrary').style.display = 'flex';
    renderHomeLibrary();
  }
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
  el('seriesContent').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;padding:60px 0;gap:12px;color:var(--text-dim);">
      <div class="spinner" style="width:16px;height:16px;"></div>
      <span>Carregando detalhes e episódios...</span>
    </div>`;
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

  window._lastEpisodeData = episodeData;
  renderSeriesScreen(r, episodeData);
}

function renderSeriesScreen(r, episodeData) {
  const info = episodeData?.info || {};
  const plot = info.plot || info.description || '';
  const genre = info.genre || '';
  const rating = info.rating || info.rating_5based || '';
  const backdrop = info.backdrop_path?.[0] || r.cover_url || '';

  const seasons = episodeData?.episodes
    ? Object.entries(episodeData.episodes).map(([num, eps]) => ({ num: parseInt(num, 10), episodes: eps }))
    : [];

  seasons.sort((a, b) => a.num - b.num);
  if (!seasons.find(s => s.num === currentSeason) && seasons.length > 0) {
    currentSeason = seasons[0].num;
  }

  // Estatísticas de episódios assistidos
  let totalEpisodes = 0;
  let totalWatched = 0;
  let nextUnwatchedEp = null;

  seasons.forEach(s => {
    s.episodes.forEach(ep => {
      totalEpisodes++;
      const epNum = ep.episode_num ?? ep.num ?? 0;
      const key = watchedKey(r, s.num, epNum);
      if (isWatched(key)) {
        totalWatched++;
      } else if (!nextUnwatchedEp) {
        const sid = ep.id || ep.stream_id || '';
        const ext = ep.container_extension || 'mp4';
        const occ = r.servers.find(srv => srv.server_type === 'xtream');
        const streamUrl = occ ? buildStreamUrl(occ, sid, ext, 'series') : '';
        nextUnwatchedEp = {
          seasonNum: s.num,
          epNum,
          title: ep.title || `Episódio ${epNum}`,
          url: streamUrl,
          wKey: key,
        };
      }
    });
  });

  const totalProgressPct = totalEpisodes > 0 ? Math.round((totalWatched / totalEpisodes) * 100) : 0;

  // Hero Section
  const heroHtml = `
    <div class="hero-wrapper">
      ${backdrop ? `<div class="hero-backdrop" style="background-image:url('${esc(backdrop)}')"></div>` : ''}
      <div class="hero-content">
        <div class="hero-poster">
          ${r.cover_url ? `<img src="${esc(r.cover_url)}" alt="${esc(r.title)}" loading="lazy" onerror="this.style.display='none'">` : ''}
        </div>
        <div class="hero-info">
          <h1 class="hero-title">${esc(r.title)}</h1>
          <div class="hero-tags">
            <span class="hero-badge accent">📺 Série</span>
            ${r.year ? `<span class="hero-badge">${r.year}</span>` : ''}
            ${rating ? `<span class="hero-badge">⭐ ${esc(String(rating).slice(0, 4))}</span>` : ''}
            ${genre ? `<span class="hero-badge">${esc(genre.split('/')[0].trim())}</span>` : ''}
            <span class="hero-badge">${r.servers.length} servidor${r.servers.length > 1 ? 'es' : ''}</span>
            ${seasons.length ? `<span class="hero-badge">${seasons.length} temporada${seasons.length > 1 ? 's' : ''}</span>` : ''}
          </div>

          ${plot ? `<p class="hero-plot">${esc(plot)}</p>` : ''}

          ${totalEpisodes > 0 ? `
            <div class="series-progress-box">
              <div class="series-progress-label">
                <span>Progresso Geral da Série</span>
                <span>${totalWatched} de ${totalEpisodes} assistidos (${totalProgressPct}%)</span>
              </div>
              <div class="series-progress-track">
                <div class="series-progress-fill" style="width:${totalProgressPct}%"></div>
              </div>
            </div>
          ` : ''}

          <div class="hero-actions">
            ${nextUnwatchedEp && nextUnwatchedEp.url ? `
              <button class="hero-play-btn fx" onclick="playEpisodeDirect('${esc(nextUnwatchedEp.url)}', '${esc(nextUnwatchedEp.wKey)}', '${esc(r.title)}', 'T${nextUnwatchedEp.seasonNum} E${nextUnwatchedEp.epNum} • ${esc(nextUnwatchedEp.title)}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                ${totalWatched > 0 ? `Continuar: T${nextUnwatchedEp.seasonNum} E${nextUnwatchedEp.epNum}` : 'Começar a Assistir: T1 E1'}
              </button>
            ` : ''}
            <button class="hero-sec-btn fx ${isFavorite(r) ? 'fav-active' : ''}" id="btnHeroFav" onclick="toggleCurrentFavorite()">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="${isFavorite(r) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
              <span>${isFavorite(r) ? 'Favorito' : 'Favoritar'}</span>
            </button>
            ${seasons.length ? `
              <button class="hero-sec-btn fx" onclick="toggleSeasonWatched(${currentSeason})">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                Marcar Temporada ${currentSeason}
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    </div>
  `;

  if (seasons.length === 0) {
    el('seriesContent').innerHTML = heroHtml + buildDirectStreamSection(r);
    return;
  }

  // Season Tabs com contadores de progresso por temporada
  const tabsHtml = seasons.map(s => {
    let sWatched = 0;
    s.episodes.forEach(ep => {
      const epNum = ep.episode_num ?? ep.num ?? 0;
      if (isWatched(watchedKey(r, s.num, epNum))) sWatched++;
    });
    const sPct = s.episodes.length > 0 ? Math.round((sWatched / s.episodes.length) * 100) : 0;
    const isCompleted = sWatched === s.episodes.length && s.episodes.length > 0;

    return `
      <button class="season-tab fx ${s.num === currentSeason ? 'active' : ''}" data-season="${s.num}" onclick="selectSeason(${s.num})">
        <span>Temporada ${s.num}</span>
        <span class="season-tab-badge">${isCompleted ? '✓ Completa' : `${sWatched}/${s.episodes.length}`}</span>
        <div class="season-tab-bar">
          <div class="season-tab-bar-fill" style="width:${sPct}%"></div>
        </div>
      </button>
    `;
  }).join('');

  const currentSeasonData = seasons.find(s => s.num === currentSeason);
  const currentEpisodes = currentSeasonData?.episodes ?? [];

  // Calcular status da temporada atual
  let curSeasonWatchedCount = 0;
  currentEpisodes.forEach(ep => {
    const epNum = ep.episode_num ?? ep.num ?? 0;
    if (isWatched(watchedKey(r, currentSeason, epNum))) curSeasonWatchedCount++;
  });
  const allCurrentWatched = currentEpisodes.length > 0 && curSeasonWatchedCount === currentEpisodes.length;

  const epsCardsHtml = currentEpisodes.length ? `
    <div class="episodes-list">
      ${currentEpisodes.map(ep => {
        const sid = ep.id || ep.stream_id || '';
        const ext = ep.container_extension || 'mp4';
        const occ = r.servers.find(srv => srv.server_type === 'xtream');
        const streamUrl = occ ? buildStreamUrl(occ, sid, ext, 'series') : '';
        const epNum = ep.episode_num ?? ep.num ?? 0;
        const wKey = watchedKey(r, currentSeason, epNum);
        const seen = isWatched(wKey);
        const epThumb = ep.info?.movie_image || ep.stream_icon || '';
        const epDuration = ep.info?.duration_secs ? formatDuration(ep.info.duration_secs) : (ep.info?.duration || '');
        const epPlot = ep.info?.plot || '';
        const epSubTitle = `T${currentSeason} E${epNum} • ${ep.title || 'Episódio'}`;

        return `
          <div class="episode-card ${seen ? 'watched' : ''}" id="ep-card-${epNum}">
            <div class="ep-thumb-box fx" tabindex="0" onclick="playEpisodeDirect('${esc(streamUrl)}', '${esc(wKey)}', '${esc(r.title)}', '${esc(epSubTitle)}', ${currentSeason}, ${epNum})">
              <img src="${esc(epThumb)}" class="ep-thumb-img" alt="" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" ${!epThumb ? 'style="display:none"' : ''}>
              <div class="ep-thumb-fallback" style="${epThumb ? 'display:none' : 'display:flex'}">
                <span class="ep-num-big">E${epNum}</span>
              </div>
              <div class="ep-play-overlay">
                <div class="ep-play-circle">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </div>
              </div>
              ${seen ? '<span class="ep-watched-tag">✓ Visto</span>' : ''}
              ${epDuration ? `<span class="ep-duration-tag">${esc(epDuration)}</span>` : ''}
              ${seen ? '<div class="ep-progress-indicator"></div>' : ''}
            </div>

            <div class="ep-card-body">
              <div class="ep-card-title-row">
                <span class="ep-card-num">E${epNum}</span>
                <span class="ep-card-title" title="${esc(ep.title || 'Episódio')}">${esc(ep.title || `Episódio ${epNum}`)}</span>
              </div>
              <div class="ep-card-meta">
                ${epDuration ? `<span>⏱ ${esc(epDuration)}</span>` : ''}
                ${ep.info?.releasedate ? `<span>📅 ${esc(ep.info.releasedate)}</span>` : ''}
              </div>
              ${epPlot ? `<div class="ep-card-plot">${esc(epPlot)}</div>` : ''}
            </div>

            <div class="ep-card-actions">
              <button class="ep-eye-btn fx"
                data-wkey="${esc(wKey)}"
                onclick="toggleWatched(event)"
                title="${seen ? 'Marcar como não assistido' : 'Marcar como assistido'}">
                ${seen ? _eyeOn() : _eyeOff()}
              </button>
              <button class="ep-card-btn-watch fx"
                onclick="playEpisodeDirect('${esc(streamUrl)}', '${esc(wKey)}', '${esc(r.title)}', '${esc(epSubTitle)}', ${currentSeason}, ${epNum})">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                Assistir
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  ` : '<div style="color:var(--text-faint);padding:30px 0;text-align:center;">Nenhum episódio cadastrado nesta temporada.</div>';

  el('seriesContent').innerHTML = `
    ${heroHtml}
    <div class="seasons-section">
      <div class="section-header-row">
        <span class="section-title">Temporadas</span>
      </div>
      <div class="season-tabs">${tabsHtml}</div>

      <div class="season-bar-action">
        <span><strong>${currentEpisodes.length} Episódios</strong> na Temporada ${currentSeason} (${curSeasonWatchedCount} vistos)</span>
        <button class="season-toggle-all-btn fx" onclick="toggleSeasonWatched(${currentSeason})">
          ${allCurrentWatched ? 'Desmarcar temporada' : '✓ Marcar temporada como assistida'}
        </button>
      </div>

      ${epsCardsHtml}
    </div>
  `;
}

/**
 * Constrói a seção cinematográfica de fontes e reprodução direta
 * para séries M3U ou servidores avulsos sem episódios estruturados.
 */
function buildDirectStreamSection(r) {
  const serverCardsHtml = r.servers.map(occ => {
    const streamUrl = buildStreamUrl(occ, occ.stream_id, occ.container_extension, r.type);
    const mediaFormat = occ.container_extension || (occ.raw_url?.includes('.m3u8') ? 'HLS / M3U8' : 'Stream Direto');
    const isM3U = !occ.host || occ.server_type === 'm3u';

    return `
      <div class="source-card">
        <div class="source-card-header">
          <div class="source-name-group">
            <div class="source-name">
              <span class="source-status-dot"></span>
              ${esc(occ.server_name)}
            </div>
            <div class="source-host-meta">
              ${isM3U ? 'Lista M3U' : `${occ.host}${occ.port ? `:${occ.port}` : ''}`} • Formato: ${mediaFormat.toUpperCase()}
            </div>
          </div>
          ${expiryBadge(occ.expiry)}
        </div>

        <div class="source-actions-row">
          <button class="source-watch-main fx" onclick="playMediaDirect('${esc(streamUrl)}', '${esc(r.title)}', '${esc(occ.server_name)}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            Assistir Agora
          </button>
          <button class="source-sec-icon-btn fx" onclick="openExternalUrl('${esc(streamUrl)}')" title="Abrir em nova aba / player externo">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
          </button>
          <button class="source-sec-icon-btn fx" onclick="copyStreamUrlString('${esc(streamUrl)}')" title="Copiar URL do stream">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div style="margin-top:20px;">
      <div class="section-title">Fontes de Reprodução Disponíveis</div>
      <div class="sources-card-grid">
        ${serverCardsHtml}
      </div>
    </div>
  `;
}

function selectSeason(num) {
  currentSeason = num;
  renderSeriesScreen(currentResult, window._lastEpisodeData);
}

// ─── Detail screen (movie / live) ─────────────────────────────────────────────
function openDetailScreen(r) {
  const tags = [typeLabel(r.type), r.year || (r.type === 'live' ? 'Ao vivo' : '')].filter(Boolean);

  const heroHtml = `
    <div class="hero-wrapper">
      ${r.cover_url ? `<div class="hero-backdrop" style="background-image:url('${esc(r.cover_url)}')"></div>` : ''}
      <div class="hero-content">
        <div class="hero-poster">
          ${r.cover_url ? `<img src="${esc(r.cover_url)}" alt="${esc(r.title)}" loading="lazy" onerror="this.style.display='none'">` : ''}
        </div>
        <div class="hero-info">
          <h1 class="hero-title">${esc(r.title)}</h1>
          <div class="hero-tags">
            <span class="hero-badge accent">${r.type === 'live' ? '🔴 Ao Vivo' : '🎬 Filme'}</span>
            ${tags.map(t => `<span class="hero-badge">${esc(t)}</span>`).join('')}
            <span class="hero-badge">${r.servers.length} servidor${r.servers.length > 1 ? 'es' : ''}</span>
          </div>

          <div class="hero-actions">
            ${r.servers.length > 0 ? `
              <button class="hero-play-btn fx" onclick="playMediaDirect('${esc(buildStreamUrl(r.servers[0], r.servers[0].stream_id, r.servers[0].container_extension, r.type))}', '${esc(r.title)}', '${esc(r.servers[0].server_name)}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                Reproduzir Filme
              </button>
            ` : ''}
            <button class="hero-sec-btn fx ${isFavorite(r) ? 'fav-active' : ''}" id="btnHeroFav" onclick="toggleCurrentFavorite()">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="${isFavorite(r) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
              <span>${isFavorite(r) ? 'Favorito' : 'Favoritar'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  el('mediaContent').innerHTML = heroHtml + buildDirectStreamSection(r);
  goTo('detail');
}


// ─── Stream URL builder ───────────────────────────────────────────────────────
function buildStreamUrl(occ, streamId, ext, type) {
  if (occ.raw_url) return occ.raw_url; // M3U: use raw URL directly

  if (!occ.host) return '';
  const pathType = type === 'live' ? 'live' : type === 'series' ? 'series' : 'movie';
  const extension = type === 'live' ? 'ts' : (ext || 'mp4');
  const portStr = occ.port ? `:${occ.port}` : '';
  const hostStr = occ.host.startsWith('http') ? occ.host : `http://${occ.host}`;
  return `${hostStr}${portStr}/${pathType}/${occ.username}/${occ.password}/${streamId}.${extension}`;
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
    return `
      <div class="servers-manage-item">
        <div class="info">
          <div class="sm-name">${esc(s.name)}</div>
          <div class="sm-host mono">
            ${esc(s.type === 'xtream' ? (s.port ? `${s.host}:${s.port}` : s.host) : s.m3u_url || '')}
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
    port     = '';
    username = el('xUser').value.trim();
    password = el('xPass').value.trim();
    if (!name || !host) { showToast('Preencha Nome e Host.'); return; }
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
    ['xName','xHost','xUser','xPass','mName','mUrl'].forEach(f => {
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

// ─── Episódios assistidos e Player Integrado ───────────────────────────────────

let _currentStreamUrl = '';
let _pendingPlayPayload = null;

/**
 * Abre o seletor perguntando se o usuário quer abrir em nova aba / player externo
 * ou no player embutido do navegador.
 */
function promptPlayOptions(payload) {
  if (!payload || !payload.url) {
    showToast('URL de stream não disponível.');
    return;
  }
  _pendingPlayPayload = payload;

  const modal = el('playChoiceModal');
  const titleEl = el('choiceModalTitle');
  const subEl = el('choiceModalSub');

  if (titleEl) titleEl.textContent = payload.title || 'Como deseja assistir?';
  if (subEl) subEl.textContent = payload.subtitle ? `${payload.subtitle}` : 'Escolha onde deseja reproduzir este conteúdo:';

  if (modal) {
    modal.style.display = 'flex';
    // Foca o primeiro botão (Nova Aba) para controle D-Pad / teclado
    setTimeout(() => {
      const firstChoice = el('btnChoiceExternal') || modal.querySelector('.choice-card');
      if (firstChoice) firstChoice.focus();
    }, 50);
  }
}

/** Fecha o seletor de reprodução */
function closePlayChoice() {
  const modal = el('playChoiceModal');
  if (modal) modal.style.display = 'none';
  _pendingPlayPayload = null;
}

/**
 * Executa a escolha selecionada no modal:
 * - 'external': nova aba / VLC
 * - 'web': player do navegador
 * - 'copy': copiar link
 */
async function confirmPlayChoice(choice) {
  if (!_pendingPlayPayload) return;
  const { url, wKey, title, subtitle, type } = _pendingPlayPayload;
  closePlayChoice();

  // Marca como assistido se for episódio
  if (wKey) {
    setWatched(wKey, true);
    const epNum = wKey.split('_e')[1];
    const card = document.getElementById(`ep-card-${epNum}`);
    if (card) {
      card.classList.add('watched');
      const eyeBtn = card.querySelector('.ep-eye-btn');
      if (eyeBtn) {
        eyeBtn.innerHTML = _eyeOn();
        eyeBtn.title = 'Marcar como não assistido';
      }
    }
  }

  // Registra no histórico de recentes
  recordRecent({
    title: currentResult?.title || title,
    type: type || currentResult?.type || 'movie',
    year: currentResult?.year || null,
    cover_url: currentResult?.cover_url || null,
    external_id: currentResult?.external_id || null,
    servers: currentResult?.servers || [],
    subInfo: subtitle ? subtitle.split(' • ')[0] : '',
    streamUrl: url,
  });

  if (choice === 'external') {
    openExternalUrl(url);
    showToast('Abrindo em nova aba / player externo...');
  } else if (choice === 'web') {
    playStream(url, title, subtitle);
  } else if (choice === 'copy') {
    copyStreamUrlString(url);
  }
}

// ─── Queue de Episódios e Navegação de Player ──────────────────────────────
let _currentSeriesQueue = null;

function buildEpisodeQueue(series, episodeData, targetSeason, targetEp) {
  if (!episodeData?.episodes || !series) return null;
  const list = [];
  const seasons = Object.entries(episodeData.episodes)
    .map(([num, eps]) => ({ num: parseInt(num, 10), episodes: eps || [] }))
    .sort((a, b) => a.num - b.num);

  for (const s of seasons) {
    const sortedEps = [...s.episodes].sort((a, b) => {
      const aNum = a.episode_num ?? a.num ?? 0;
      const bNum = b.episode_num ?? b.num ?? 0;
      return aNum - bNum;
    });

    for (const ep of sortedEps) {
      const epNum = ep.episode_num ?? ep.num ?? 0;
      const sid = ep.id || ep.stream_id || '';
      const ext = ep.container_extension || 'mp4';
      const occ = series.servers.find(srv => srv.server_type === 'xtream') || series.servers[0];
      const streamUrl = occ ? buildStreamUrl(occ, sid, ext, 'series') : '';
      const wKey = watchedKey(series, s.num, epNum);
      const epSubTitle = `T${s.num} E${epNum} • ${ep.title || 'Episódio'}`;

      list.push({
        seriesTitle: series.title,
        seasonNum: s.num,
        epNum,
        title: ep.title || `Episódio ${epNum}`,
        epSubTitle,
        streamUrl,
        wKey,
      });
    }
  }

  const sTarget = Number(targetSeason);
  const eTarget = Number(targetEp);
  let currentIndex = list.findIndex(e => e.seasonNum === sTarget && e.epNum === eTarget);
  if (currentIndex === -1) currentIndex = 0;

  return {
    series,
    allEpisodes: list,
    currentIndex,
  };
}

function updatePlayerButtons() {
  const prevBtn = el('btnPrevEpisode');
  const nextBtn = el('btnNextEpisode');
  if (!prevBtn || !nextBtn) return;

  if (_currentSeriesQueue && _currentSeriesQueue.allEpisodes.length > 1) {
    prevBtn.style.display = 'inline-flex';
    nextBtn.style.display = 'inline-flex';

    const hasPrev = _currentSeriesQueue.currentIndex > 0;
    const hasNext = _currentSeriesQueue.currentIndex < _currentSeriesQueue.allEpisodes.length - 1;

    prevBtn.disabled = !hasPrev;
    nextBtn.disabled = !hasNext;

    if (hasPrev) {
      const prevEp = _currentSeriesQueue.allEpisodes[_currentSeriesQueue.currentIndex - 1];
      prevBtn.title = `Episódio Anterior: ${prevEp.epSubTitle} (P / PageUp)`;
    } else {
      prevBtn.title = 'Primeiro episódio da série';
    }

    if (hasNext) {
      const nextEp = _currentSeriesQueue.allEpisodes[_currentSeriesQueue.currentIndex + 1];
      nextBtn.title = `Próximo Episódio: ${nextEp.epSubTitle} (N / PageDown)`;
    } else {
      nextBtn.title = 'Último episódio da série';
    }
  } else {
    prevBtn.style.display = 'none';
    nextBtn.style.display = 'none';
  }
}

/** Pula para o próximo episódio da série */
function playNextEpisode() {
  if (!_currentSeriesQueue || _currentSeriesQueue.currentIndex >= _currentSeriesQueue.allEpisodes.length - 1) {
    showToast('Você já está no último episódio.');
    return;
  }
  _currentSeriesQueue.currentIndex++;
  const nextEp = _currentSeriesQueue.allEpisodes[_currentSeriesQueue.currentIndex];
  playQueuedEpisode(nextEp);
}

/** Volta para o episódio anterior da série */
function playPrevEpisode() {
  if (!_currentSeriesQueue || _currentSeriesQueue.currentIndex <= 0) {
    showToast('Você já está no primeiro episódio.');
    return;
  }
  _currentSeriesQueue.currentIndex--;
  const prevEp = _currentSeriesQueue.allEpisodes[_currentSeriesQueue.currentIndex];
  playQueuedEpisode(prevEp);
}

/** Reproduz um episódio da fila diretamente */
function playQueuedEpisode(epItem) {
  if (!epItem || !epItem.streamUrl) {
    showToast('URL do episódio não encontrada.');
    return;
  }

  // Marca como assistido
  if (epItem.wKey) {
    setWatched(epItem.wKey, true);
    const card = document.getElementById(`ep-card-${epItem.epNum}`);
    if (card) {
      card.classList.add('watched');
      const eyeBtn = card.querySelector('.ep-eye-btn');
      if (eyeBtn) {
        eyeBtn.innerHTML = _eyeOn();
        eyeBtn.title = 'Marcar como não assistido';
      }
    }
  }

  // Registra no histórico de recentes
  recordRecent({
    title: currentResult?.title || epItem.seriesTitle,
    type: 'series',
    year: currentResult?.year || null,
    cover_url: currentResult?.cover_url || null,
    external_id: currentResult?.external_id || null,
    servers: currentResult?.servers || [],
    subInfo: epItem.epSubTitle ? epItem.epSubTitle.split(' • ')[0] : '',
    streamUrl: epItem.streamUrl,
  });

  // Atualiza seletor de temporada ativo se mudou de temporada
  if (epItem.seasonNum !== currentSeason && currentResult && window._lastEpisodeData) {
    currentSeason = epItem.seasonNum;
    renderSeriesScreen(currentResult, window._lastEpisodeData);
  }

  playStream(epItem.streamUrl, currentResult?.title || epItem.seriesTitle, epItem.epSubTitle);
  showToast(`Reproduzindo: ${epItem.epSubTitle}`);
}

/** Reproduz episódio: abre o seletor de reprodução */
async function playEpisodeDirect(url, wKey, seriesTitle, epSubTitle, seasonNum, epNum) {
  const sNum = seasonNum ?? (wKey ? parseInt(wKey.match(/_s(\d+)/)?.[1] || currentSeason, 10) : currentSeason);
  const eNum = epNum ?? (wKey ? parseInt(wKey.match(/_e(\d+)/)?.[1] || 0, 10) : 0);

  if (currentResult && window._lastEpisodeData) {
    _currentSeriesQueue = buildEpisodeQueue(currentResult, window._lastEpisodeData, sNum, eNum);
  }

  promptPlayOptions({
    url,
    wKey,
    title: currentResult?.title || seriesTitle,
    subtitle: epSubTitle,
    type: 'series'
  });
}

/** Reproduz filme ou canal ao vivo: abre o seletor de reprodução */
function playMediaDirect(url, title, subtitle) {
  _currentSeriesQueue = null;
  promptPlayOptions({
    url,
    title: currentResult?.title || title,
    subtitle,
    type: currentResult?.type || 'movie'
  });
}

/** Abre o player modal com o stream */
function playStream(url, title, subtitle) {
  if (!url) {
    showToast('URL de stream não disponível.');
    return;
  }
  _currentStreamUrl = url;

  const modal = el('playerModal');
  const video = el('mainVideoPlayer');
  const titleEl = el('playerStreamTitle');
  const subEl = el('playerStreamSub');
  const fallback = el('videoErrorFallback');

  if (titleEl) titleEl.textContent = title || 'Reproduzindo';
  if (subEl) subEl.textContent = subtitle || '';
  if (fallback) fallback.style.display = 'none';

  updatePlayerButtons();

  if (modal) modal.style.display = 'flex';

  if (video) {
    video.src = url;
    video.load();

    // Auto-avanço quando o episódio terminar
    video.onended = () => {
      if (_currentSeriesQueue && _currentSeriesQueue.currentIndex < _currentSeriesQueue.allEpisodes.length - 1) {
        showToast('Próximo episódio iniciando...');
        setTimeout(() => {
          playNextEpisode();
        }, 1200);
      }
    };

    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch(err => {
        console.warn('Auto-play falhou ou formato não suportado diretamente:', err);
        if (fallback) fallback.style.display = 'flex';
      });
    }

    video.onerror = () => {
      if (fallback) fallback.style.display = 'flex';
    };
  }

  // MediaSession API para suporte nativo a controles de mídia e controle remoto
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: subtitle || title || 'XFinder',
        artist: title || 'XFinder',
        album: currentResult?.title || 'IPTV',
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => playPrevEpisode());
      navigator.mediaSession.setActionHandler('nexttrack', () => playNextEpisode());
    } catch (e) {}
  }
}

/** Fecha o player e limpa a reprodução */
function closePlayer() {
  const modal = el('playerModal');
  const video = el('mainVideoPlayer');
  const fallback = el('videoErrorFallback');

  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  if (fallback) fallback.style.display = 'none';
  if (modal) modal.style.display = 'none';
  _currentStreamUrl = '';
}

/** Abre a URL atual em nova aba ou player padrão */
function openCurrentInExternal() {
  if (!_currentStreamUrl) return;
  openExternalUrl(_currentStreamUrl);
}

/** Abre qualquer URL externa */
function openExternalUrl(url) {
  if (!url) {
    showToast('URL inválida.');
    return;
  }
  window.open(url, '_blank', 'noopener');
}

/** Copia a URL atual do player para a área de transferência */
function copyCurrentStreamUrl() {
  if (!_currentStreamUrl) return;
  copyStreamUrlString(_currentStreamUrl);
}

/** Copia qualquer URL para o clipboard com feedback */
function copyStreamUrlString(url) {
  if (!url) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url)
      .then(() => showToast('Link copiado para a área de transferência!'))
      .catch(() => prompt('Copie o link abaixo:', url));
  } else {
    prompt('Copie o link abaixo:', url);
  }
}

/** Alterna todos os episódios de uma temporada como assistidos / não assistidos */
function toggleSeasonWatched(seasonNum) {
  if (!currentResult || !window._lastEpisodeData?.episodes) return;
  const episodes = window._lastEpisodeData.episodes[String(seasonNum)] || [];
  if (!episodes.length) return;

  // Verifica se todos já estão assistidos
  const allWatched = episodes.every(ep => {
    const epNum = ep.episode_num ?? ep.num ?? 0;
    return isWatched(watchedKey(currentResult, seasonNum, epNum));
  });

  const targetState = !allWatched;
  episodes.forEach(ep => {
    const epNum = ep.episode_num ?? ep.num ?? 0;
    setWatched(watchedKey(currentResult, seasonNum, epNum), targetState);
  });

  showToast(targetState ? `Temporada ${seasonNum} marcada como assistida!` : `Temporada ${seasonNum} desmarcada.`);
  renderSeriesScreen(currentResult, window._lastEpisodeData);
}

/** Gera a chave do localStorage para um episódio. */
function watchedKey(r, season, epNum) {
  const id = (r.external_id ?? r.title).toString().replace(/\W+/g, '_').toLowerCase();
  return `xw_${id}_s${season}_e${epNum}`;
}

function isWatched(key) {
  return localStorage.getItem(key) === '1';
}

function setWatched(key, value) {
  value ? localStorage.setItem(key, '1') : localStorage.removeItem(key);
}

/** Alterna o estado de assistido no card */
function toggleWatched(event) {
  event.stopPropagation();
  const btn = event.currentTarget;
  const key = btn.dataset.wkey;
  const watched = !isWatched(key);
  setWatched(key, watched);

  const card = btn.closest('.episode-card');
  if (card) {
    card.classList.toggle('watched', watched);
    btn.innerHTML = watched ? _eyeOn() : _eyeOff();
    btn.title = watched ? 'Marcar como não assistido' : 'Marcar como assistido';
  }

  // Atualiza também contadores da tela se disponível
  if (currentResult && window._lastEpisodeData) {
    renderSeriesScreen(currentResult, window._lastEpisodeData);
  }
}

/** SVG: olho aberto (assistido) */
function _eyeOn() {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
  </svg>`;
}

/** SVG: olho cortado (não assistido) */
function _eyeOff() {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>`;
}

// ─── Favoritos & Histórico Recente ─────────────────────────────────────────────

function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem('xf_favorites') || '[]');
  } catch (e) {
    return [];
  }
}

function saveFavorites(list) {
  localStorage.setItem('xf_favorites', JSON.stringify(list));
}

function isFavorite(r) {
  if (!r || !r.title) return false;
  const favs = getFavorites();
  return favs.some(f => f.title.toLowerCase() === r.title.toLowerCase());
}

function toggleCurrentFavorite() {
  if (!currentResult) return;
  const isFav = toggleFavorite(currentResult);
  const btn = el('btnHeroFav');
  if (btn) {
    btn.classList.toggle('fav-active', isFav);
    btn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
      <span>${isFav ? 'Favorito' : 'Favoritar'}</span>
    `;
  }
  renderHomeLibrary();
}

function toggleFavorite(r) {
  if (!r || !r.title) return false;
  let favs = getFavorites();
  const idx = favs.findIndex(f => f.title.toLowerCase() === r.title.toLowerCase());
  let nowFavorite = false;

  if (idx !== -1) {
    favs.splice(idx, 1);
    showToast(`"${r.title}" removido dos favoritos.`);
  } else {
    favs.unshift({
      title: r.title,
      type: r.type,
      year: r.year || null,
      cover_url: r.cover_url || null,
      external_id: r.external_id || null,
      servers: r.servers || [],
      added_at: Date.now(),
    });
    nowFavorite = true;
    showToast(`"${r.title}" adicionado aos favoritos! ⭐`);
  }

  saveFavorites(favs);
  return nowFavorite;
}

function removeFavorite(title, event) {
  if (event) event.stopPropagation();
  let favs = getFavorites();
  favs = favs.filter(f => f.title.toLowerCase() !== title.toLowerCase());
  saveFavorites(favs);
  showToast(`"${title}" removido dos favoritos.`);
  renderHomeLibrary();
}

function getRecents() {
  try {
    return JSON.parse(localStorage.getItem('xf_recents') || '[]');
  } catch (e) {
    return [];
  }
}

function saveRecents(list) {
  localStorage.setItem('xf_recents', JSON.stringify(list));
}

function recordRecent(item) {
  if (!item || !item.title) return;
  let recents = getRecents();
  // Remove ocorrência anterior do mesmo título
  recents = recents.filter(r => r.title.toLowerCase() !== item.title.toLowerCase());
  recents.unshift({
    title: item.title,
    type: item.type || 'movie',
    year: item.year || null,
    cover_url: item.cover_url || null,
    external_id: item.external_id || null,
    servers: item.servers || [],
    subInfo: item.subInfo || '',
    streamUrl: item.streamUrl || '',
    watched_at: Date.now(),
  });
  // Mantém os 24 mais recentes
  if (recents.length > 24) recents = recents.slice(0, 24);
  saveRecents(recents);
  renderHomeLibrary();
}

function removeRecent(title, event) {
  if (event) event.stopPropagation();
  let recents = getRecents();
  recents = recents.filter(r => r.title.toLowerCase() !== title.toLowerCase());
  saveRecents(recents);
  renderHomeLibrary();
}

function clearRecentsHistory() {
  saveRecents([]);
  showToast('Histórico recente limpo.');
  renderHomeLibrary();
}

function timeAgo(ts) {
  if (!ts) return '';
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return 'Agora';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m atrás`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h atrás`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Ontem';
  if (diffDays < 7) return `${diffDays}d atrás`;
  return new Date(ts).toLocaleDateString('pt-BR');
}

/** Renderiza as seções de favoritos e últimos assistidos na Home */
function renderHomeLibrary() {
  const libraryEl = el('homeLibrary');
  if (!libraryEl) return;

  const recents = getRecents();
  const favorites = getFavorites();

  const recentSec = el('recentSection');
  const recentsGrid = el('recentsGrid');
  const favSec = el('favoritesSection');
  const favGrid = el('favoritesGrid');
  const favCount = el('favoritesCount');

  // Renderiza Últimos Assistidos
  if (recentSec && recentsGrid) {
    if (recents.length > 0) {
      recentSec.style.display = 'flex';
      recentsGrid.innerHTML = recents.map((item, idx) => `
        <div class="home-card fx" tabindex="0" onclick="openLibraryItem(${idx}, 'rec')">
          <div class="home-card-poster">
            ${item.cover_url ? `<img src="${esc(item.cover_url)}" alt="${esc(item.title)}" loading="lazy" onerror="this.parentElement.style.background='#1b1f26'">` : ''}
            <span class="home-card-badge ${item.subInfo ? 'ep' : ''}">${esc(item.subInfo || typeLabel(item.type))}</span>
            <button class="home-card-remove-btn" tabindex="-1" onclick="removeRecent('${esc(item.title)}', event)" title="Remover do histórico">✕</button>
            <div class="home-card-play-overlay">
              <div class="home-card-play-icon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              </div>
            </div>
          </div>
          <div class="home-card-info">
            <div class="home-card-title" title="${esc(item.title)}">${esc(item.title)}</div>
            <div class="home-card-sub">${item.watched_at ? timeAgo(item.watched_at) : (item.year || '')}</div>
          </div>
        </div>
      `).join('');
    } else {
      recentSec.style.display = 'none';
    }
  }

  // Renderiza Meus Favoritos
  if (favSec && favGrid) {
    if (favorites.length > 0) {
      favSec.style.display = 'flex';
      if (favCount) favCount.textContent = favorites.length;
      favGrid.innerHTML = favorites.map((item, idx) => `
        <div class="home-card fx" tabindex="0" onclick="openLibraryItem(${idx}, 'fav')">
          <div class="home-card-poster">
            ${item.cover_url ? `<img src="${esc(item.cover_url)}" alt="${esc(item.title)}" loading="lazy" onerror="this.parentElement.style.background='#1b1f26'">` : ''}
            <span class="home-card-badge">${esc(typeLabel(item.type))}</span>
            <button class="home-card-remove-btn" tabindex="-1" onclick="removeFavorite('${esc(item.title)}', event)" title="Remover dos favoritos">✕</button>
            <div class="home-card-play-overlay">
              <div class="home-card-play-icon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              </div>
            </div>
          </div>
          <div class="home-card-info">
            <div class="home-card-title" title="${esc(item.title)}">${esc(item.title)}</div>
            <div class="home-card-sub">${item.year ? `${item.year} • ` : ''}${item.servers?.length ? `${item.servers.length} serv.` : ''}</div>
          </div>
        </div>
      `).join('');
    } else {
      favSec.style.display = 'none';
    }
  }
}

/** Abre item clicado na biblioteca da Home */
function openLibraryItem(idx, source) {
  const list = source === 'fav' ? getFavorites() : getRecents();
  const item = list[idx];
  if (!item) return;

  currentResult = item;
  if (item.type === 'series') {
    currentSeason = 1;
    openSeriesScreen(item);
  } else {
    openDetailScreen(item);
  }
// Exposição global para integração com D-Pad e controles
window.playPrevEpisode = playPrevEpisode;
window.playNextEpisode = playNextEpisode;
window.closePlayer = closePlayer;
window.closePlayChoice = closePlayChoice;
window.goBack = goBack;

