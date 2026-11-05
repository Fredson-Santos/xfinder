<script>
  /** Diálogo de confirmação modal (usa <dialog> nativo: foco e ESC de graça). */
  let { open = false, title, message = '', confirmLabel = 'Confirmar', danger = false, onconfirm, oncancel } = $props();
  let dialog;

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<dialog bind:this={dialog} oncancel={(e) => { e.preventDefault(); oncancel?.(); }} aria-labelledby="confirm-title">
  <h2 id="confirm-title">{title}</h2>
  {#if message}<p>{message}</p>{/if}
  <div class="actions">
    <button class="btn" onclick={() => oncancel?.()}>Cancelar</button>
    <button class="btn {danger ? 'btn-danger-solid' : 'btn-primary'}" onclick={() => onconfirm?.()}>{confirmLabel}</button>
  </div>
</dialog>

<style>
  dialog {
    width: 440px; max-width: calc(100vw - 32px);
    padding: 24px; border-radius: 14px;
    border: 1px solid var(--border-strong);
    background: var(--surface); color: var(--text);
    box-shadow: var(--shadow);
  }
  dialog::backdrop { background: var(--overlay); }
  h2 { font-size: 18px; font-weight: 700; margin-bottom: 10px; }
  p { font-size: 14px; line-height: 1.55; color: var(--text-2); }
  .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; }
</style>
