<script>
  import { onMount } from 'svelte';
  import { route, match, navigate } from './lib/router.svelte.js';
  import { loadServers } from './lib/servers.svelte.js';
  import { player, stopPlayer } from './lib/player.svelte.js';
  import { toastState } from './lib/toast.svelte.js';
  import Home from './pages/Home.svelte';
  import Series from './pages/Series.svelte';
  import Media from './pages/Media.svelte';
  import Settings from './pages/Settings.svelte';
  import Player from './components/Player.svelte';
  import Icon from './components/Icon.svelte';
  import SearchBar from './components/SearchBar.svelte';

  let page = $derived.by(() => {
    const p = route.path;
    let m;
    if ((m = match('/serie/:key', p))) return { name: 'series', key: m.key };
    if ((m = match('/titulo/:key', p))) return { name: 'media', key: m.key };
    if ((m = match('/config/:tab', p))) return { name: 'settings', tab: m.tab };
    if (p === '/config') return { name: 'settings', tab: 'servidores' };
    return { name: 'home' };
  });

  const TITLES = { home: 'XFinder', series: 'Série · XFinder', media: 'XFinder', settings: 'Configurações · XFinder' };
  $effect(() => { document.title = TITLES[page.name]; });

  // O player pertence a uma URL (…?play=…). Se a navegação sair dela por
  // qualquer caminho (voltar, link, URL digitada), o player fecha.
  $effect(() => {
    const path = route.path;
    const playing = !!route.query.play;
    const req = player.request;
    if (req && (!playing || req.ownerPath !== path)) stopPlayer();
  });

  onMount(loadServers);
</script>

<header class="topbar">
  <div class="container topbar-inner">
    <a class="logo" href="#/" onclick={(e) => { e.preventDefault(); navigate('/'); }}>
      <span class="logo-dot"></span><span class="logo-text">XFinder</span>
    </a>
    <div class="search"><SearchBar /></div>
    <button class="gear" class:on={page.name === 'settings'} onclick={() => navigate('/config/servidores')}
            aria-label="Configurações" title="Configurações">
      <Icon name="gear" size={20} />
    </button>
  </div>
</header>

{#if page.name === 'series'}
  {#key page.key}<Series key={page.key} />{/key}
{:else if page.name === 'media'}
  {#key page.key}<Media key={page.key} />{/key}
{:else if page.name === 'settings'}
  <Settings tab={page.tab} />
{:else}
  <Home />
{/if}

<Player />

{#if toastState.message}
  {#key toastState.id}
    <div class="toast" role="status">{toastState.message}</div>
  {/key}
{/if}

<style>
  .topbar { border-bottom: 1px solid var(--border); background: var(--bg); }
  /* logo | busca centralizada | configurações */
  .topbar-inner {
    display: grid; grid-template-columns: 1fr minmax(0, 560px) 1fr;
    align-items: center; gap: 16px; height: 64px;
  }
  .search { min-width: 0; }
  .gear { justify-self: end; }
  @media (max-width: 640px) {
    .topbar-inner { grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; }
    .logo-text { display: none; }
  }
  .logo {
    display: flex; align-items: center; gap: 10px;
    font-size: 18px; font-weight: 800; letter-spacing: -0.02em;
    color: var(--text); text-decoration: none;
  }
  .logo-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
  .gear {
    width: 40px; height: 40px; border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    border: 1px solid transparent; background: none; color: var(--muted);
  }
  .gear:hover { background: var(--surface-3); color: var(--text); }
  .gear.on { background: var(--surface-3); border-color: var(--border-strong); color: var(--text); }

  .toast {
    position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 200;
    max-width: min(640px, calc(100vw - 32px));
    padding: 12px 20px; border-radius: 10px;
    background: var(--surface-3); border: 1px solid var(--border-strong); color: var(--text);
    font-size: 13.5px; text-align: center; box-shadow: var(--shadow);
    animation: toast-in .18s ease;
  }
  @keyframes toast-in { from { opacity: 0; transform: translate(-50%, 8px); } }
</style>
