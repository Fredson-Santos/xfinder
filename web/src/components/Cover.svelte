<script>
  /**
   * Capa com fallback: sem imagem (ou com erro ao carregar) mostra um bloco
   * colorido com o título — a cor é derivada do título, então é estável.
   */
  let { src = null, title = '', ratio = '2 / 3', fontSize = 16 } = $props();
  let failed = $state(false);

  let hue = $derived([...title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
  $effect(() => { src; failed = false; });
</script>

<div class="cover" style:aspect-ratio={ratio} style:--hue={hue}>
  {#if src && !failed}
    <img {src} alt="" loading="lazy" decoding="async" onerror={() => (failed = true)} />
  {:else}
    <span class="fallback" style:font-size="{fontSize}px">{title}</span>
  {/if}
</div>

<style>
  .cover {
    position: relative; width: 100%; overflow: hidden;
    border-radius: inherit;
    background: hsl(var(--hue) 22% 24%);
    display: flex; align-items: flex-end;
  }
  :global([data-theme='light']) .cover { background: hsl(var(--hue) 28% 78%); }
  img { width: 100%; height: 100%; object-fit: cover; }
  .fallback {
    padding: 14px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.15;
    color: rgba(255, 255, 255, 0.9);
    display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
  }
  :global([data-theme='light']) .fallback { color: rgba(15, 18, 24, 0.82); }
</style>
