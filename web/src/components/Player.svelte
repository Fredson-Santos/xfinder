<script>
  /**
   * Player em tela cheia sobre a página: ArtPlayer + hls.js, com
   *  - failover entre servidores (erro → próxima fonte não testada),
   *  - menu para trocar a fonte manualmente,
   *  - "Pular abertura" (+1:30) e Anterior/Próximo na barra de controles,
   *  - card "Próximo episódio" nos últimos segundos,
   *  - salvamento periódico do progresso.
   */
  import { tick, untrack, onDestroy } from 'svelte';
  import { player } from '../lib/player.svelte.js';
  import { settings, SKIP_INTRO_SECS } from '../lib/settings.svelte.js';
  import { toast } from '../lib/toast.svelte.js';
  import { copyText } from '../lib/clipboard.js';
  import { clock } from '../lib/format.js';
  import { PT_BR } from '../lib/artplayer-i18n.js';
  import Icon from './Icon.svelte';

  const SAVE_EVERY_MS = 5000;
  const NEXT_CARD_SECS = 20;
  // Fonte que não entrega nenhum quadro nesse prazo conta como falha (failover).
  // Alguns painéis respondem a playlist mas nunca mandam os segmentos, sem erro.
  const START_TIMEOUT_MS = 20000;

  // ArtPlayer e hls.js (~800 KB) só são baixados quando o player abre pela 1ª vez
  let libs = null;
  const loadLibs = () => (libs ??= Promise.all([import('artplayer'), import('hls.js')])
    .then(([a, h]) => ({ Artplayer: a.default, Hls: h.default })));

  let host = $state();  // onde o ArtPlayer é montado
  let playerEl = $state(); // container persistente: é ele que entra em tela cheia
  let park;            // guarda os layers enquanto não há instância
  let topbarEl, nextEl, menuEl;

  let art = null;
  let session = 0;
  let lastSave = 0;
  let resolved = [];

  let req = $state(null);
  let statuses = $state([]);
  let index = $state(0);
  let cur = $state(0);
  let dur = $state(0);
  let allFailed = $state(false);
  let nextDismissed = $state(false);
  let menuOpen = $state(false);
  let isFs = $state(false);

  let source = $derived(req?.sources[index]);
  let isSeries = $derived(req?.type === 'series');
  let showNext = $derived(
    !!req?.queue?.hasNext && isSeries && dur > 60 && dur - cur <= NEXT_CARD_SECS && !nextDismissed && !allFailed,
  );

  // Trava a rolagem da página enquanto o player está aberto
  $effect(() => {
    document.documentElement.style.overflow = req ? 'hidden' : '';
  });

  // A tela cheia é aplicada ao container `.player`, e não ao elemento do ArtPlayer:
  // a instância é recriada a cada episódio/fonte, e remover o elemento em tela
  // cheia faz o navegador sair dela.
  $effect(() => {
    const sync = () => {
      isFs = !!document.fullscreenElement && document.fullscreenElement === playerEl;
      art?.controls?.update?.(fsControl());
    };
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  });

  const FS_ON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
  const FS_OFF = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';

  function fsControl() {
    return {
      name: 'xf-fullscreen', index: 70, position: 'right',
      tooltip: isFs ? 'Sair da tela cheia (F)' : 'Tela cheia (F)',
      html: isFs ? FS_OFF : FS_ON,
      click: toggleFullscreen,
    };
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else if (playerEl?.requestFullscreen) {
      playerEl.requestFullscreen().catch((err) => console.warn('Tela cheia negada:', err));
    } else if (art) {
      art.fullscreen = !art.fullscreen; // fallback (ex.: iOS, só o <video> entra em tela cheia)
    }
  }

  // ─── Sessões ──────────────────────────────────────────────────────────────
  $effect(() => {
    player.session;
    const r = player.request;
    untrack(() => (r ? begin(r) : teardown()));
  });

  async function begin(r) {
    save(false); // progresso do que estava tocando (ex.: troca de episódio)
    destroyArt();
    session++;
    req = r;
    statuses = r.sources.map(() => 'pending');
    resolved = [];
    cur = 0; dur = 0;
    allFailed = false; nextDismissed = false; menuOpen = false;
    await tick();
    start(0, false);
  }

  function teardown() {
    save(false);
    destroyArt();
    session++;
    req = null;
  }

  function close() {
    save(false);
    const r = req;
    teardown();
    r?.onClose?.();
  }

  // ─── Fontes / failover ────────────────────────────────────────────────────
  async function start(i, isFailover) {
    const my = session;
    const src = req.sources[i];
    index = i;
    allFailed = false;
    menuOpen = false;

    let url = resolved[i] ?? src.url;
    if (!url && src.resolve) {
      try { url = await src.resolve(); } catch (err) { console.warn('Fonte sem episódio:', err); url = ''; }
      if (my !== session) return;
    }
    if (!url) { fail(); return; }
    resolved[i] = url;

    let lib;
    try { lib = await loadLibs(); } catch (err) { console.error(err); toast('Falha ao carregar o player.'); return; }
    if (my !== session) return;

    const resumeAt = Math.max(req.initialTime || 0, art ? art.currentTime || 0 : 0, cur);
    destroyArt();
    try {
      art = createArt(lib, url);
      bind(art, i, resumeAt);
      if (isFailover) art.notice.show = `Conectando a "${src.name}" (${i + 1}/${req.sources.length})…`;
    } catch (err) {
      console.error('Falha ao iniciar o ArtPlayer:', err);
      fail();
    }
  }

  function fail() {
    statuses[index] = 'failed';
    const n = req.sources.length;
    for (let step = 1; step < n; step++) {
      const j = (index + step) % n;
      if (statuses[j] !== 'failed') {
        toast(`"${req.sources[index].name}" não respondeu. Tentando "${req.sources[j].name}"…`);
        start(j, true);
        return;
      }
    }
    allFailed = true;
  }

  function switchSource(i) {
    if (i === index && statuses[i] === 'ok') { menuOpen = false; return; }
    if (statuses[i] === 'failed') statuses[i] = 'pending';
    start(i, true);
  }

  function retryAll() {
    statuses = statuses.map(() => 'pending');
    start(0, false);
  }

  // ─── ArtPlayer ────────────────────────────────────────────────────────────
  function control(name, index, label, title, onClick, disabled = false) {
    return {
      name, index, position: 'right', tooltip: title,
      html: `<span class="xf-ctl${disabled ? ' is-disabled' : ''}">${label}</span>`,
      click: () => (disabled ? toast(title) : onClick()),
    };
  }

  function createArt({ Artplayer, Hls }, url) {
    const q = req.queue;
    const controls = [];
    if (isSeries && settings.skipIntro) {
      controls.push(control('xf-skip', 1, 'Pular abertura <small>+1:30</small>', 'Avança 1:30 (S)', skipIntro));
    }
    if (q) {
      controls.push(
        control('xf-prev', 2, '⏮ Anterior', q.hasPrev ? 'Episódio anterior (P)' : 'Este é o primeiro episódio', () => q.prev(), !q.hasPrev),
        control('xf-next', 3, 'Próximo ⏭', q.hasNext ? 'Próximo episódio (N)' : 'Este é o último episódio', () => q.next(), !q.hasNext),
      );
    }
    if (req.sources.length > 1) {
      controls.push(control('xf-src', 4, `Fonte ${index + 1}/${req.sources.length}`, 'Trocar servidor', () => (menuOpen = !menuOpen)));
    }
    controls.push(fsControl());

    Artplayer.DBCLICK_FULLSCREEN = false; // tratado em bind() → toggleFullscreen
    return new Artplayer({
      container: host,
      url,
      type: url.includes('.m3u8') ? 'm3u8' : '',
      customType: { m3u8: (video, src, a) => attachHls(Hls, video, src, a) },
      poster: req.poster || '',
      isLive: req.type === 'live',
      autoplay: true,
      volume: 0.85,
      setting: true,
      playbackRate: true,
      aspectRatio: true,
      pip: true,
      fullscreen: false, // substituído pelo controle xf-fullscreen
      fullscreenWeb: false,
      miniProgressBar: true,
      hotkey: true,
      mutex: true,
      backdrop: true,
      playsInline: true,
      autoPlayback: false,
      theme: '#4c8dff',
      lang: 'pt-br',
      i18n: { 'pt-br': PT_BR },
      controls,
      layers: [
        { name: 'xf-topbar', html: topbarEl },
        { name: 'xf-next', html: nextEl },
        { name: 'xf-menu', html: menuEl },
      ],
    });
  }

  function attachHls(Hls, video, url, a) {
    if (Hls.isSupported()) {
      a.hls?.destroy();
      const hls = new Hls({ enableWorker: true });
      hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) a.emit('error', data); });
      hls.loadSource(url);
      hls.attachMedia(video);
      a.hls = hls;
      a.on('destroy', () => hls.destroy());
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
    } else {
      a.notice.show = 'Formato não suportado pelo navegador';
    }
  }

  function bind(a, i, resumeAt) {
    lastSave = 0;
    a.on('dblclick', () => { if (!a.constructor.utils?.isMobile) toggleFullscreen(); });
    const watchdog = setTimeout(() => {
      if (a !== art || a.video?.readyState >= 2) return;
      console.warn('Fonte sem vídeo após', START_TIMEOUT_MS / 1000, 's');
      fail();
    }, START_TIMEOUT_MS);
    a.on('video:loadeddata', () => clearTimeout(watchdog));
    a.on('destroy', () => clearTimeout(watchdog));
    a.on('ready', () => {
      statuses[i] = 'ok';
      if (resumeAt > 5 && req?.type !== 'live') {
        a.seek = resumeAt;
        a.notice.show = `Retomando de ${clock(resumeAt)}`;
      }
    });
    a.on('video:timeupdate', () => {
      cur = a.currentTime || 0;
      dur = isFinite(a.duration) ? a.duration : 0;
      if (Date.now() - lastSave > SAVE_EVERY_MS) save(false);
    });
    a.on('video:pause', () => save(false));
    a.on('video:ended', () => {
      save(true);
      if (req?.queue?.hasNext && settings.autoNext && !nextDismissed) req.queue.next();
    });
    a.on('error', (err) => {
      console.warn('Erro de reprodução:', err);
      if (a === art) fail();
    });
  }

  function save(finished) {
    if (!art || !req?.onProgress) return;
    const d = art.duration;
    if (!d || !isFinite(d)) return;
    lastSave = Date.now();
    req.onProgress({ currentTime: finished ? d : art.currentTime || 0, duration: d, finished });
  }

  function destroyArt() {
    if (!art) return;
    park?.append(topbarEl, nextEl, menuEl); // devolve os layers antes de destruir
    try { art.destroy(true); } catch { /* já destruído */ }
    art = null;
  }

  // ─── Ações ────────────────────────────────────────────────────────────────
  function skipIntro() {
    if (!art) return;
    art.seek = Math.min((art.currentTime || 0) + SKIP_INTRO_SECS, Math.max(0, (art.duration || 0) - 1));
    art.notice.show = 'Avançou 1:30';
  }

  async function currentUrl() {
    let url = resolved[index] || source?.url;
    if (!url && source?.resolve) {
      try {
        url = await source.resolve();
        resolved[index] = url;
      } catch (err) {
        console.warn('Erro ao obter URL do stream:', err);
      }
    }
    return url;
  }

  async function copyLink() {
    const url = await currentUrl();
    if (!url) {
      toast('URL do stream indisponível.');
      return;
    }
    copyText(url, 'Link copiado!');
  }

  async function openExternal() {
    const url = await currentUrl();
    if (url) {
      window.open(url, '_blank', 'noopener');
    } else {
      toast('URL do stream indisponível.');
    }
  }

  function onKeydown(e) {
    if (!req) return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'Escape') {
      if (menuOpen) { menuOpen = false; return; }
      if (!isFs && !art?.fullscreen) { e.preventDefault(); close(); }
    } else if (e.key === 'f' || e.key === 'F') {
      toggleFullscreen();
    } else if (e.key === 's' || e.key === 'S') {
      if (isSeries && settings.skipIntro) skipIntro();
    } else if (e.key === 'n' || e.key === 'N') {
      if (req.queue?.hasNext) req.queue.next();
    } else if (e.key === 'p' || e.key === 'P') {
      if (req.queue?.hasPrev) req.queue.prev();
    }
  }

  onDestroy(destroyArt);
