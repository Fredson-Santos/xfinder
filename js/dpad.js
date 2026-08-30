/**
 * XFinder — D-Pad / Remote Control Navigation
 *
 * Spatial navigation robusto por teclas de seta.
 * Otimizado para Smart TVs, controles remotos, gamepads e teclados.
 *
 * Algoritmo:
 *   1. Filtra elementos focáveis visíveis na tela ativa/modal.
 *   2. Identifica os candidatos na direção desejada (Up/Down/Left/Right).
 *   3. Aplica agrupamento em faixas visuais (bands) para respeitar a estrutura
 *      de linhas/colunas, impedindo saltos acidentais sobre seções inteiras.
 *   4. Calcula a pontuação com base em distância de bordas (edge-to-edge)
 *      e sobreposição ortogonal (mesma linha/coluna tem penalidade zero).
 */
(function () {
  'use strict';

  // ─── Estado ────────────────────────────────────────────────────────────────

  // Lê estado persistido; padrão = ativado
  let _enabled = localStorage.getItem('dpad_enabled') !== 'false';

  function syncButton() {
    const btn = document.getElementById('btnDpad');
    if (!btn) return;
    btn.classList.toggle('active', _enabled);
    btn.setAttribute('aria-pressed', _enabled ? 'true' : 'false');
    btn.title = _enabled ? 'Modo D-Pad ativado' : 'Modo D-Pad desativado';
  }

  /** Alterna o modo D-Pad e persiste a escolha. Chamado pelo botão na topline. */
  window.toggleDpad = function () {
    _enabled = !_enabled;
    localStorage.setItem('dpad_enabled', _enabled ? 'true' : 'false');
    syncButton();
  };

  const SEL = [
    'button:not([disabled]):not([tabindex="-1"])',
    'input:not([disabled]):not([tabindex="-1"])',
    'a[href]:not([tabindex="-1"])',
    '.fx[tabindex="0"]',
    '.home-card[tabindex="0"]',
  ].join(', ');

  // Fator de penalidade do eixo secundário (quando não há sobreposição)
  const SECONDARY_WEIGHT = 1.5;

  // Tolerância para agrupamento na próxima linha/coluna (evita pular seções)
  const BAND_TOLERANCE = 80;

  // Mínimo de deslocamento para considerar na direção
  const MIN_OFFSET = 3;

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function activeScreen() {
    const choiceModal = document.getElementById('playChoiceModal');
    if (choiceModal && choiceModal.style.display !== 'none') {
      return choiceModal;
    }
    const modal = document.getElementById('playerModal');
    if (modal && modal.style.display !== 'none') {
      return modal;
    }
    return document.querySelector('.screen.active');
  }

  /** Retorna todos os elementos focáveis visíveis na tela ativa ou modal. */
  function focusables() {
    const container = activeScreen();
    if (!container) return [];
    return [...container.querySelectorAll(SEL)].filter(el => {
      // Exclui botão de remover do card (ele não deve roubar foco D-pad)
      if (el.classList.contains('home-card-remove-btn')) return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      return true;
    });
  }

  /** Retorna o bounding box com centros e dimensões. */
  function box(el) {
    const r = el.getBoundingClientRect();
    return {
      t: r.top,   b: r.bottom,
      l: r.left,  r: r.right,
      cx: (r.left + r.right) / 2,
      cy: (r.top  + r.bottom) / 2,
      w: r.width, h: r.height,
    };
  }

  /** Verifica se o candidato está na direção correta. */
  function inDirection(dir, from, to) {
    switch (dir) {
      case 'up':    return to.cy < from.cy - MIN_OFFSET && to.t < from.b;
      case 'down':  return to.cy > from.cy + MIN_OFFSET && to.b > from.t;
      case 'left':  return to.cx < from.cx - MIN_OFFSET && to.l < from.r;
      case 'right': return to.cx > from.cx + MIN_OFFSET && to.r > from.l;
    }
  }

  /**
   * Score de um candidato em relação ao elemento atual usando distância de bordas (edge-to-edge).
   * Se os elementos compartilham o eixo ortogonal (ex: mesma linha ou mesma coluna),
   * a distância ortogonal é 0.
   */
  function score(dir, from, to) {
    let primaryDist = 0;
    let secondaryDist = 0;

    switch (dir) {
      case 'down':
        primaryDist = to.t >= from.b ? (to.t - from.b) : Math.max(0, to.cy - from.cy);
        // Sobreposição no eixo X (mesma coluna / verticalmente alinhado)
        if (Math.max(from.l, to.l) < Math.min(from.r, to.r)) {
          secondaryDist = 0;
        } else {
          secondaryDist = to.l >= from.r ? (to.l - from.r) : (from.l - to.r);
        }
        break;

      case 'up':
        primaryDist = from.t >= to.b ? (from.t - to.b) : Math.max(0, from.cy - to.cy);
        if (Math.max(from.l, to.l) < Math.min(from.r, to.r)) {
          secondaryDist = 0;
        } else {
          secondaryDist = to.l >= from.r ? (to.l - from.r) : (from.l - to.r);
        }
        break;

      case 'right':
        primaryDist = to.l >= from.r ? (to.l - from.r) : Math.max(0, to.cx - from.cx);
        // Sobreposição no eixo Y (mesma linha)
        if (Math.max(from.t, to.t) < Math.min(from.b, to.b)) {
          secondaryDist = 0;
        } else {
          secondaryDist = to.t >= from.b ? (to.t - from.b) : (from.t - to.b);
        }
        break;

      case 'left':
        primaryDist = from.l >= to.r ? (from.l - to.r) : Math.max(0, from.cx - to.cx);
        if (Math.max(from.t, to.t) < Math.min(from.b, to.b)) {
          secondaryDist = 0;
        } else {
          secondaryDist = to.t >= from.b ? (to.t - from.b) : (from.t - to.b);
        }
        break;
    }

    return primaryDist + secondaryDist * SECONDARY_WEIGHT;
  }

  // ─── Core navigation ───────────────────────────────────────────────────────

  function navigate(dir) {
    const screen = activeScreen();
    if (!screen) return;

    const focused = document.activeElement;

    // Se não há elemento focado na tela ativa, foca o primeiro adequado
    if (!focused || !screen.contains(focused)) {
      focusFirst(screen);
      return;
    }

    const from = box(focused);

    let candidates = focusables().filter(el => {
      if (el === focused) return false;
      return inDirection(dir, from, box(el));
    });

    if (!candidates.length) return;

    // Agrupamento na faixa visual mais próxima para evitar "pular" linhas/colunas inteiras
    if (dir === 'down') {
      const minTop = Math.min(...candidates.map(el => box(el).t));
      const band = candidates.filter(el => box(el).t <= minTop + BAND_TOLERANCE);
      if (band.length) candidates = band;
    } else if (dir === 'up') {
      const maxBottom = Math.max(...candidates.map(el => box(el).b));
      const band = candidates.filter(el => box(el).b >= maxBottom - BAND_TOLERANCE);
      if (band.length) candidates = band;
    } else if (dir === 'right') {
      const minLeft = Math.min(...candidates.map(el => box(el).l));
      const band = candidates.filter(el => box(el).l <= minLeft + BAND_TOLERANCE);
      if (band.length) candidates = band;
    } else if (dir === 'left') {
      const maxRight = Math.max(...candidates.map(el => box(el).r));
      const band = candidates.filter(el => box(el).r >= maxRight - BAND_TOLERANCE);
      if (band.length) candidates = band;
    }

    // Escolhe o candidato com menor score dentro da faixa prioritária
    const best = candidates.reduce((prev, el) =>
      score(dir, from, box(el)) < score(dir, from, box(prev)) ? el : prev
    );

    best.focus({ preventScroll: true });
    best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  /** Foca o primeiro elemento adequado de uma tela. */
  function focusFirst(screen) {
    screen = screen || activeScreen();
    if (!screen) return;

    // Player modal: foca próximo episódio ou abrir externo
    if (screen.id === 'playerModal') {
      const nextBtn = screen.querySelector('#btnNextEpisode:not([disabled])');
      const extBtn = screen.querySelector('#btnExternalPlayer');
      const target = (nextBtn && nextBtn.style.display !== 'none' ? nextBtn : null) || extBtn || focusables()[0];
      if (target) {
        target.focus({ preventScroll: true });
        return;
      }
    }

    // Modal de escolha de reprodução:
    if (screen.id === 'playChoiceModal') {
      const firstChoice = screen.querySelector('.choice-card');
      if (firstChoice) {
        firstChoice.focus({ preventScroll: true });
        return;
      }
    }

    // Home: prioriza o campo de busca
    if (screen.id === 'screen-home') {
      const search = screen.querySelector('#searchInput');
      if (search) {
        search.focus({ preventScroll: true });
        return;
      }
    }

    // Séries ou Detalhe: prioriza o botão de play ("Continuar" ou "Reproduzir")
    if (screen.id === 'screen-series' || screen.id === 'screen-detail') {
      const playBtn = screen.querySelector('.hero-play-btn');
      if (playBtn) {
        playBtn.focus({ preventScroll: true });
        return;
      }
    }

    const list = focusables();
    if (list.length) {
      list[0].focus({ preventScroll: true });
      list[0].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  // ─── Auto-focus ao trocar de tela ──────────────────────────────────────────

  let _lastScreen = null;
  new MutationObserver(() => {
    const screen = activeScreen();
    if (!screen || screen === _lastScreen) return;
    _lastScreen = screen;
    setTimeout(() => {
      if (!screen.contains(document.activeElement)) focusFirst(screen);
    }, 180);
  }).observe(document.body, {
    attributes:      true,
    subtree:         true,
    attributeFilter: ['class', 'style'],
  });

  // ─── Keyboard handler ──────────────────────────────────────────────────────

  document.addEventListener('keydown', e => {
    // Modo D-Pad desativado: não intercepta teclas de navegação
    if (!_enabled) return;

    const focused  = document.activeElement;
    const isInput  = focused &&
      (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA');

    switch (e.key) {

      // ── Setas ──────────────────────────────────────────────────────────────
      case 'ArrowUp':
        e.preventDefault();
        navigate('up');
        break;

      case 'ArrowDown':
        e.preventDefault();
        navigate('down');
        break;

      case 'ArrowLeft':
        // Dentro de inputs: permite movimento de cursor do texto
        if (!isInput) { e.preventDefault(); navigate('left'); }
        break;

      case 'ArrowRight':
        if (!isInput) { e.preventDefault(); navigate('right'); }
        break;

      // ── OK / Enter ─────────────────────────────────────────────────────────
      case 'Enter':
        // Se for input de busca, deixa o app tratar
        if (!isInput && focused && focused !== document.body) {
          e.preventDefault();
          focused.click();
        }
        break;

      // ── Voltar (Backspace / Escape em TV remotes) ──────────────────────────
      case 'Backspace':
        if (!isInput) {
          e.preventDefault();
          const pModal = document.getElementById('playerModal');
          if (pModal && pModal.style.display !== 'none') {
            if (typeof window.closePlayer === 'function') {
              window.closePlayer();
              return;
            }
          }
          const choiceModal = document.getElementById('playChoiceModal');
          if (choiceModal && choiceModal.style.display !== 'none') {
            if (typeof window.closePlayChoice === 'function') {
              window.closePlayChoice();
              return;
            }
          }
          if (typeof window.goBack === 'function') window.goBack();
        }
        break;

      // ── Remover de favoritos/recentes via D-Pad (tecla Delete) ─────────────
      case 'Delete':
        if (focused && focused.classList.contains('home-card')) {
          e.preventDefault();
          const removeBtn = focused.querySelector('.home-card-remove-btn');
          if (removeBtn) removeBtn.click();
        }
        break;

      // ── Atalhos de Pular / Voltar Episódio no Player ───────────────────────
      case 'PageDown':
        {
          const pModal = document.getElementById('playerModal');
          if (pModal && pModal.style.display !== 'none') {
            e.preventDefault();
            if (typeof window.playNextEpisode === 'function') window.playNextEpisode();
          }
        }
        break;

      case 'PageUp':
        {
          const pModal = document.getElementById('playerModal');
          if (pModal && pModal.style.display !== 'none') {
            e.preventDefault();
            if (typeof window.playPrevEpisode === 'function') window.playPrevEpisode();
          }
        }
        break;

      // ── Home key ───────────────────────────────────────────────────────────
      case 'Home':
        if (!isInput) {
          e.preventDefault();
          const list = focusables();
          if (list.length) {
            list[0].focus({ preventScroll: false });
            list[0].scrollIntoView({ block: 'nearest', inline: 'nearest' });
          }
        }
        break;

      // ── End key ────────────────────────────────────────────────────────────
      case 'End':
        if (!isInput) {
          e.preventDefault();
          const list = focusables();
          if (list.length) {
            list[list.length - 1].focus({ preventScroll: false });
            list[list.length - 1].scrollIntoView({ block: 'nearest', inline: 'nearest' });
          }
        }
        break;
    }
  }, true /* capture phase */);

  // ─── Foco e estado inicial ─────────────────────────────────────────────────

  window.addEventListener('DOMContentLoaded', () => {
    syncButton();
    requestAnimationFrame(() => focusFirst());
  });

  window.dpadFocusFirst = focusFirst;

})();
