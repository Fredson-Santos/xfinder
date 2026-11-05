<script>
  /**
   * Lista de servidores onde o título existe, cada um com Assistir / abrir no
   * player externo / copiar link. "Assistir" começa por aquele servidor e usa
   * os demais como failover.
   */
  import { navigate, href, route } from '../lib/router.svelte.js';
  import { mediaSources } from '../lib/streams.js';
  import { daysUntil } from '../lib/format.js';
  import { toast } from '../lib/toast.svelte.js';
  import { copyText } from '../lib/clipboard.js';
  import Icon from './Icon.svelte';

  let { item } = $props();

  let rows = $derived((item?.servers || []).map((occ, i) => ({
    occ,
    index: i,
    source: mediaSources({ ...item, servers: [occ] })[0],
    format: (occ.container_extension || (occ.raw_url?.includes('.m3u8') ? 'HLS' : '')).toUpperCase(),
    days: daysUntil(occ.expiry),
  })).filter((r) => r.source));

  function play(i) {
    navigate(href(route.path, { ...route.query, play: 1, src: i }));
  }

  function copy(url) {
    copyText(url, 'Link copiado!');
  }
</script>

<div class="sources">
  <h2>Fontes disponíveis</h2>
  {#each rows as r (r.index)}
    <div class="source">
      <span class="dot"></span>
      <div class="info">
        <strong>{r.occ.server_name}</strong>
        <span class="mono">{r.source.host}{r.format ? ` · ${r.format}` : ''}</span>
      </div>
      {#if r.days !== null && r.days <= 7}
        <span class="tag" class:tag-danger={r.days < 0}>{r.days < 0 ? 'Vencido' : `Vence em ${r.days}d`}</span>
      {/if}
      <div class="actions">
        <button class="btn btn-sm btn-primary" onclick={() => play(r.index)}><Icon name="play" size={13} /> Assistir</button>
        <button class="btn btn-sm btn-icon" onclick={() => window.open(r.source.url, '_blank', 'noopener')}
                aria-label="Abrir no player externo" title="Abrir em nova aba / player externo"><Icon name="external" size={15} /></button>
        <button class="btn btn-sm btn-icon" onclick={() => copy(r.source.url)} aria-label="Copiar link" title="Copiar link">
          <Icon name="copy" size={15} />
        </button>
      </div>
    </div>
  {:else}
    <p class="hint">Nenhuma fonte disponível.</p>
  {/each}
</div>

<style>
  .sources { display: flex; flex-direction: column; gap: 8px; }
  h2 { font-size: 16px; font-weight: 700; margin-bottom: 6px; }
  .source {
    display: flex; align-items: center; gap: 14px; padding: 12px 14px;
    border-radius: 12px; border: 1px solid var(--border); background: var(--surface);
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); flex-shrink: 0; }
  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .info strong { font-size: 14px; }
  .info span { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .actions { display: flex; gap: 6px; }
</style>
