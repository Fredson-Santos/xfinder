/**
 * Perfis (estilo Netflix). A lista vem do servidor; o perfil escolhido vale
 * para a sessão da aba (F5 mantém, uma aba nova pergunta de novo).
 */
import { api } from './api.js';
import { readJSON, writeJSON } from './storage.js';
import {
  setActiveProfile, flush, hasLegacyLocal, importLegacyLocal, forgetLocalProfile,
} from './storage.js';

const SESSION_KEY = 'xf_profile_session';
const CACHE_KEY = 'xf_profiles_cache';

/** Cores dos avatares; o perfil guarda só o índice. */
export const AVATARS = [
  ['#4c8dff', '#2b5bd7'], ['#ff6b6b', '#c83a5a'], ['#3ddc97', '#1b9e78'], ['#f5b04a', '#d9772b'],
  ['#b57bff', '#7a4cd6'], ['#4dd0e1', '#2a8fa8'], ['#ff8ac4', '#d14e94'], ['#9aa3ad', '#5f6872'],
];
export const MAX_PROFILES = 8;

export const profiles = $state({
  list: readJSON(CACHE_KEY, []),
  current: null,
  loading: true,
  error: null,
});

export function avatarGradient(avatar) {
  const [a, b] = AVATARS[(parseInt(avatar, 10) || 0) % AVATARS.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

function remember(list) {
  profiles.list = list;
  writeJSON(CACHE_KEY, list);
}

function sessionId() {
  try { return Number(sessionStorage.getItem(SESSION_KEY)) || null; } catch { return null; }
}

export async function loadProfiles() {
  profiles.loading = true;
  try {
    remember(await api.listProfiles());
    profiles.error = null;
  } catch (err) {
    profiles.error = profiles.list.length
      ? 'Sem conexão com o servidor: mostrando os perfis salvos.'
      : `Não foi possível falar com o servidor (${err.message}).`;
  }
  profiles.loading = false;

  // F5 na mesma aba: volta direto ao perfil escolhido
  const saved = sessionId();
  if (saved && !profiles.current) {
    const p = profiles.list.find((x) => x.id === saved);
    if (p) chooseProfile(p);
  }
}

export function chooseProfile(p) {
  try { sessionStorage.setItem(SESSION_KEY, String(p.id)); } catch { /* ignora */ }
  profiles.current = p;
  setActiveProfile(p.id);
}

/** Volta para "Quem está assistindo?". */
export async function leaveProfile() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignora */ }
  await flush();
  profiles.current = null;
  setActiveProfile(null);
}

/** Cria (id vazio) ou atualiza um perfil. O 1º perfil herda os dados de antes dos perfis. */
export async function saveProfile({ id, name, avatar }) {
  if (id) {
    await api.updateProfile(id, name, avatar);
  } else {
    const first = profiles.list.length === 0;
    const created = await api.createProfile(name, avatar);
    if (first && hasLegacyLocal()) await importLegacyLocal(created.id);
  }
  await loadProfiles();
}

export async function removeProfile(id) {
  await api.deleteProfile(id);
  forgetLocalProfile(id);
  await loadProfiles();
}