</script>

<svelte:window onkeydown={onKeydown} />

<!-- Layers do ArtPlayer: ficam aqui escondidos até serem anexados à instância -->
<div bind:this={park} hidden>
  <div bind:this={topbarEl} class="xf-topbar">
    <button class="tb-back" onclick={close} aria-label="Fechar player (Esc)" title="Fechar (Esc)">
      <Icon name="back" size={20} stroke={2.4} />
    </button>
    <div class="tb-text">
      <strong>{req?.title ?? ''}</strong>
      {#if req?.subtitle}<span>{req.subtitle}</span>{/if}
    </div>
    <div class="tb-actions">
      <button class="tb-btn" onclick={copyLink} aria-label="Copiar link" title="Copiar link do stream">
        <Icon name="copy" size={17} />
      </button>
      <button class="tb-btn" onclick={openExternal} aria-label="Abrir em nova aba" title="Abrir em nova aba / player externo">
        <Icon name="external" size={17} />
      </button>
    </div>
  </div>

  <div bind:this={nextEl} class="xf-next" class:visible={showNext}>
    {#if showNext}
      <span class="nx-label">
        {settings.autoNext ? `Próximo episódio em ${Math.max(0, Math.ceil(dur - cur))}s` : 'Próximo episódio'}
      </span>
      <strong class="nx-title">{req.queue.nextLabel}</strong>
      <div class="nx-actions">
        <button class="btn btn-primary" onclick={() => req.queue.next()}>Assistir agora</button>
        <button class="btn" onclick={() => (nextDismissed = true)}>Cancelar</button>
      </div>
    {/if}
  </div>

  <div bind:this={menuEl} class="xf-menu" class:visible={menuOpen}>
    {#if menuOpen && req}
      <span class="mn-head">Fontes disponíveis</span>
      {#each req.sources as src, i (i)}
        <button class="mn-item" class:active={i === index} onclick={() => switchSource(i)}>
          <span class="dot {statuses[i]}"></span>
          <span class="mn-text">
            <strong>{src.name}</strong>
            <small class="mono">{src.host}</small>
          </span>
          {#if i === index && statuses[i] === 'ok'}<span class="mn-badge">▶ Ativa</span>
          {:else if statuses[i] === 'failed'}<span class="mn-badge err">Falhou</span>{/if}
        </button>
      {/each}
    {/if}
  </div>
</div>

{#if req}
  <div class="player" bind:this={playerEl} role="dialog" aria-modal="true" aria-label="Player: {req.title}">
    <div class="host" bind:this={host}></div>

    {#if allFailed}
      <div class="failed">
        <Icon name="alert" size={40} stroke={1.6} />
        <h2>Nenhuma fonte respondeu</h2>
        <p>
          {req.sources.length > 1 ? `As ${req.sources.length} fontes foram testadas sem sucesso.` : 'O servidor não respondeu.'}
          Alguns formatos (ex.: MKV/AC3) não tocam no navegador — tente abrir no VLC.
        </p>
        <div class="failed-actions">
          <button class="btn btn-primary" onclick={retryAll}><Icon name="sync" size={15} /> Tentar novamente</button>
          <button class="btn" onclick={openExternal}><Icon name="external" size={15} /> Abrir no player externo</button>
          <button class="btn" onclick={copyLink}><Icon name="copy" size={15} /> Copiar link</button>
          <button class="btn btn-ghost" onclick={close}>Fechar</button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .player { position: fixed; inset: 0; z-index: 100; background: #000; }
  .host { width: 100%; height: 100%; }

  /* ── Controles customizados na barra do ArtPlayer ── */
  :global(.xf-ctl) {
    display: inline-flex; align-items: center; gap: 6px;
    height: 30px; padding: 0 10px; margin: 0 2px;
    border-radius: 7px; border: 1px solid rgba(255, 255, 255, 0.22);
    background: rgba(255, 255, 255, 0.08);
    font-size: 12.5px; font-weight: 600; color: #fff; white-space: nowrap;
  }
  :global(.xf-ctl small) { font-family: 'JetBrains Mono', monospace; font-size: 11px; opacity: 0.75; }
  :global(.xf-ctl:hover) { background: rgba(255, 255, 255, 0.18); }
  :global(.xf-ctl.is-disabled) { opacity: 0.35; }

  /* ── Barra superior (some junto com os controles) ── */
  .xf-topbar {
    position: absolute; top: 0; left: 0; right: 0;
    display: flex; align-items: center; gap: 14px;
    padding: 18px 24px 40px;
    background: linear-gradient(rgba(0, 0, 0, 0.75), transparent);
    color: #fff; pointer-events: none;
    transition: opacity .25s;
  }
  :global(.art-video-player.art-hide-cursor) .xf-topbar { opacity: 0; }
  .tb-back {
    pointer-events: auto;
    width: 40px; height: 40px; border-radius: 50%; border: none;
    background: rgba(255, 255, 255, 0.12); color: #fff;
    display: flex; align-items: center; justify-content: center;
  }
  .tb-back:hover { background: rgba(255, 255, 255, 0.24); }
  .tb-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .tb-text strong { font-size: 16px; }
  .tb-text span { font-size: 13px; color: #c3c9d1; }
  .tb-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; pointer-events: auto; }
  .tb-btn {
    width: 36px; height: 36px; border-radius: 50%; border: none;
    background: rgba(255, 255, 255, 0.12); color: #fff;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; transition: background .15s;
  }
  .tb-btn:hover { background: rgba(255, 255, 255, 0.24); }

  /* ── Card "Próximo episódio" ── */
  .xf-next {
    display: none;
    position: absolute; right: 28px; bottom: 76px; width: 340px;
    padding: 16px; border-radius: 14px;
    background: rgba(20, 22, 27, 0.94); border: 1px solid #2c323b; color: #e8eaed;
    flex-direction: column; gap: 10px;
    --primary-bg: #e8eaed; --primary-fg: #0b0d10;
    --surface-2: #1a1e25; --border-strong: #3a414c; --hover: #262b33; --text: #e8eaed;
  }
  .xf-next.visible { display: flex; }
  .nx-label { font-size: 12px; font-weight: 700; color: #9ec2ff; text-transform: uppercase; letter-spacing: 0.06em; }
  .nx-title { font-size: 15px; }
  .nx-actions { display: flex; gap: 8px; }
  .nx-actions .btn-primary { flex: 1; }

  /* ── Menu de fontes ── */
  .xf-menu {
    display: none;
    position: absolute; right: 16px; bottom: 64px; width: 320px;
    padding: 8px; border-radius: 12px;
    background: #14171c; border: 1px solid #2c323b; color: #e8eaed;
    flex-direction: column; gap: 2px;
  }
  .xf-menu.visible { display: flex; }
  .mn-head { font-size: 11px; font-weight: 700; color: #9aa3ad; text-transform: uppercase; letter-spacing: 0.06em; padding: 6px 10px; }
  .mn-item {
    display: flex; align-items: center; gap: 10px; padding: 9px 10px;
    border: none; border-radius: 8px; background: transparent; color: inherit; text-align: left;
  }
  .mn-item:hover, .mn-item.active { background: #1f242c; }
  .mn-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .mn-text strong { font-size: 13px; }
  .mn-text small { font-size: 11.5px; color: #9aa3ad; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: #5a616c; }
  .dot.ok { background: #3ddc97; }
  .dot.failed { background: #ff6b6b; }
  .mn-badge { font-size: 11px; font-weight: 700; color: #9ec2ff; }
  .mn-badge.err { color: #ff8a8a; }

  /* ── Todas as fontes falharam ── */
  .failed {
    position: absolute; inset: 0; z-index: 10;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
    padding: 32px; text-align: center;
    background: rgba(5, 6, 8, 0.94); color: #e8eaed;
    --primary-bg: #e8eaed; --primary-fg: #0b0d10;
    --surface-2: #1a1e25; --border-strong: #3a414c; --hover: #262b33; --text: #e8eaed;
    --surface-3: #1a1e25; --muted: #9aa3ad;
  }
  .failed :global(svg) { color: #f5b04a; }
  .failed h2 { font-size: 20px; }
  .failed p { max-width: 520px; color: #c3c9d1; line-height: 1.55; }
  .failed-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 8px; }
</style>
