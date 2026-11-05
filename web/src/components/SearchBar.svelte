<script>
  /**
   * Barra de busca do header. Só escreve a consulta na URL (#/?q=...);
   * quem executa a busca e mostra os resultados é a Home.
   */
  import { untrack } from 'svelte';
  import { route, navigate, href } from '../lib/router.svelte.js';
  import { okServers } from '../lib/servers.svelte.js';
  import { searchState } from '../lib/search.svelte.js';
  import { plural } from '../lib/format.js';
  import Icon from './Icon.svelte';

  const SEARCH_DEBOUNCE_MS = 350;

  let inputEl;
  let input = $state('');
  let debounce;

  let q = $derived(route.path === '/' ? (route.query.q ?? '').trim() : '');
  let activeCount = $derived(okServers().length);

  // Acompanha a URL (Voltar/F5/troca de página), sem atropelar quem está digitando
  $effect(() => {
    const query = q;
    untrack(() => {
      if (input.trim() !== query && document.activeElement !== inputEl) input = query;
    });
  });

  function onInput() {
    clearTimeout(debounce);
    debounce = setTimeout(() => setQuery(input.trim()), SEARCH_DEBOUNCE_MS);
  }

  function setQuery(value) {
    if (value === q && route.path === '/') return;
    if (!value && route.path !== '/') return; // apagar fora da Home não muda de página
    // Primeira busca cria uma entrada no histórico; refinamentos substituem
    navigate(href('/', { q: value }), { replace: !!q && !!value });
  }

  function onKeydown(e) {
    if (e.key === 'Enter') { clearTimeout(debounce); setQuery(input.trim()); }
    if (e.key === 'Escape' && input) { e.stopPropagation(); clearTimeout(debounce); input = ''; setQuery(''); }
  }
</script>

<div class="search-box">
  <Icon name="search" size={17} />
  <input bind:this={inputEl} id="search" type="search" bind:value={input} oninput={onInput} onkeydown={onKeydown}
         placeholder={activeCount ? `Buscar em ${plural(activeCount, 'servidor', 'servidores')}…` : 'Filme, série ou canal…'}
         aria-label="Buscar filme, série ou canal" autocomplete="off" spellcheck="false" />
  {#if searchState.loading}<span class="spinner"></span>{/if}
</div>

<style>
  .search-box {
    display: flex; align-items: center; gap: 10px; height: 42px; padding: 0 14px;
    width: 100%; min-width: 0;
    border-radius: 10px; border: 1px solid var(--border-strong); background: var(--surface-2);
    color: var(--muted);
  }
  .search-box:focus-within { border-color: var(--accent); }
  .search-box input {
    flex: 1; min-width: 0; height: 100%; border: none; outline: none; background: none;
    font-size: 15px; color: var(--text);
  }
  .search-box input::placeholder { color: var(--faint); }
</style>
