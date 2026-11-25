/**
 * localStorage sempre protegido: modo privado / cota cheia não quebram a interface.
 *
 * Os dados do usuário (favoritos, continuar assistindo, progresso, ajustes) são
 * POR PERFIL e sincronizados com o servidor: no localStorage ficam como cache
 * (`xfp<id>:<chave>`); cada escrita marca a chave como "suja" e, passados
 * alguns segundos, é enviada a /api/profiles/<id>/data. Offline, as chaves
 * continuam sujas e são enviadas depois. Chaves que não são do usuário
 * (tema, cache de títulos) seguem locais ao navegador.
 */
import { api } from './api.js';

// Formato compartilhado com o app de TV: fav:<id>, cw:<id>, p:<id>|<t>|<e>, set:<nome>.
// As chaves xf_* / xw_* são do formato antigo da web (migradas em library.svelte.js).
const SYNCED = [/^fav:/, /^cw:/, /^p:/, /^set:/, /^xf_favorites$/, /^xf_recents$/, /^xf_settings$/, /^xf_ep_prog_/, /^xf_series_prog_/, /^xf_media_prog_/, /^xw_/];
const isSyncedKey = (k) => SYNCED.some((re) => re.test(k));

let profileId = null;
const listeners = new Set();

/** Chamado quando o perfil muda ou chegam dados novos do servidor. */
export function onProfileData(fn) {
  listeners.add(fn);
}
const notify = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.warn(e); } });

const prefix = (id = profileId) => `xfp${id}:`;
const lk = (k) => (profileId != null && isSyncedKey(k) ? prefix() + k : k);

const rawGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const rawSet = (k, v) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch (err) { console.warn('localStorage indisponível:', err); }
};
const readSet = (id, name) => {
  try { return new Set(JSON.parse(rawGet(prefix(id) + name) || '[]')); } catch { return new Set(); }
};
const writeSet = (id, name, set) => rawSet(prefix(id) + name, JSON.stringify([...set]));

// ─── Sincronização ──────────────────────────────────────────────────────────

let timer = null;

function markDirty(key, deleted) {
  const id = profileId;
  const dirty = readSet(id, '_dirty');
  const del = readSet(id, '_del');
  if (deleted) { dirty.delete(key); del.add(key); } else { dirty.add(key); del.delete(key); }
  writeSet(id, '_dirty', dirty);
  writeSet(id, '_del', del);
  scheduleFlush();
}

function scheduleFlush(delay = 3000) {
  if (timer || profileId == null) return;
  timer = setTimeout(async () => {
    timer = null;
    if (!(await flush())) scheduleFlush(30000);
  }, delay);
}

/** Envia ao servidor as chaves sujas do perfil atual. true = nada pendente/enviado. */
export async function flush(id = profileId) {
  if (id == null) return true;
  const dirty = readSet(id, '_dirty');
  const del = readSet(id, '_del');
  if (!dirty.size && !del.size) return true;
  const set = {};
  for (const k of dirty) {
    const v = rawGet(prefix(id) + k);
    if (v != null) set[k] = v;
  }
  try {
    await api.pushProfileData(id, set, [...del]);
  } catch {
    return false;
  }
  // só limpa o que não mudou durante o envio
  const d2 = readSet(id, '_dirty');
  const x2 = readSet(id, '_del');
  for (const k of Object.keys(set)) if (rawGet(prefix(id) + k) === set[k]) d2.delete(k);
  for (const k of del) if (rawGet(prefix(id) + k) == null) x2.delete(k);
  writeSet(id, '_dirty', d2);
  writeSet(id, '_del', x2);
  return true;
}

/** Baixa os dados do perfil; o que está pendente de envio tem prioridade. */
async function pull(id) {
  let data;
  try { data = await api.profileData(id); } catch { return; }
  if (id !== profileId) return;
  const dirty = readSet(id, '_dirty');
  const del = readSet(id, '_del');
  const p = prefix(id);
  const local = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(p) && !k.startsWith(p + '_')) local.push(k.slice(p.length));
  }
  for (const k of local) if (!(k in data) && !dirty.has(k)) rawSet(p + k, null);
  for (const [k, v] of Object.entries(data)) if (!dirty.has(k) && !del.has(k)) rawSet(p + k, v);
  notify();
}

/** Há um perfil ativo? (sem ele, nada do usuário deve ser lido nem gravado) */
export const hasProfile = () => profileId != null;

/** Chaves do perfil atual que começam com [pref] (sem o prefixo interno do perfil). */
export function listKeys(pref) {
  if (profileId == null) return [];
  const p = prefix() + pref;
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(p)) out.push(k.slice(prefix().length));
  }
  return out;
}

/** Troca o perfil ativo (null = nenhum): recarrega do cache e sincroniza em segundo plano. */
export async function setActiveProfile(id) {
  const previous = profileId;
  if (previous != null && previous !== id) await flush(previous);
  profileId = id;
  notify();
  if (id != null) {
    await flush(id);
    await pull(id);
  }
}

/** Há dados da versão sem perfis (chaves sem prefixo) para importar? */
export function hasLegacyLocal() {
  for (let i = 0; i < localStorage.length; i++) if (isSyncedKey(localStorage.key(i))) return true;
  return false;
}

/** Move os dados da versão sem perfis para o perfil [id] e marca para envio. */
export async function importLegacyLocal(id) {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (isSyncedKey(k)) keys.push(k);
  }
  const dirty = readSet(id, '_dirty');
  for (const k of keys) {
    rawSet(prefix(id) + k, rawGet(k));
    dirty.add(k);
    rawSet(k, null);
  }
  writeSet(id, '_dirty', dirty);
  await flush(id);
}

/** Apaga o cache local de um perfil excluído. */
export function forgetLocalProfile(id) {
  const p = prefix(id);
  const drop = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(p)) drop.push(k);
  }
  drop.forEach((k) => rawSet(k, null));
}

// Ao fechar/esconder a aba, tenta enviar o que ficou pendente.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (timer) { clearTimeout(timer); timer = null; }
      flush();
    }
  });
}

// ─── Leitura e escrita ──────────────────────────────────────────────────────

export function readJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(lk(key));
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(key, value) {
  writeRaw(key, JSON.stringify(value));
}

export function readRaw(key) {
  return rawGet(lk(key));
}

export function writeRaw(key, value) {
  rawSet(lk(key), value);
  if (profileId != null && isSyncedKey(key)) markDirty(key, value == null);
}
