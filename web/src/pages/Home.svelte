<script>
  /** Início: busca global + "Continuar assistindo" + "Meus favoritos". */
  import { untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import { route, navigate, href } from '../lib/router.svelte.js';
  import { servers, okServers } from '../lib/servers.svelte.js';
  import { library, removeRecent, clearRecents, WATCHED_PCT } from '../lib/library.svelte.js';
  import { groupResults } from '../lib/streams.js';
  import { rememberItem } from '../lib/items.js';
  import { TYPE_LABEL, humanDuration, timeAgo, plural } from '../lib/format.js';
  import { toast } from '../lib/toast.svelte.js';
  import Cover from '../components/Cover.svelte';
  import Icon from '../components/Icon.svelte';

  const SEARCH_DEBOUNCE_MS = 350;

  let input = $state(route.query.q ?? '');
  let results = $state([]);
  let loading = $state(false);
  let typeFilter = $state('all');
  let searchedFor = $state('');
  let debounce;
  let token = 0;

  let q = $derived((route.query.q ?? '').trim());
  let activeCount = $derived(okServers().length);

  // A busca acompanha a URL (?q=...): Voltar/F5 restauram os resultados
  $effect(() => {
    const query = q;
    untrack(() => {
      if (input.trim() !== query && document.activeElement?.id !== 'search') input = query;
      if (query.length >= 2) runSearch(query);
      else { results = []; searchedFor = ''; }
    });
  });

  async function runSearch(query) {
    const my = ++token;
    loading = true;
    try {
      const rows = await api.search(query);
      if (my !== token) return;
      results = groupResults(rows);
      searchedFor = query;
      typeFilter = 'all';
    } catch (err) {
      if (my === token) toast('Erro na busca: ' + err.message);
    } finally {
      if (my === token) loading = false;
    }
  }

  function onInput() {
    clearTimeout(debounce);
    debounce = setTimeout(() => setQuery(input.trim()), SEARCH_DEBOUNCE_MS);
  }

  function setQuery(value) {
    if (value === q) return;
    // Primeira busca cria uma entrada no histórico; refinamentos substituem
    navigate(href('/', { q: value }), { replace: !!q && !!value });
  }

  function onKeydown(e) {
    if (e.key === 'Enter') { clearTimeout(debounce); setQuery(input.trim()); }
    if (e.key === 'Escape' && input) { e.stopPropagation(); input = ''; setQuery(''); }
  }

  const counts = $derived({
    all: results.length,
    series: results.filter((r) => r.type === 'series').length,
    movie: results.filter((r) => r.type === 'movie').length,
    live: results.filter((r) => r.type === 'live').length,
  });
  let visibleResults = $derived(typeFilter === 'all' ? results : results.filter((r) => r.type === typeFilter));

  function pathFor(item) {
    return (item.type === 'series' ? '/serie/' : '/titulo/') + encodeURIComponent(item.key);
  }

  function open(item) {
    rememberItem(item);
    navigate(pathFor(item));
  }

  /**
   * Card de "Continuar assistindo": abre já reproduzindo. A página de detalhes
   * entra no histórico antes do player, para que fechar o player volte para
   * ela (e não para a tela inicial).
   */
  function resume(item) {
    rememberItem(item);
    if (item.type === 'series' && item.season && item.episode) {
      navigate(href(pathFor(item), { t: item.season }));
      navigate(href(pathFor(item), { t: item.season, play: `${item.season}-${item.episode}` }));
    } else if (item.type !== 'series') {
      navigate(pathFor(item));
      navigate(href(pathFor(item), { play: 1 }));
    } else {
      navigate(pathFor(item));
    }
  }

  function continueLine(item) {
    const pct = item.progressPct ?? 0;
    const left = item.remaining > 0 && pct < WATCHED_PCT ? ` · faltam ${humanDuration(item.remaining)}` : '';
    if (item.type === 'live') return `Ao vivo · ${timeAgo(item.watched_at)}`;
    if (item.type === 'series') {
      const ep = item.season ? `T${item.season}:E${item.episode}` : (item.subInfo || 'Série');
      return ep + (left || ' · ' + timeAgo(item.watched_at));
    }
    return 'Filme' + (left || ' · ' + timeAgo(item.watched_at));
  }
</script>

<main class="container home">
  <section class="search">
    <label for="search" class="search-label">
      Buscar em <strong>{plural(activeCount, 'servidor', 'servidores')}</strong>
    </label>
    <div class="search-box">
      <Icon name="search" size={18} />
      <input id="search" type="search" bind:value={input} oninput={onInput} onkeydown={onKeydown}
             placeholder="Filme, série ou canal…" autocomplete="off" spellcheck="false" />
      {#if loading}<span class="spinner"></span>{/if}
    </div>
  </section>

  {#if servers.loaded && servers.list.length === 0}
    <div class="empty">
      <Icon name="layers" size={36} stroke={1.6} />
      <p>Nenhum servidor cadastrado ainda.</p>
      <button class="btn btn-primary" onclick={() => navigate('/config/servidores')}>
        <Icon name="plus" size={15} /> Adicionar servidor
      </button>
    </div>
  {:else if q}
    <section class="results">
      {#if q.length < 2}
        <p class="muted">Digite pelo menos 2 letras…</p>
      {:else if searchedFor === q && results.length === 0 && !loading}
        <div class="empty"><Icon name="search" size={32} stroke={1.6} /><p>Nada encontrado para “{q}”.</p></div>
      {:else if results.length}
        <div class="results-head">
          <h2>{plural(results.length, 'resultado', 'resultados')} para “{searchedFor}”</h2>
          <div class="chips" role="group" aria-label="Filtrar por tipo">
            {#each [['all', 'Todos'], ['series', 'Séries'], ['movie', 'Filmes'], ['live', 'Canais']] as [key, label] (key)}
              {#if key === 'all' || counts[key]}
                <button class="chip" class:on={typeFilter === key} aria-pressed={typeFilter === key}
                        onclick={() => (typeFilter = key)}>{label} <span>{counts[key]}</span></button>
              {/if}
            {/each}
          </div>
        </div>
        <div class="result-grid">
          {#each visibleResults as item (item.type + item.key)}
            <button class="result" onclick={() => open(item)}>
              <span class="result-cover"><Cover src={item.cover_url} title={item.title} fontSize={10} /></span>
              <span class="result-info">
                <strong>{item.title}</strong>
                <span class="result-meta">
                  <span class="tag">{TYPE_LABEL[item.type] ?? item.type}</span>
                  {#if item.year}<span>{item.year}</span>{/if}
                </span>
              </span>
              <span class="result-servers">{plural(item.servers.length, 'servidor', 'servidores')}</span>
            </button>
          {/each}
        </div>
      {/if}
    </section>
  {:else}
    {#if library.recents.length}
      <section class="shelf">
        <div class="shelf-head">
          <h2>Continuar assistindo</h2>
          <button class="link" onclick={() => { clearRecents(); toast('Histórico limpo.'); }}>Limpar histórico</button>
        </div>
        <div class="continue-grid">
          {#each library.recents as item (item.key ?? item.title)}
            <div class="card">
              <button class="card-media wide" onclick={() => resume(item)} aria-label="Continuar {item.title}">
                <Cover src={item.cover_url} title={item.title} ratio="16 / 9" fontSize={20} />
                <span class="play-overlay"><span class="play-circle"><Icon name="play" size={20} /></span></span>
                {#if item.progressPct > 0 && item.progressPct < 100}
                  <span class="bar"><span style:width="{item.progressPct}%"></span></span>
                {/if}
              </button>
              <button class="card-remove" onclick={() => removeRecent(item)} aria-label="Remover {item.title} do histórico">
                <Icon name="close" size={14} stroke={2.6} />
              </button>
              <div class="card-text">
                <strong>{item.title}</strong>
                <span>{continueLine(item)}</span>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if library.favorites.length}
      <section class="shelf">
        <div class="shelf-head">
          <h2>Meus favoritos</h2>
          <span class="muted">{plural(library.favorites.length, 'título', 'títulos')}</span>
        </div>
        <div class="poster-grid">
          {#each library.favorites as item (item.key ?? item.title)}
            <div class="card">
              <button class="card-media" onclick={() => open(item)} aria-label={item.title}>
                <Cover src={item.cover_url} title={item.title} />
                <span class="type-badge">{TYPE_LABEL[item.type] ?? item.type}</span>
              </button>
              <div class="card-text">
                <strong>{item.title}</strong>
                <span>{[item.year, item.servers?.length ? plural(item.servers.length, 'servidor', 'servidores') : ''].filter(Boolean).join(' · ')}</span>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if !library.recents.length && !library.favorites.length && servers.list.length}
      <div class="empty">
        <Icon name="play" size={32} />
        <p>Busque um título acima. O que você assistir e favoritar aparece aqui.</p>
      </div>
    {/if}
  {/if}
</main>

<style>
  .home { padding-top: 40px; padding-bottom: 80px; display: flex; flex-direction: column; gap: 44px; }
  .muted { color: var(--muted); font-size: 13px; }

  .search { display: flex; flex-direction: column; gap: 10px; max-width: 760px; }
  .search-label { font-size: 13px; color: var(--muted); }
  .search-label strong { color: var(--text); }
  .search-box {
    display: flex; align-items: center; gap: 12px; height: 52px; padding: 0 18px;
    border-radius: 12px; border: 1px solid var(--border-strong); background: var(--surface-2);
    color: var(--muted);
  }
  .search-box:focus-within { border-color: var(--accent); }
  .search-box input { flex: 1; height: 100%; border: none; outline: none; background: none; font-size: 16px; color: var(--text); }
  .search-box input::placeholder { color: var(--faint); }

  .results { display: flex; flex-direction: column; gap: 16px; }
  .results-head { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; }
  .results-head h2 { font-size: 15px; font-weight: 600; color: var(--muted); }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip {
    height: 32px; padding: 0 12px; border-radius: 99px;
    border: 1px solid var(--border-strong); background: var(--surface-2); color: var(--text-2);
    font-size: 13px; font-weight: 600;
  }
  .chip span { opacity: 0.65; margin-left: 2px; }
  .chip.on { background: var(--primary-bg); color: var(--primary-fg); border-color: transparent; }

  .result-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .result {
    display: flex; align-items: center; gap: 16px; padding: 10px;
    border-radius: 12px; border: 1px solid var(--border); background: var(--surface-2);
    color: var(--text); text-align: left;
  }
  .result:hover { background: var(--hover); }
  .result-cover { width: 46px; flex-shrink: 0; border-radius: 6px; overflow: hidden; }
  .result-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .result-info strong { font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .result-meta { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
  .result-servers { font-size: 12px; color: var(--muted); padding-right: 8px; white-space: nowrap; }

  .shelf { display: flex; flex-direction: column; gap: 16px; }
  .shelf-head { display: flex; align-items: baseline; gap: 12px; }
  .shelf-head h2 { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
  .shelf-head .link { margin-left: auto; color: var(--muted); }

  .continue-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px; }
  .poster-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 20px; }

  .card { position: relative; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .card-media {
    position: relative; display: block; width: 100%; padding: 0;
    border: none; border-radius: 10px; overflow: hidden; background: none;
    outline-offset: 3px;
  }
  .card-media:hover { outline: 2px solid var(--text); }
  .play-overlay {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    background: rgba(0, 0, 0, 0.35); opacity: 0; transition: opacity .15s;
  }
  .card-media:hover .play-overlay, .card-media:focus-visible .play-overlay { opacity: 1; }
  .play-circle {
    width: 52px; height: 52px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    background: #e8eaed; color: #0b0d10;
  }
  .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: rgba(255, 255, 255, 0.22); }
  .bar span { display: block; height: 100%; background: var(--accent); }
  .type-badge {
    position: absolute; top: 10px; left: 10px;
    padding: 3px 8px; border-radius: 6px; background: rgba(0, 0, 0, 0.68);
    color: #e8eaed; font-size: 11px; font-weight: 600;
  }
  .card-remove {
    position: absolute; top: 8px; right: 8px;
    width: 28px; height: 28px; border-radius: 50%; border: none;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0, 0, 0, 0.72); color: #e8eaed;
    opacity: 0; transition: opacity .15s;
  }
  .card:hover .card-remove, .card-remove:focus-visible { opacity: 1; }
  .card-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .card-text strong { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card-text span { font-size: 12.5px; color: var(--muted); }

  @media (max-width: 900px) {
    .result-grid { grid-template-columns: 1fr; }
  }
</style>
