<script>
  /** Configurações: #/config/servidores e #/config/reproducao */
  import { navigate } from '../lib/router.svelte.js';
  import { settings, setSetting } from '../lib/settings.svelte.js';
  import ServersTable from '../components/ServersTable.svelte';
  import Switch from '../components/Switch.svelte';

  let { tab = 'servidores' } = $props();

  const TABS = [['servidores', 'Servidores'], ['reproducao', 'Reprodução']];

  const PREFS = [
    ['skipIntro', 'Botão “Pular abertura”', 'Mostra o botão na barra do player, junto de Anterior/Próximo. Avança 1:30 a partir do ponto atual. Atalho: S.'],
    ['autoNext', 'Reproduzir próximo episódio automaticamente', 'Nos últimos 20 segundos aparece a contagem para o próximo episódio, com opção de cancelar.'],
    ['resume', 'Retomar de onde parei', 'Ao abrir um episódio ou filme já iniciado, continua do ponto salvo.'],
  ];
</script>

<main class="container settings">
  <h1>Configurações</h1>
  <div class="tabs" role="tablist">
    {#each TABS as [key, label] (key)}
      <button role="tab" aria-selected={tab === key} class:on={tab === key}
              onclick={() => navigate('/config/' + key, { replace: true })}>{label}</button>
    {/each}
  </div>

  {#if tab === 'reproducao'}
    <div class="panel">
      {#each PREFS as [key, title, desc] (key)}
        <div class="pref">
          <div class="pref-text"><strong>{title}</strong><span>{desc}</span></div>
          <Switch checked={settings[key]} label={title} onchange={(v) => setSetting(key, v)} />
        </div>
      {/each}
    </div>

    <h2>Aparência</h2>
    <div class="panel">
      <div class="pref">
        <div class="pref-text"><strong>Tema claro</strong><span>Usa fundo claro em vez do tema escuro padrão.</span></div>
        <Switch checked={settings.theme === 'light'} label="Tema claro"
                onchange={(v) => setSetting('theme', v ? 'light' : 'dark')} />
      </div>
    </div>
  {:else}
    <div class="servers"><ServersTable /></div>
  {/if}
</main>

<style>
  .settings { padding-top: 32px; padding-bottom: 80px; display: flex; flex-direction: column; gap: 24px; }
  h1 { font-size: 28px; font-weight: 800; letter-spacing: -0.02em; }
  h2 { font-size: 16px; font-weight: 700; margin-top: 8px; }
  .tabs { display: flex; gap: 24px; border-bottom: 1px solid var(--border); }
  .tabs button {
    padding: 12px 2px; margin-bottom: -1px; border: none; background: none;
    border-bottom: 2px solid transparent;
    font-size: 14.5px; font-weight: 600; color: var(--muted);
  }
  .tabs button.on { color: var(--text); border-bottom-color: var(--text); }
  .servers { display: flex; flex-direction: column; gap: 16px; }
  .panel { max-width: 760px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
  .pref { display: flex; align-items: center; gap: 24px; padding: 20px 22px; border-bottom: 1px solid var(--border); }
  .pref:last-child { border-bottom: none; }
  .pref-text { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .pref-text strong { font-size: 15px; font-weight: 600; }
  .pref-text span { font-size: 13px; line-height: 1.5; color: var(--muted); }
</style>
