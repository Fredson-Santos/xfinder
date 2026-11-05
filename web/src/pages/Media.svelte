<script>
  /** Filme ou canal ao vivo. URL: #/titulo/<chave>?play=1&src=<índice do servidor> */
  import { untrack } from 'svelte';
  import { route, navigate, href, back } from '../lib/router.svelte.js';
  import { findItem } from '../lib/items.js';
  import { library, isFavorite, toggleFavorite, getMediaProgress, saveMediaProgress, WATCHED_PCT } from '../lib/library.svelte.js';
  import { mediaSources } from '../lib/streams.js';
  import { openPlayer, stopPlayer, player } from '../lib/player.svelte.js';
  import { settings } from '../lib/settings.svelte.js';
  import { toast } from '../lib/toast.svelte.js';
  import { TYPE_LABEL, humanDuration, plural } from '../lib/format.js';
  import Cover from '../components/Cover.svelte';
  import Icon from '../components/Icon.svelte';
  import SourceList from '../components/SourceList.svelte';

  let { key } = $props();

  let item = $state(null);
  $effect(() => {
    const k = key;
    item = untrack(() => findItem(k, [library.favorites, library.recents]));
  });

  let isLive = $derived(item?.type === 'live');
  let sources = $derived(item ? mediaSources(item) : []);
  let prog = $derived((library.version, item && !isLive ? getMediaProgress(item) : null));
  let partial = $derived(!!prog && prog.currentTime > 10 && prog.progressPct < WATCHED_PCT);
  let fav = $derived((library.favorites, item ? isFavorite(item) : false));

  // Reprodução dirigida pela URL (?play=1)
  $effect(() => {
    const p = route.query.play;
    const src = Number(route.query.src) || 0;
    const ready = !!item && sources.length > 0;
    untrack(() => {
      if (!p) { if (player.request?.ownerKey === key) stopPlayer(); return; }
      if (ready) start(src);
    });
  });

  function start(first) {
    const i = Math.min(Math.max(first, 0), sources.length - 1);
    const ordered = [sources[i], ...sources.filter((_, j) => j !== i)];
    openPlayer({
      ownerKey: key,
      ownerPath: route.path,
      title: item.title,
      subtitle: isLive ? 'Ao vivo' : (item.year ? `Filme · ${item.year}` : 'Filme'),
      poster: item.cover_url || '',
      type: item.type,
      sources: ordered,
      initialTime: settings.resume && partial ? prog.currentTime : 0,
      onProgress: (p) => saveMediaProgress(item, p),
      queue: null,
      onClose: () => back(route.path),
    });
  }

  function copy() {
    const url = sources[0]?.url;
    if (url) navigator.clipboard?.writeText(url).then(() => toast('Link copiado!'), () => prompt('Copie o link:', url));
  }

  function onFav() {
    toast(toggleFavorite(item) ? 'Adicionado aos favoritos.' : 'Removido dos favoritos.');
  }
</script>

{#if !item}
  <main class="container">
    <div class="empty">
      <Icon name="search" size={32} stroke={1.6} />
      <p>Não encontramos este título neste navegador. Busque por ele no Início.</p>
      <button class="btn btn-primary" onclick={() => navigate('/')}>Ir para o Início</button>
    </div>
  </main>
{:else}
  <main>
    <section class="hero">
      <div class="container hero-inner">
        <button class="btn btn-ghost back" onclick={() => back('/')}><Icon name="back" size={16} /> Voltar</button>
        <div class="hero-body">
          <div class="poster"><Cover src={item.cover_url} title={item.title} fontSize={22} /></div>
          <div class="hero-info">
            <h1>{item.title}</h1>
            <div class="tags">
              <span class="tag tag-accent">{TYPE_LABEL[item.type] ?? item.type}</span>
              {#if item.year}<span class="tag">{item.year}</span>{/if}
              <span class="tag">{plural(item.servers.length, 'servidor', 'servidores')}</span>
            </div>
            {#if partial}
              <div class="progress">
                <div class="track"><div style:width="{prog.progressPct}%"></div></div>
                <span>faltam {humanDuration(prog.duration - prog.currentTime)}</span>
              </div>
            {/if}
            <div class="actions">
              <button class="btn btn-primary btn-lg" disabled={!sources.length}
                      onclick={() => navigate(href(route.path, { play: 1 }))}>
                <Icon name="play" size={18} />
                {isLive ? 'Assistir ao vivo' : partial ? 'Continuar' : 'Assistir'}
              </button>
              <button class="btn btn-lg" class:fav onclick={onFav}>
                <Icon name="star" size={16} filled={fav} /> {fav ? 'Nos favoritos' : 'Favoritar'}
              </button>
              <button class="btn btn-lg" onclick={copy} disabled={!sources.length}><Icon name="copy" size={16} /> Copiar link</button>
            </div>
          </div>
        </div>
      </div>
    </section>
    <section class="container body">
      <SourceList {item} />
    </section>
  </main>
{/if}

<style>
  .hero { border-bottom: 1px solid var(--border); background: var(--surface); }
  .hero-inner { padding-top: 24px; padding-bottom: 40px; display: flex; flex-direction: column; gap: 20px; }
  .back { align-self: flex-start; margin-left: -12px; }
  .hero-body { display: flex; gap: 40px; align-items: flex-start; }
  .poster { width: 220px; flex-shrink: 0; border-radius: 12px; overflow: hidden; box-shadow: var(--shadow); }
  .hero-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 16px; padding-top: 4px; }
  h1 { font-size: 40px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; }
  .tags { display: flex; flex-wrap: wrap; gap: 8px; }
  .tags .tag { font-size: 13px; padding: 4px 10px; }
  .progress { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--muted); }
  .track { width: 260px; height: 6px; border-radius: 99px; background: var(--border-strong); overflow: hidden; }
  .track div { height: 100%; background: var(--accent); }
  .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 6px; }
  .fav { color: var(--warn); }
  .body { padding-top: 32px; padding-bottom: 80px; }
  @media (max-width: 760px) {
    .hero-body { flex-direction: column; }
    .poster { width: 150px; }
  }
</style>
