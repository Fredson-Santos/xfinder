/**
 * Tudo que é "do usuário" e fica no navegador: progresso de reprodução,
 * episódios vistos, favoritos e o histórico "Continuar assistindo".
 *
 * Os prefixos de chave são os mesmos da versão anterior do painel; dados
 * antigos (indexados pelo ID do servidor) continuam sendo lidos.
 */
import { readJSON, writeJSON, readRaw, writeRaw } from './storage.js';
import { itemKey } from './streams.js';

/** Percentual a partir do qual um episódio/filme conta como visto. */
export const WATCHED_PCT = 90;

/** Incrementado a cada escrita: componentes leem `library.version` para reagir. */
export const library = $state({
  version: 0,
  favorites: readJSON('xf_favorites', []),
  recents: readJSON('xf_recents', []),
});

const bump = () => { library.version++; };

// ─── Identificadores (novo + legado) ────────────────────────────────────────

const progressId = (item) => itemKey(item).replace(/-/g, '_');

/** IDs usados pela versão anterior, para não perder o histórico existente. */
function legacyIds(item, style) {
  const raw = [item.external_id, ...(item.servers || []).map((s) => s.series_id), item.title].filter(Boolean);
  return [...new Set(raw.map((v) => (style === 'watched'
    ? String(v).replace(/\W+/g, '_').toLowerCase()
    : String(v).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'))))];
}

function readFirst(keys) {
  for (const k of keys) {
    const v = readJSON(k);
    if (v) return v;
  }
  return null;
}

// ─── Episódios vistos ───────────────────────────────────────────────────────

const watchedKeys = (item, s, e) =>
  [progressId(item), ...legacyIds(item, 'watched')].map((id) => `xw_${id}_s${s}_e${e}`);

export function isWatched(item, s, e) {
  return watchedKeys(item, s, e).some((k) => readRaw(k) === '1');
}

/** Marca/desmarca vários episódios de uma vez: [{season, episode}] */
export function setWatched(item, episodes, value) {
  for (const { season, episode } of episodes) {
    const [key, ...legacy] = watchedKeys(item, season, episode);
    writeRaw(key, value ? '1' : null);
    if (!value) legacy.forEach((k) => writeRaw(k, null));
  }
  bump();
}

// ─── Progresso ──────────────────────────────────────────────────────────────

const epKeys = (item, s, e) =>
  [progressId(item), ...legacyIds(item)].map((id) => `xf_ep_prog_${id}_s${s}_e${e}`);

/** @returns {{currentTime:number, duration:number, progressPct:number}|null} */
export const getEpisodeProgress = (item, s, e) => readFirst(epKeys(item, s, e));

/** Último episódio tocado da série: {season, episode, ...} */
export const getSeriesProgress = (item) =>
  readFirst([progressId(item), ...legacyIds(item)].map((id) => `xf_series_prog_${id}`));

export const getMediaProgress = (item) =>
  readFirst([progressId(item), ...legacyIds(item)].map((id) => `xf_media_prog_${id}`));

const pct = (cur, dur) => (dur > 0 ? Math.min(100, Math.round((cur / dur) * 100)) : 0);

/** Salva o ponto atual de um episódio e atualiza "Continuar assistindo". */
export function saveEpisodeProgress(item, { season, episode, title, currentTime, duration, finished }) {
  const progressPct = finished ? 100 : pct(currentTime, duration);
  const id = progressId(item);
  const data = { currentTime, duration, progressPct, updatedAt: Date.now() };
  writeJSON(`xf_ep_prog_${id}_s${season}_e${episode}`, data);
  writeJSON(`xf_series_prog_${id}`, { season, episode, epTitle: title, ...data });
  if (progressPct >= WATCHED_PCT) writeRaw(`xw_${id}_s${season}_e${episode}`, '1');

  recordRecent(item, {
    season, episode, epTitle: title, progressPct,
    remaining: Math.max(0, duration - currentTime),
  });
}

export function saveMediaProgress(item, { currentTime, duration, finished }) {
  const live = item.type === 'live';
  const progressPct = live ? 0 : (finished ? 100 : pct(currentTime, duration));
  writeJSON(`xf_media_prog_${progressId(item)}`, { currentTime, duration, progressPct, updatedAt: Date.now() });
  recordRecent(item, { progressPct, remaining: live ? 0 : Math.max(0, duration - currentTime) });
}

// ─── Favoritos ──────────────────────────────────────────────────────────────

const snapshot = (item) => ({
  key: item.key || itemKey(item),
  title: item.title,
  type: item.type,
  year: item.year ?? null,
  cover_url: item.cover_url ?? null,
  servers: item.servers || [],
});

const sameItem = (a, b) => (a.key || itemKey(a)) === (b.key || itemKey(b));

export const isFavorite = (item) => library.favorites.some((f) => sameItem(f, item));

export function toggleFavorite(item) {
  const on = !isFavorite(item);
  library.favorites = on
    ? [{ ...snapshot(item), added_at: Date.now() }, ...library.favorites]
    : library.favorites.filter((f) => !sameItem(f, item));
  writeJSON('xf_favorites', library.favorites);
  return on;
}

// ─── Continuar assistindo ───────────────────────────────────────────────────

const MAX_RECENTS = 24;

export function recordRecent(item, extra = {}) {
  const entry = { ...snapshot(item), ...extra, watched_at: Date.now() };
  library.recents = [entry, ...library.recents.filter((r) => !sameItem(r, item))].slice(0, MAX_RECENTS);
  writeJSON('xf_recents', library.recents);
  bump();
}

export function removeRecent(item) {
  library.recents = library.recents.filter((r) => !sameItem(r, item));
  writeJSON('xf_recents', library.recents);
}

export function clearRecents() {
  library.recents = [];
  writeJSON('xf_recents', []);
}
