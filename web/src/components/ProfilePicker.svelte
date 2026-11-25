<script>
  import { onMount } from 'svelte';
  import {
    profiles, AVATARS, MAX_PROFILES, avatarGradient,
    loadProfiles, chooseProfile, saveProfile, removeProfile,
  } from '../lib/profiles.svelte.js';
  import Icon from './Icon.svelte';

  let manage = $state(false);
  /** Perfil em edição ({id:null} = novo). */
  let editing = $state(null);
  let name = $state('');
  let avatar = $state('0');
  let busy = $state(false);
  let formError = $state('');
  let confirmDelete = $state(false);
  let dialog;

  onMount(loadProfiles);

  $effect(() => {
    if (!dialog) return;
    if (editing && !dialog.open) dialog.showModal();
    if (!editing && dialog.open) dialog.close();
  });

  function edit(p) {
    editing = p ?? { id: null };
    name = p?.name ?? '';
    avatar = p?.avatar || String(profiles.list.length % AVATARS.length);
    formError = '';
    confirmDelete = false;
  }

  function pick(p) {
    if (manage) edit(p);
    else chooseProfile(p);
  }

  async function save() {
    const n = name.trim();
    if (!n) { formError = 'Digite um nome.'; return; }
    busy = true;
    try {
      await saveProfile({ id: editing.id, name: n, avatar });
      editing = null;
    } catch (err) {
      formError = `Não foi possível salvar (${err.message}).`;
    }
    busy = false;
  }

  async function del() {
    if (!confirmDelete) { confirmDelete = true; return; }
    busy = true;
    try {
      await removeProfile(editing.id);
      editing = null;
    } catch (err) {
      formError = `Não foi possível excluir (${err.message}).`;
    }
    busy = false;
  }
</script>

<main class="picker">
  <h1>{manage ? 'Gerenciar perfis' : 'Quem está assistindo?'}</h1>

  <div class="grid">
    {#each profiles.list as p (p.id)}
      <button class="tile" onclick={() => pick(p)}>
        <span class="avatar" style="background: {avatarGradient(p.avatar)}">
          {p.name.trim().slice(0, 1).toUpperCase() || '?'}
          {#if manage}<span class="edit-badge"><Icon name="edit" size={20} /></span>{/if}
        </span>
        <span class="name">{p.name}</span>
      </button>
    {/each}

    {#if profiles.list.length < MAX_PROFILES && (!profiles.loading || profiles.list.length)}
      <button class="tile" onclick={() => edit(null)}>
        <span class="avatar add"><Icon name="plus" size={52} /></span>
        <span class="name">Adicionar perfil</span>
      </button>
    {/if}
  </div>

  {#if profiles.loading && !profiles.list.length}
    <p class="hint">Carregando…</p>
  {:else if profiles.error}
    <p class="hint warn">{profiles.error}</p>
    <button class="btn" onclick={loadProfiles}>Tentar de novo</button>
  {/if}

  {#if profiles.list.length}
    <button class="btn btn-lg manage" onclick={() => (manage = !manage)}>
      {manage ? 'Concluído' : 'Gerenciar perfis'}
    </button>
  {/if}
</main>

<dialog bind:this={dialog} oncancel={(e) => { e.preventDefault(); editing = null; }} aria-labelledby="profile-title">
  <h2 id="profile-title">{editing?.id ? 'Editar perfil' : 'Novo perfil'}</h2>
  <div class="preview">
    <span class="avatar sm" style="background: {avatarGradient(avatar)}">{name.trim().slice(0, 1).toUpperCase() || '?'}</span>
    <label class="field grow">
      Nome
      <input class="input" bind:value={name} maxlength="24" placeholder="Nome do perfil"
             onkeydown={(e) => e.key === 'Enter' && save()} />
    </label>
  </div>
  <div class="swatches" role="radiogroup" aria-label="Cor do avatar">
    {#each AVATARS as _, i}
      <button class="swatch" class:on={avatar === String(i)} style="background: {avatarGradient(String(i))}"
              role="radio" aria-checked={avatar === String(i)} aria-label="Cor {i + 1}"
              onclick={() => (avatar = String(i))}></button>
    {/each}
  </div>
  {#if formError}<p class="err">{formError}</p>{/if}
  {#if confirmDelete}<p class="err">Isto apaga os favoritos e o histórico deste perfil. Clique de novo para confirmar.</p>{/if}
  <div class="actions">
    {#if editing?.id}
      <button class="btn btn-danger" disabled={busy} onclick={del}>{confirmDelete ? 'Confirmar exclusão' : 'Excluir'}</button>
    {/if}
    <span class="grow"></span>
    <button class="btn" disabled={busy} onclick={() => (editing = null)}>Cancelar</button>
    <button class="btn btn-primary" disabled={busy} onclick={save}>{busy ? 'Aguarde…' : 'Salvar'}</button>
  </div>
</dialog>

<style>
  .picker {
    min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 36px; padding: 40px 24px; text-align: center;
  }
  h1 { font-size: clamp(26px, 4vw, 40px); font-weight: 700; }
  .grid { display: flex; flex-wrap: wrap; justify-content: center; gap: 28px; max-width: 980px; }
  .tile {
    display: flex; flex-direction: column; align-items: center; gap: 12px; width: 140px;
    background: none; border: 0; padding: 0; color: var(--muted);
  }
  .avatar {
    position: relative; display: grid; place-items: center; width: 128px; height: 128px; border-radius: 50%;
    color: #fff; font-size: 56px; font-weight: 700; border: 3px solid transparent; transition: transform 0.15s, border-color 0.15s;
  }
  .avatar.sm { width: 64px; height: 64px; font-size: 28px; flex: none; }
  .avatar.add { background: var(--surface-3); color: var(--muted); }
  .tile:hover .avatar, .tile:focus-visible .avatar { border-color: var(--text); transform: scale(1.06); }
  .tile:hover, .tile:focus-visible { color: var(--text); outline: none; }
  .name { font-size: 16px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .edit-badge {
    position: absolute; right: -2px; bottom: -2px; width: 38px; height: 38px; border-radius: 50%;
    display: grid; place-items: center; background: rgba(0, 0, 0, 0.75); color: #fff;
  }
  .hint { color: var(--muted); font-size: 14px; }
  .hint.warn { color: var(--warn); }
  .manage { margin-top: 4px; }

  dialog {
    width: 460px; max-width: calc(100vw - 32px); padding: 24px; border-radius: 14px;
    border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); box-shadow: var(--shadow);
  }
  dialog::backdrop { background: var(--overlay); }
  h2 { font-size: 18px; font-weight: 700; margin-bottom: 18px; }
  .preview { display: flex; align-items: flex-end; gap: 16px; }
  .grow { flex: 1; }
  .swatches { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
  .swatch { width: 36px; height: 36px; border-radius: 50%; border: 3px solid transparent; padding: 0; }
  .swatch.on { border-color: var(--text); }
  .err { margin-top: 14px; font-size: 13px; color: var(--danger-text); }
  .actions { display: flex; align-items: center; gap: 10px; margin-top: 22px; }
</style>
