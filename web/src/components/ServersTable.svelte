<script>
  /**
   * Servidores: filtro por texto/status, seleção múltipla (inclui Shift+clique
   * para intervalo) e ações em lote (sincronizar / remover).
   */
  import { servers, serverKind, syncServers, removeServers, loadServers } from '../lib/servers.svelte.js';
  import { api } from '../lib/api.js';
  import { daysUntil, formatNumber, plural } from '../lib/format.js';
  import { toast } from '../lib/toast.svelte.js';
  import { copyText } from '../lib/clipboard.js';
  import Icon from './Icon.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import AddServerDrawer from './AddServerDrawer.svelte';

  let query = $state('');
  let filter = $state('all');
  let selected = $state(new Set());
  let lastIndex = null;
  let confirmIds = $state(null);
  let addOpen = $state(false);

  const KIND = {
    ok:       { label: 'Online',          cls: 'ok' },
    expiring: { label: 'Online',          cls: 'ok' },
    error:    { label: 'Erro',            cls: 'danger' },
    expired:  { label: 'Vencido',         cls: 'danger' },
    syncing:  { label: 'Sincronizando…',  cls: 'accent' },
    pending:  { label: 'Pendente',        cls: 'muted' },
  };
  const FILTERS = [
    ['all', 'Todos'], ['ok', 'Online'], ['error', 'Com erro'], ['expiring', 'Vencendo'], ['expired', 'Vencidos'],
  ];

  let rows = $derived(servers.list.map((s) => ({ ...s, kind: serverKind(s) })));
  let counts = $derived(rows.reduce((acc, r) => {
    acc.all++;
    acc[r.kind] = (acc[r.kind] || 0) + 1;
    return acc;
  }, { all: 0 }));

  let visible = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== 'all' && r.kind !== filter && !(filter === 'ok' && r.kind === 'expiring')) return false;
      return !q || r.name.toLowerCase().includes(q) || hostOf(r).toLowerCase().includes(q);
    });
  });

  // Remove da seleção quem saiu da lista (ex.: removido / descartado)
  $effect(() => {
    const ids = new Set(servers.list.map((s) => s.id));
    if ([...selected].some((id) => !ids.has(id))) selected = new Set([...selected].filter((id) => ids.has(id)));
  });

  let selectedIds = $derived([...selected]);
  let allVisibleSelected = $derived(visible.length > 0 && visible.every((r) => selected.has(r.id)));
  let someVisibleSelected = $derived(!allVisibleSelected && visible.some((r) => selected.has(r.id)));

  function hostOf(s) {
    if (s.type === 'm3u') return s.m3u_url || '';
    return (s.host || '') + (s.port && !String(s.host).includes(':' + s.port) ? ':' + s.port : '');
  }

  /** Link M3U da lista: o próprio link (M3U) ou o get.php do painel (Xtream). */
  function m3uLink(s) {
    if (s.type === 'm3u') return s.m3u_url || '';
    if (!s.host || !s.username || !s.password) return '';
    let base = String(s.host).trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) base = 'http://' + base;
    if (s.port && !/:\d+$/.test(base)) base += ':' + s.port;
    const qs = new URLSearchParams({ username: s.username, password: s.password, type: 'm3u_plus', output: 'ts' });
    return `${base}/get.php?${qs}`;
  }

  function copyM3u(s) {
    const url = m3uLink(s);
    if (!url) { toast('Esta lista não tem link M3U.'); return; }
    copyText(url, 'Link M3U copiado!');
  }

  function expiryLabel(s) {
    const d = daysUntil(s.expiry);
    if (d === null) return { text: 'Sem vencimento', cls: 'muted' };
    if (d < 0) return { text: `Venceu há ${-d}d`, cls: 'danger' };
    if (d === 0) return { text: 'Vence hoje', cls: 'warn' };
    if (d <= 7) return { text: `Vence em ${d}d`, cls: 'warn' };
    return { text: new Date(s.expiry).toLocaleDateString('pt-BR'), cls: '' };
  }

  function toggleRow(row, index, event) {
    const next = new Set(selected);
    const target = !next.has(row.id);
    if (event.shiftKey && lastIndex !== null) {
      const [a, b] = [Math.min(lastIndex, index), Math.max(lastIndex, index)];
      for (let i = a; i <= b; i++) target ? next.add(visible[i].id) : next.delete(visible[i].id);
    } else {
      target ? next.add(row.id) : next.delete(row.id);
    }
    selected = next;
    lastIndex = index;
  }

  function toggleAll() {
    const next = new Set(selected);
    visible.forEach((r) => (allVisibleSelected ? next.delete(r.id) : next.add(r.id)));
    selected = next;
  }

  async function sync(ids) {
    toast(ids.length === 1 ? 'Sincronizando…' : `Sincronizando ${ids.length} servidores…`);
    const res = await syncServers(ids);
    toast(res.failed
      ? `${res.ok} sincronizado(s) · ${res.failed} com erro${res.errors[0] ? ` (${res.errors[0]})` : ''}`
      : `${plural(res.ok, 'servidor sincronizado', 'servidores sincronizados')}.`, 5000);
  }

  async function doRemove() {
    const ids = confirmIds;
    confirmIds = null;
    try {
      const n = await removeServers(ids);
      toast(`${plural(n, 'servidor removido', 'servidores removidos')}.`);
    } catch (err) {
      toast('Erro ao remover: ' + err.message);
    }
  }

  function exportAs(format) {
    const a = document.createElement('a');
    a.href = api.exportUrl(format);
    a.download = '';
    a.click();
  }
