<script>
  /** Painel lateral para adicionar servidores: Xtream, lista M3U ou em lote. */
  import { addAndValidate } from '../lib/servers.svelte.js';
  import { parseBatchServerInput } from '../lib/batchParser.js';
  import { toast } from '../lib/toast.svelte.js';
  import { plural } from '../lib/format.js';
  import Icon from './Icon.svelte';

  let { open = false, onclose, ondone } = $props();

  let dialog;
  let mode = $state('xtream');
  let busy = $state(false);
  let progress = $state(null); // { done, total, ok, failed }

  let xtream = $state({ name: '', host: '', username: '', password: '' });
  let m3u = $state({ name: '', url: '' });
  let batchText = $state('');
  let batchList = $state([]);
  let dragOver = $state(false);
  let fileInput = $state();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  // Colar um link get.php no host preenche usuário e senha
  function onHostInput() {
    const v = xtream.host.trim();
    if (!/get\.php|username=|password=/.test(v)) return;
    try {
      const url = new URL(v);
      xtream.host = url.origin;
      xtream.username = url.searchParams.get('username') || xtream.username;
      xtream.password = url.searchParams.get('password') || xtream.password;
      if (!xtream.name) xtream.name = url.hostname;
    } catch { /* não é URL completa */ }
  }

  let parseTimer;
  function onBatchInput() {
    clearTimeout(parseTimer);
    parseTimer = setTimeout(() => (batchList = parseBatchServerInput(batchText)), 150);
  }

  function readFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      batchText = String(reader.result || '');
      batchList = parseBatchServerInput(batchText);
      toast(`"${file.name}": ${plural(batchList.length, 'servidor encontrado', 'servidores encontrados')}.`);
    };
    reader.onerror = () => toast('Não foi possível ler o arquivo.');
    reader.readAsText(file);
  }

  function buildList() {
    if (mode === 'xtream') {
      const { name, host, username, password } = xtream;
      if (!host.trim() || !username.trim() || !password.trim()) { toast('Preencha host, usuário e senha.'); return null; }
      return [{
        name: name.trim() || new URL(host.startsWith('http') ? host : 'http://' + host).hostname,
        serverType: 'xtream', host: host.trim(), port: null,
        username: username.trim(), password: password.trim(), m3uUrl: null,
      }];
    }
    if (mode === 'm3u') {
      if (!m3u.url.trim()) { toast('Cole a URL da lista M3U.'); return null; }
      return [{
        name: m3u.name.trim() || 'Lista M3U', serverType: 'm3u',
        host: null, port: null, username: null, password: null, m3uUrl: m3u.url.trim(),
      }];
    }
    if (!batchList.length) { toast('Nenhum servidor identificado no texto.'); return null; }
    return batchList.map((s, i) => ({ ...s, name: s.name.trim() || `Servidor ${i + 1}` }));
  }

  async function submit() {
    let list;
    try { list = buildList(); } catch { toast('Host inválido.'); return; }
    if (!list) return;
    busy = true;
    progress = { done: 0, total: list.length, ok: 0, failed: 0 };
    try {
      const res = await addAndValidate(list, (p) => (progress = p));
      if (res.ok) {
        toast(`${plural(res.ok, 'servidor salvo', 'servidores salvos')}${res.failed ? ` · ${res.failed} descartado(s) por erro` : ''}.`, 5000);
        reset();
        ondone?.();
        onclose?.();
      } else {
        toast(`Nenhum servidor respondeu${res.errors[0] ? `: ${res.errors[0]}` : ''}. Nada foi salvo.`, 6000);
      }
    } catch (err) {
      toast('Erro ao adicionar: ' + err.message);
    } finally {
      busy = false;
      progress = null;
    }
  }

  function reset() {
    xtream = { name: '', host: '', username: '', password: '' };
    m3u = { name: '', url: '' };
    batchText = '';
    batchList = [];
  }

  let pct = $derived(progress ? Math.round((progress.done / Math.max(progress.total, 1)) * 100) : 0);
</script>

