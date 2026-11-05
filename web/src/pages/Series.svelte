<script module>
  /** Episódios já carregados nesta aba (evita refazer a chamada ao voltar). */
  const episodeCache = new Map();
</script>

<script>
  /**
   * Página da série: botão Continuar/Próximo, temporadas com progresso,
   * episódios com estado (visto / parou aqui) e reprodução com fila.
   * URL: #/serie/<chave>?t=<temporada>&play=<temporada>-<episódio>
   */
  import { tick, untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import { route, navigate, href, back } from '../lib/router.svelte.js';
  import { findItem } from '../lib/items.js';
  import {
    library, isWatched, setWatched, getEpisodeProgress, getSeriesProgress, saveEpisodeProgress,
    isFavorite, toggleFavorite, saveMediaProgress, WATCHED_PCT,
  } from '../lib/library.svelte.js';
  import { xtreamServers, seasonsOf, flattenEpisodes, episodeUrl, findEpisode, serverHost, mediaSources } from '../lib/streams.js';
  import { openPlayer, stopPlayer, player } from '../lib/player.svelte.js';
  import { settings } from '../lib/settings.svelte.js';
  import { toast } from '../lib/toast.svelte.js';
  import { humanDuration, clock, plural } from '../lib/format.js';
  import Cover from '../components/Cover.svelte';
  import Icon from '../components/Icon.svelte';
  import SourceList from '../components/SourceList.svelte';

  let { key } = $props();

  // Resolvido uma vez por chave (não muda a cada salvamento de progresso)
  let item = $state(null);
  $effect(() => {
    const k = key;
    item = untrack(() => findItem(k, [library.favorites, library.recents]));
  });
  let providers = $derived(item ? xtreamServers(item) : []);

  let data = $state(null);
  let loading = $state(true);
  let loadError = $state('');

  // ─── Carregamento dos episódios ───────────────────────────────────────────
  $effect(() => {
    const it = item;
    untrack(() => load(it));
  });

  /** Respostas de get_series_info por servidor (reaproveitadas no failover). */
  const fetches = new Map();
  const fetchEpisodes = (occ) => {
    const k = `${occ.server_id}|${occ.series_id}`;
    if (!fetches.has(k)) {
      const p = api.getEpisodes(occ, occ.series_id);
      p.catch(() => fetches.delete(k)); // erro não fica em cache
      fetches.set(k, p);
    }
    return fetches.get(k);
  };

  /**
   * Consulta todos os servidores em paralelo e usa o primeiro que devolver
   * episódios — antes era um por vez, e cada servidor fora do ar segurava a
   * página por ~20s antes de tentar o próximo.
   */
  async function load(it) {
    loadError = '';
    if (!it || !providers.length) { data = null; loading = false; return; }
    if (episodeCache.has(it.key)) { data = episodeCache.get(it.key); loading = false; return; }
    loading = true;
    const attempts = providers.map((occ) => fetchEpisodes(occ).then((res) => {
      if (!res?.episodes || !Object.keys(res.episodes).length) throw new Error('Servidor sem episódios para esta série');
      return { ...res, provider: occ };
    }));
    let entry = null;
    try {
      entry = await Promise.any(attempts);
    } catch (err) {
      loadError = err.errors?.at(-1)?.message ?? err.message;
    }
    if (item !== it) return; // trocou de série enquanto carregava
    if (entry) episodeCache.set(it.key, entry);
    data = entry;
    loading = false;
  }

  // ─── Estado derivado (recalcula quando o progresso muda) ──────────────────
  let seasons = $derived(seasonsOf(data));
  let flat = $derived(flattenEpisodes(data));

  let status = $derived.by(() => {
    library.version; // dependência: vistos/progresso
    const map = new Map();
    if (!item) return map;
    for (const ep of flat) {
      const prog = getEpisodeProgress(item, ep.season, ep.episode);
      const watched = isWatched(item, ep.season, ep.episode);
      const duration = prog?.duration || ep.durationSecs || 0;
      const current = prog?.currentTime || 0;
      const partial = !watched && current > 5 && (prog?.progressPct ?? 0) < WATCHED_PCT;
      map.set(`${ep.season}-${ep.episode}`, {
        watched, partial, current, duration,
        pct: watched ? 100 : Math.round(prog?.progressPct ?? 0),
      });
    }
    return map;
  });

  const st = (ep) => status.get(`${ep.season}-${ep.episode}`) ?? { watched: false, partial: false, pct: 0 };

  /** Para onde o botão principal leva: parou no meio → continua; senão o próximo não visto. */
  let target = $derived.by(() => {
    if (!flat.length) return null;
    const last = item && getSeriesProgress(item);
    library.version;
    const lastEp = last && flat.find((e) => e.season === last.season && e.episode === last.episode);
    if (lastEp && st(lastEp).partial) return { ep: lastEp, mode: 'continue' };
    const partial = flat.find((e) => st(e).partial);
    if (partial) return { ep: partial, mode: 'continue' };
    const startIdx = lastEp ? flat.indexOf(lastEp) : -1;
    const next = flat.slice(startIdx + 1).find((e) => !st(e).watched) ?? flat.find((e) => !st(e).watched);
    if (next) return { ep: next, mode: flat.some((e) => st(e).watched) ? 'next' : 'start' };
    return { ep: flat[0], mode: 'again' };
  });

  let seenCount = $derived(flat.filter((e) => st(e).watched).length);
  let seriesPct = $derived(flat.length ? Math.round((seenCount / flat.length) * 100) : 0);

  let season = $derived.by(() => {
    const t = Number(route.query.t);
    if (seasons.some((s) => s.num === t)) return t;
    return target?.ep.season ?? seasons[0]?.num ?? 1;
  });
  let currentSeason = $derived(seasons.find((s) => s.num === season));
  let seasonEps = $derived(flat.filter((e) => e.season === season));
  let seasonSeen = $derived(seasonEps.filter((e) => st(e).watched).length);

  let info = $derived(data?.info ?? {});
  let backdrop = $derived(info.backdrop_path?.[0] || '');
  let genre = $derived((info.genre || '').split(/[\/,]/)[0]?.trim());
  let rating = $derived(info.rating ? String(info.rating).slice(0, 3) : '');
  let fav = $derived((library.favorites, item ? isFavorite(item) : false));

  // Rola até o episódio onde a pessoa parou (uma vez por série)
  let scrolledFor = '';
  $effect(() => {
    if (!target || scrolledFor === key || route.query.play) return;
    scrolledFor = key;
    tick().then(() => document.getElementById(`ep-${target.ep.season}-${target.ep.episode}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  });

  // ─── Reprodução (dirigida pela URL: ?play=2-5) ────────────────────────────
  let playing = $derived(route.query.play ?? '');

  $effect(() => {
    const p = playing;
    const ready = flat.length > 0;
    const done = !loading;
    untrack(() => {
      if (!p) { if (player.request?.ownerKey === key) stopPlayer(); return; }
      if (ready) {
        const [s, e] = p.split('-').map(Number);
        startEpisode(s, e);
      } else if (done && item) {
        startDirect(Number(route.query.src) || 0); // série sem lista de episódios (M3U)
      }
    });
  });

  /** Série sem episódios estruturados: toca a URL direta de cada servidor. */
  function startDirect(first) {
    const sources = mediaSources(item);
    if (!sources.length) { toast('Nenhuma fonte disponível.'); return; }
    const i = Math.min(Math.max(first, 0), sources.length - 1);
    openPlayer({
      ownerKey: key,
      ownerPath: route.path,
      title: item.title,
      subtitle: sources[i].name,
      poster: item.cover_url || '',
      type: 'movie',
      sources: [sources[i], ...sources.filter((_, j) => j !== i)],
      onProgress: (prog) => saveMediaProgress(item, prog),
      queue: null,
      onClose: () => back(route.path),
    });
  }

  function play(ep) {
    navigate(href(route.path, { t: ep.season, play: `${ep.season}-${ep.episode}` }));
  }

  function startEpisode(s, e) {
    const idx = flat.findIndex((x) => x.season === s && x.episode === e);
    if (idx === -1) { toast('Episódio não encontrado.'); return; }
    const ep = flat[idx];
    const prev = flat[idx - 1];
    const next = flat[idx + 1];
    const state = st(ep);
    const goto = (x) => navigate(href(route.path, { t: x.season, play: `${x.season}-${x.episode}` }), { replace: true });

    openPlayer({
      ownerKey: key,
      ownerPath: route.path,
      title: item.title,
      subtitle: `T${ep.season}:E${ep.episode} · ${ep.title}`,
      poster: info.backdrop_path?.[0] || item.cover_url || '',
      type: 'series',
      sources: episodeSources(ep),
      initialTime: settings.resume && state.partial ? state.current : 0,
      onProgress: ({ currentTime, duration, finished }) =>
        saveEpisodeProgress(item, { season: ep.season, episode: ep.episode, title: ep.title, currentTime, duration, finished }),
      queue: {
        hasPrev: !!prev,
        hasNext: !!next,
        nextLabel: next ? `T${next.season}:E${next.episode} · ${next.title}` : '',
        prev: () => prev && goto(prev),
        next: () => next && goto(next),
      },
      onClose: () => back(href(route.path, { t: ep.season })),
    });
  }

  /**
   * Fontes do episódio: o servidor que forneceu a lista vem primeiro; os outros
   * só buscam a própria lista de episódios se precisarem entrar no failover.
   */
  function episodeSources(ep) {
    const provider = data.provider;
    const others = providers.filter((o) => o !== provider && o.server_id !== provider.server_id);
    return [
      { name: provider.server_name, host: serverHost(provider), url: episodeUrl(provider, ep.raw) },
      ...others.map((occ) => ({
        name: occ.server_name,
        host: serverHost(occ),
        resolve: async () => {
          const res = await fetchEpisodes(occ);
          const match = findEpisode(res, ep.season, ep.episode);
          if (!match) throw new Error('episódio não existe neste servidor');
          return episodeUrl(occ, match);
        },
      })),
    ];
  }

  // ─── Ações ────────────────────────────────────────────────────────────────
  function toggleEp(ep) {
    setWatched(item, [ep], !st(ep).watched);
  }

  function markUpTo(ep) {
    const idx = flat.indexOf(ep);
    setWatched(item, flat.slice(0, idx + 1), true);
    toast(`Marcado como visto até T${ep.season}:E${ep.episode}.`);
  }

  function toggleSeason() {
    const all = seasonSeen === seasonEps.length;
    setWatched(item, seasonEps, !all);
    toast(all ? `Temporada ${season} desmarcada.` : `Temporada ${season} marcada como vista.`);
  }

  function copyLink(ep) {
    const url = episodeUrl(data.provider, ep.raw);
    navigator.clipboard?.writeText(url).then(() => toast('Link do episódio copiado!'), () => prompt('Copie o link:', url));
  }

  function onFav() {
    const on = toggleFavorite(item);
    toast(on ? 'Adicionado aos favoritos.' : 'Removido dos favoritos.');
  }

  function primaryLabel(t) {
    const code = `T${t.ep.season}:E${t.ep.episode}`;
    return { continue: `Continuar ${code}`, next: `Próximo: ${code}`, start: `Começar ${code}`, again: 'Assistir de novo' }[t.mode];
  }
</script>

{#if !item}
  <main class="container">
    <div class="empty">
      <Icon name="search" size={32} stroke={1.6} />
      <p>Não encontramos esta série neste navegador. Busque por ela no Início.</p>
      <button class="btn btn-primary" onclick={() => navigate('/')}>Ir para o Início</button>
    </div>
  </main>
{:else}
  <main>
    <section class="hero" style:--backdrop={backdrop ? `url("${backdrop}")` : 'none'}>
      <div class="container hero-inner">
        <button class="btn btn-ghost back" onclick={() => back('/')}><Icon name="back" size={16} /> Voltar</button>
        <div class="hero-body">
          <div class="poster"><Cover src={item.cover_url} title={item.title} fontSize={24} /></div>
          <div class="hero-info">
            <h1>{item.title}</h1>
            <div class="tags">
              <span class="tag tag-accent">Série</span>
              {#if item.year}<span class="tag">{item.year}</span>{/if}
              {#if seasons.length}<span class="tag">{plural(seasons.length, 'temporada', 'temporadas')}</span>{/if}
              {#if genre}<span class="tag">{genre}</span>{/if}
              {#if rating}<span class="tag">★ {rating}</span>{/if}
              <span class="tag">{plural(item.servers.length, 'servidor', 'servidores')}</span>
            </div>
            {#if info.plot}<p class="plot">{info.plot}</p>{/if}

            {#if flat.length}
              <div class="series-progress">
                <div class="sp-label"><span>Progresso da série</span><span>{seenCount} de {flat.length} episódios · {seriesPct}%</span></div>
                <div class="sp-track"><div style:width="{seriesPct}%"></div></div>
              </div>
            {/if}

            <div class="hero-actions">
              {#if target}
                {@const t = st(target.ep)}
                <button class="btn btn-primary btn-lg" onclick={() => play(target.ep)}>
                  <Icon name="play" size={18} />
                  {primaryLabel(target)}
                  {#if target.mode === 'continue' && t.duration}
                    <span class="sub">· faltam {humanDuration(t.duration - t.current)}</span>
                  {/if}
                </button>
              {/if}
              <button class="btn btn-lg" class:fav onclick={onFav}>
                <Icon name="star" size={16} filled={fav} /> {fav ? 'Nos favoritos' : 'Favoritar'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="container episodes-section">
      {#if loading}
        <div class="empty"><span class="spinner"></span><p>Carregando episódios…</p></div>
      {:else if !seasons.length}
        <div class="no-episodes">
          <p class="hint">
            {providers.length ? `Não foi possível carregar a lista de episódios${loadError ? ` (${loadError})` : ''}.` : 'Esta série está em listas M3U, sem lista de episódios.'}
            Você pode reproduzir direto pelas fontes abaixo.
          </p>
          <SourceList {item} />
        </div>
      {:else}
        <div class="season-tabs" role="tablist" aria-label="Temporadas">
          {#each seasons as s (s.num)}
            {@const eps = flat.filter((e) => e.season === s.num)}
            {@const seen = eps.filter((e) => st(e).watched).length}
            <button role="tab" aria-selected={s.num === season} class="season-tab" class:on={s.num === season}
                    onclick={() => navigate(href(route.path, { t: s.num }), { replace: true })}>
              <span class="st-top">
                <strong>Temporada {s.num}</strong>
                <span class:done={seen === eps.length}>{seen === eps.length ? '✓ Completa' : `${seen}/${eps.length}`}</span>
              </span>
              <span class="st-bar"><span class:done={seen === eps.length} style:width="{Math.round((seen / eps.length) * 100)}%"></span></span>
            </button>
          {/each}
        </div>

        <div class="season-bar">
          <span><strong>{plural(seasonEps.length, 'episódio', 'episódios')}</strong> · {seasonSeen} vistos</span>
          <button class="btn btn-sm" onclick={toggleSeason}>
            {seasonSeen === seasonEps.length ? 'Desmarcar temporada' : '✓ Marcar temporada como vista'}
          </button>
        </div>

        <ol class="episodes">
          {#each seasonEps as ep (ep.episode)}
            {@const s = st(ep)}
            {@const isTarget = target?.mode === 'continue' && target.ep === ep}
            {@const thumb = ep.raw.info?.movie_image || ''}
            <li id="ep-{ep.season}-{ep.episode}" class="episode" class:resume={isTarget} class:seen={s.watched && !isTarget}>
              <button class="ep-thumb" onclick={() => play(ep)} aria-label="Assistir E{ep.episode} — {ep.title}">
                <Cover src={thumb} title="E{ep.episode}" ratio="16 / 9" fontSize={20} />
                <span class="play-overlay"><span class="play-circle"><Icon name="play" size={18} /></span></span>
                {#if s.pct > 0}<span class="bar"><span class:seen={s.watched} style:width="{s.pct}%"></span></span>{/if}
              </button>
              <div class="ep-info">
                <div class="ep-title">
                  <span class="ep-num mono">E{ep.episode}</span>
                  <strong>{ep.title}</strong>
                  {#if isTarget}<span class="tag tag-accent">Parou em {clock(s.current)} · faltam {humanDuration(s.duration - s.current)}</span>{/if}
                  {#if s.watched}<span class="tag tag-ok">✓ Visto</span>{/if}
                </div>
                {#if ep.raw.info?.plot}<p class="ep-plot">{ep.raw.info.plot}</p>{/if}
              </div>
              <span class="ep-dur">{ep.durationSecs ? humanDuration(ep.durationSecs) : (ep.raw.info?.duration ?? '')}</span>
              <div class="ep-actions">
                <button class="btn btn-icon btn-sm check" class:on={s.watched} onclick={() => toggleEp(ep)}
                        aria-label={s.watched ? 'Marcar como não visto' : 'Marcar só este como visto'}
                        title={s.watched ? 'Marcar como não visto' : 'Marcar só este como visto'}>
                  <Icon name="check" size={16} stroke={2.6} />
                </button>
                <button class="btn btn-sm" onclick={() => markUpTo(ep)} title="Marca este e todos os episódios anteriores como vistos">
                  Marcar como visto
                </button>
                <button class="btn btn-sm" onclick={() => copyLink(ep)} title="Copiar link do episódio">
                  <Icon name="copy" size={14} /> Copiar link
                </button>
              </div>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  </main>
{/if}

<style>
  .hero {
    position: relative; overflow: hidden;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .hero::before {
    content: ''; position: absolute; inset: 0;
    background-image: var(--backdrop); background-size: cover; background-position: center 25%;
    opacity: 0.18; filter: blur(2px);
  }
  .hero-inner { position: relative; padding-top: 24px; padding-bottom: 40px; display: flex; flex-direction: column; gap: 20px; }
  .back { align-self: flex-start; margin-left: -12px; }
  .hero-body { display: flex; gap: 40px; align-items: flex-start; }
  .poster { width: 220px; flex-shrink: 0; border-radius: 12px; overflow: hidden; box-shadow: var(--shadow); }
  .hero-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 16px; padding-top: 4px; }
  h1 { font-size: 40px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; }
  .tags { display: flex; flex-wrap: wrap; gap: 8px; }
  .tags .tag { font-size: 13px; padding: 4px 10px; }
  .plot { max-width: 760px; font-size: 15px; line-height: 1.6; color: var(--text-2); }

  .series-progress { display: flex; flex-direction: column; gap: 8px; max-width: 440px; }
  .sp-label { display: flex; justify-content: space-between; font-size: 12.5px; color: var(--muted); }
  .sp-track { height: 6px; border-radius: 99px; background: var(--border-strong); overflow: hidden; }
  .sp-track div { height: 100%; background: var(--accent); }

  .hero-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 6px; }
  .hero-actions .sub { font-weight: 500; opacity: 0.7; }
  .fav { color: var(--warn); }

  .episodes-section { padding-top: 32px; padding-bottom: 80px; display: flex; flex-direction: column; gap: 20px; }
  .no-episodes { display: flex; flex-direction: column; gap: 16px; }

  .season-tabs { display: flex; flex-wrap: wrap; gap: 10px; }
  .season-tab {
    display: flex; flex-direction: column; gap: 10px; min-width: 190px; padding: 12px 14px;
    border-radius: 10px; border: 1px solid var(--border-strong); background: var(--surface);
    color: var(--text); text-align: left;
  }
  .season-tab:hover { background: var(--surface-3); }
  .season-tab.on { border-color: var(--text); background: var(--surface-3); }
  .st-top { display: flex; justify-content: space-between; gap: 16px; font-size: 14px; }
  .st-top span { font-size: 12px; font-weight: 600; color: var(--muted); }
  .st-top span.done { color: var(--ok-text); }
  .st-bar { height: 3px; border-radius: 99px; background: var(--border-strong); overflow: hidden; }
  .st-bar span { display: block; height: 100%; background: var(--accent); }
  .st-bar span.done { background: var(--ok); }

  .season-bar { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--muted); }
  .season-bar strong { color: var(--text); }
  .season-bar .btn { margin-left: auto; }

  .episodes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .episode {
    display: flex; align-items: center; gap: 20px; padding: 12px;
    border-radius: 12px; border: 1px solid var(--border); background: var(--surface);
    transition: background .12s;
    scroll-margin: 120px;
  }
  .episode:hover { background: var(--surface-2); }
  .episode.resume { border-color: var(--accent); background: var(--selected); }
  .episode.seen { opacity: 0.8; }

  .ep-thumb {
    position: relative; width: 208px; flex-shrink: 0; padding: 0;
    border: none; border-radius: 8px; overflow: hidden; background: none;
  }
  .play-overlay {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    background: rgba(0, 0, 0, 0.4); opacity: 0; transition: opacity .15s;
  }
  .episode:hover .play-overlay, .ep-thumb:focus-visible .play-overlay { opacity: 1; }
  .play-circle {
    width: 44px; height: 44px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    background: #e8eaed; color: #0b0d10;
  }
  .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: rgba(0, 0, 0, 0.55); }
  .bar span { display: block; height: 100%; background: var(--accent); }
  .bar span.seen { background: #9aa3ad; }

  .ep-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .ep-title { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
  .ep-title strong { font-size: 15px; font-weight: 600; }
  .ep-num { font-size: 13px; font-weight: 700; color: var(--muted); }
  .ep-plot {
    font-size: 13px; line-height: 1.5; color: var(--muted); max-width: 760px;
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .ep-dur { width: 70px; flex-shrink: 0; text-align: right; font-size: 13px; color: var(--muted); }
  .ep-actions { display: flex; gap: 6px; flex-shrink: 0; }
  .check { color: var(--faint); }
  .check.on { color: var(--ok-text); background: var(--ok-soft); border-color: transparent; }

  @media (max-width: 1100px) {
    .episode { flex-wrap: wrap; }
    .ep-info { flex-basis: calc(100% - 240px); }
    .ep-dur { display: none; }
    .ep-actions { width: 100%; justify-content: flex-end; }
  }
  @media (max-width: 760px) {
    .hero-body { flex-direction: column; }
    .poster { width: 150px; }
    h1 { font-size: 30px; }
    .ep-thumb { width: 100%; }
  }
</style>