</script>

<div class="toolbar">
  <label class="filter-box">
    <Icon name="search" size={15} />
    <span class="sr-only">Filtrar servidores</span>
    <input bind:value={query} placeholder="Filtrar por nome ou host" oninput={() => (lastIndex = null)} />
  </label>
  <div class="chips" role="group" aria-label="Filtrar por status">
    {#each FILTERS as [key, label] (key)}
      <button class="chip" class:on={filter === key} aria-pressed={filter === key}
              onclick={() => { filter = key; lastIndex = null; }}>
        {label} <span>{key === 'ok' ? (counts.ok || 0) + (counts.expiring || 0) : counts[key] || 0}</span>
      </button>
    {/each}
  </div>
  <div class="spacer"></div>
  <button class="btn" onclick={() => exportAs('txt')}><Icon name="download" size={14} /> Exportar TXT</button>
  <button class="btn" onclick={() => exportAs('csv')}><Icon name="download" size={14} /> Exportar CSV</button>
  <button class="btn btn-primary" onclick={() => (addOpen = true)}><Icon name="plus" size={15} /> Adicionar servidor</button>
</div>

<div class="bulk" class:active={selected.size > 0}>
  <span class="bulk-label">
    {selected.size ? plural(selected.size, 'servidor selecionado', 'servidores selecionados') : 'Nenhum servidor selecionado'}
  </span>
  {#if selected.size}<button class="link" onclick={() => { selected = new Set(); lastIndex = null; }}>Limpar seleção</button>{/if}
  <div class="spacer"></div>
  <button class="btn btn-sm" disabled={!selected.size} onclick={() => sync(selectedIds)}>
    <Icon name="sync" size={14} /> Sincronizar selecionados
  </button>
  <button class="btn btn-sm btn-danger" disabled={!selected.size} onclick={() => (confirmIds = selectedIds)}>
    <Icon name="trash" size={14} /> Remover selecionados
  </button>
</div>

<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th class="col-check">
          <input type="checkbox" aria-label="Selecionar todos os visíveis"
                 checked={allVisibleSelected} indeterminate={someVisibleSelected} onchange={toggleAll} />
        </th>
        <th>Servidor</th>
        <th>Tipo</th>
        <th>Status</th>
        <th>Vencimento</th>
        <th class="num">Conteúdos</th>
        <th class="num">Ações</th>
      </tr>
    </thead>
    <tbody>
      {#each visible as row, i (row.id)}
        {@const exp = expiryLabel(row)}
        <tr class:selected={selected.has(row.id)}>
          <td class="col-check">
            <input type="checkbox" aria-label="Selecionar {row.name}" checked={selected.has(row.id)}
                   onclick={(e) => toggleRow(row, i, e)} />
          </td>
          <td>
            <div class="name">{row.name}</div>
            <div class="host mono" title={hostOf(row)}>{hostOf(row)}</div>
          </td>
          <td class="dim">{row.type === 'm3u' ? 'M3U' : 'Xtream'}</td>
          <td><span class="status {KIND[row.kind].cls}"><span class="dot"></span>{KIND[row.kind].label}</span></td>
          <td><span class="exp {exp.cls}">{exp.text}</span></td>
          <td class="num mono dim">{row.status === 'ok' ? formatNumber(row.media_count) : '—'}</td>
          <td class="num actions">
            <button class="btn btn-sm btn-icon" onclick={() => sync([row.id])} disabled={row.kind === 'syncing'}
                    aria-label="Sincronizar {row.name}" title="Sincronizar"><Icon name="sync" size={14} /></button>
            <button class="btn btn-sm btn-icon" onclick={() => copyM3u(row)}
                    aria-label="Copiar link M3U de {row.name}" title="Copiar link M3U"><Icon name="copy" size={14} /></button>
            <button class="btn btn-sm btn-icon" onclick={() => (confirmIds = [row.id])}
                    aria-label="Remover {row.name}" title="Remover"><Icon name="trash" size={14} /></button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if !servers.loaded}
    <div class="empty"><span class="spinner"></span></div>
  {:else if !visible.length}
    <div class="empty">{servers.list.length ? 'Nenhum servidor neste filtro.' : 'Nenhum servidor cadastrado. Clique em “Adicionar servidor”.'}</div>
  {/if}
</div>
<p class="hint">Dica: Shift + clique seleciona um intervalo.</p>

<ConfirmDialog
  open={!!confirmIds}
  title={confirmIds?.length === 1 ? 'Remover 1 servidor?' : `Remover ${confirmIds?.length ?? 0} servidores?`}
  message="O conteúdo indexado desses servidores também sai da busca. Essa ação não pode ser desfeita."
  confirmLabel="Remover"
  danger
  onconfirm={doRemove}
  oncancel={() => (confirmIds = null)} />

<AddServerDrawer open={addOpen} onclose={() => (addOpen = false)} ondone={loadServers} />

<style>
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .spacer { flex: 1; }
  .filter-box {
    display: flex; align-items: center; gap: 8px; width: 280px; height: 38px; padding: 0 12px;
    border-radius: 9px; border: 1px solid var(--border-strong); background: var(--surface-2); color: var(--muted);
  }
  .filter-box:focus-within { border-color: var(--accent); }
  .filter-box input { flex: 1; min-width: 0; border: none; outline: none; background: none; font-size: 13px; color: var(--text); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    height: 34px; padding: 0 12px; border-radius: 99px;
    border: 1px solid var(--border-strong); background: var(--surface-2); color: var(--text-2);
    font-size: 13px; font-weight: 600;
  }
  .chip span { opacity: 0.65; margin-left: 2px; }
  .chip.on { background: var(--primary-bg); color: var(--primary-fg); border-color: transparent; }

  .bulk {
    display: flex; align-items: center; gap: 14px; padding: 10px 14px;
    border-radius: 10px; border: 1px solid var(--border); background: var(--surface);
  }
  .bulk.active { border-color: var(--accent); background: var(--selected); }
  .bulk-label { font-size: 13.5px; font-weight: 600; }

  .table-wrap { border: 1px solid var(--border); border-radius: 12px; overflow-x: auto; background: var(--surface); }
  table { width: 100%; min-width: 920px; border-collapse: collapse; font-size: 13.5px; }
  th {
    padding: 12px 8px; text-align: left; white-space: nowrap;
    font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
    color: var(--muted); border-bottom: 1px solid var(--border);
  }
  td { padding: 12px 8px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:hover { background: var(--surface-2); }
  tr.selected, tr.selected:hover { background: var(--selected); }
  .col-check { width: 44px; padding-left: 16px; }
  input[type='checkbox'] { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; }
  .num { text-align: right; padding-right: 16px; }
  .name { font-weight: 600; }
  .host { margin-top: 2px; font-size: 12px; color: var(--muted); max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dim { color: var(--text-2); }
  .actions { white-space: nowrap; }
  .actions .btn + .btn { margin-left: 4px; }

  .status {
    display: inline-flex; align-items: center; gap: 7px; padding: 4px 10px; border-radius: 99px;
    font-size: 12.5px; font-weight: 600; white-space: nowrap;
  }
  .status .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .status.ok { background: var(--ok-soft); color: var(--ok-text); }
  .status.danger { background: var(--danger-soft); color: var(--danger-text); }
  .status.accent { background: var(--accent-soft); color: var(--accent-text); }
  .status.muted { background: var(--surface-3); color: var(--muted); }
  .exp { font-size: 13px; }
  .exp.muted { color: var(--muted); }
  .exp.warn { color: var(--warn); font-weight: 600; }
  .exp.danger { color: var(--danger-text); font-weight: 600; }
  .empty { padding: 40px; }
</style>