<dialog bind:this={dialog} class="drawer" aria-labelledby="add-title"
        oncancel={(e) => { e.preventDefault(); if (!busy) onclose?.(); }}>
  <header>
    <h2 id="add-title">Adicionar servidor</h2>
    <button class="btn btn-icon btn-sm" onclick={() => onclose?.()} disabled={busy} aria-label="Fechar"><Icon name="close" size={16} /></button>
  </header>

  <div class="tabs" role="tablist">
    {#each [['xtream', 'Xtream'], ['m3u', 'Lista M3U'], ['batch', 'Em lote']] as [key, label] (key)}
      <button role="tab" aria-selected={mode === key} class:on={mode === key} onclick={() => (mode = key)} disabled={busy}>{label}</button>
    {/each}
  </div>

  <div class="body">
    {#if mode === 'xtream'}
      <label class="field">Nome <input class="input" bind:value={xtream.name} placeholder="Servidor principal" /></label>
      <label class="field">Host ou link get.php
        <input class="input" bind:value={xtream.host} oninput={onHostInput} placeholder="http://servidor.com:8080" />
      </label>
      <div class="two">
        <label class="field">Usuário <input class="input" bind:value={xtream.username} autocomplete="off" /></label>
        <label class="field">Senha <input class="input" type="password" bind:value={xtream.password} autocomplete="off" /></label>
      </div>
      <p class="hint">Colar um link get.php preenche usuário e senha sozinho.</p>
    {:else if mode === 'm3u'}
      <label class="field">Nome <input class="input" bind:value={m3u.name} placeholder="Lista do provedor" /></label>
      <label class="field">URL da lista M3U/M3U8
        <input class="input" bind:value={m3u.url} placeholder="http://provedor.com/lista.m3u" />
      </label>
    {:else}
      <button class="drop" class:over={dragOver} onclick={() => fileInput.click()}
              ondragover={(e) => { e.preventDefault(); dragOver = true; }}
              ondragleave={() => (dragOver = false)}
              ondrop={(e) => { e.preventDefault(); dragOver = false; readFile(e.dataTransfer?.files?.[0]); }}>
        <Icon name="upload" size={20} />
        <span><strong>Selecione um arquivo</strong> ou arraste para cá</span>
        <small>.txt, .m3u, .csv ou .json com vários servidores</small>
      </button>
      <input bind:this={fileInput} type="file" accept=".txt,.m3u,.m3u8,.csv,.json" hidden
             onchange={(e) => readFile(e.currentTarget.files?.[0])} />
      <label class="field">Ou cole os links (um por linha)
        <textarea class="input mono" rows="6" bind:value={batchText} oninput={onBatchInput}
                  placeholder={'http://srv1.com:8080/get.php?username=…&password=…\nhttp://srv2.com/lista.m3u\nhttp://srv3.com:8080 usuario senha Nome'}></textarea>
      </label>
      {#if batchList.length}
        <div class="preview">
          <div class="preview-head">
            <strong>{plural(batchList.length, 'servidor identificado', 'servidores identificados')}</strong>
            <button class="link" onclick={() => { batchText = ''; batchList = []; }}>Limpar</button>
          </div>
          {#each batchList as srv, i (i)}
            <div class="preview-item">
              <span class="tag" class:tag-accent={srv.serverType === 'xtream'}>{srv.serverType === 'xtream' ? 'Xtream' : 'M3U'}</span>
              <div class="pi-text">
                <input class="pi-name" bind:value={srv.name} aria-label="Nome do servidor {i + 1}" />
                <span class="mono">{srv.serverType === 'xtream' ? `${srv.host} · ${srv.username}` : srv.m3uUrl}</span>
              </div>
              <button class="btn btn-icon btn-sm btn-ghost" aria-label="Remover da lista"
                      onclick={() => (batchList = batchList.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
            </div>
          {/each}
        </div>
      {/if}
      <p class="hint">Cada servidor é validado; só os que sincronizarem com sucesso são salvos.</p>
    {/if}
  </div>

  <footer>
    {#if progress}
      <div class="progress">
        <div class="progress-text"><span>Validando {progress.done}/{progress.total}…</span><span class="mono">{pct}%</span></div>
        <div class="track"><div style:width="{pct}%"></div></div>
      </div>
    {/if}
    <button class="btn btn-primary btn-lg" onclick={submit} disabled={busy}>
      {#if busy}<span class="spinner"></span>{/if}
      {mode === 'batch' ? 'Validar, sincronizar e salvar' : 'Adicionar e sincronizar'}
    </button>
  </footer>
</dialog>

<style>
  .drawer {
    margin: 0 0 0 auto; height: 100vh; max-height: 100vh; width: 480px; max-width: 100vw;
    padding: 0; border: none; border-left: 1px solid var(--border-strong);
    background: var(--surface); color: var(--text);
    display: flex; flex-direction: column;
  }
  .drawer:not([open]) { display: none; }
  .drawer::backdrop { background: var(--overlay); }
  header { display: flex; align-items: center; padding: 24px 24px 16px; }
  h2 { font-size: 20px; font-weight: 800; flex: 1; }
  .tabs { display: flex; gap: 4px; margin: 0 24px; padding: 4px; border-radius: 10px; background: var(--bg); }
  .tabs button {
    flex: 1; height: 36px; border: none; border-radius: 8px; background: transparent;
    font-size: 13px; font-weight: 600; color: var(--muted);
  }
  .tabs button.on { background: var(--surface-3); color: var(--text); }
  .body { flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 14px; }
  .body > * { flex-shrink: 0; }
  .two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }

  .drop {
    display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 22px;
    border-radius: 10px; border: 1.5px dashed var(--border-strong); background: var(--bg);
    color: var(--text-2); font-size: 13.5px;
  }
  .drop.over, .drop:hover { border-color: var(--accent); }
  .drop small { color: var(--muted); font-size: 12px; }
  textarea { font-size: 12.5px; }

  .preview { flex-shrink: 0; display: flex; flex-direction: column; gap: 6px; padding: 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--bg); max-height: 280px; overflow-y: auto; }
  .preview-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; margin-bottom: 4px; }
  .preview-item { display: flex; align-items: center; gap: 10px; padding: 6px 4px; border-top: 1px solid var(--border); }
  .pi-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .pi-name { border: 1px solid transparent; border-radius: 6px; background: none; padding: 2px 4px; margin-left: -4px; font-weight: 600; font-size: 13px; }
  .pi-name:hover, .pi-name:focus { border-color: var(--border-strong); outline: none; }
  .pi-text span { font-size: 11.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  footer { padding: 16px 24px 24px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 12px; }
  footer .btn { width: 100%; }
  .progress { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; color: var(--muted); }
  .progress-text { display: flex; justify-content: space-between; }
  .track { height: 6px; border-radius: 99px; background: var(--border-strong); overflow: hidden; }
  .track div { height: 100%; background: var(--accent); transition: width .2s; }
</style>
