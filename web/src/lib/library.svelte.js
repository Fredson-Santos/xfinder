/**
 * Tudo que é "do usuário": progresso, episódios vistos, favoritos e "Continuar
 * assistindo". Fica no perfil (sincronizado com o servidor, ver storage.js) no
 * MESMO formato do app de TV, para os dois enxergarem os mesmos dados:
 *
 *   fav:<id>          favorito: {type, key, title, year, cover}
 *   cw:<id>           continuar: {series:{…}, season, num, ts, image}
 *   p:<id>|<t>|<e>    progresso: "posMs,durMs,visto(0|1),ts"  (filme: t=0, e=0)
 *
 * <id> é a identidade canônica do título (identity.js): "series:naruto".
 */
import { readJSON, writeJSON, readRaw, writeRaw, listKeys, hasProfile, onProfileData } from './storage.js';
import { itemKey } from './streams.js';
import { canonicalId } from './identity.js';

/** Percentual a partir do qual um episódio/filme conta como visto. */
export const WATCHED_PCT = 90;
const MAX_RECENTS = 24;

/** Incrementado a cada escrita: componentes leem `library.version` para reagir. */
export const library = $state({ version: 0, favorites: [], recents: [] });

const cid = (item) => canonicalId(item);
const pKey = (id, s, e) => `p:${id}|${s}|${e}`;

// ─── Leitura ────────────────────────────────────────────────────────────────

function toItem(snap, id) {
  return {
    key: id,
    title: snap.title,
    type: snap.type || id.split(':')[0],
    year: snap.year ?? null,
    cover_url: snap.cover ?? snap.cover_url ?? null,
    servers: [], // as fontes de reprodução são resolvidas ao abrir (items.js)
  };
}

function readProgress(id, s, e) {
  const raw = readRaw(pKey(id, s, e));
  if (!raw) return null;
  const [pos, dur, watched, ts] = raw.split(',');
  return { pos: Number(pos) || 0, dur: Number(dur) || 0, watched: watched === '1', ts: Number(ts) || 0 };
}

const pctOf = (pos, dur) => (dur > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : 0);

function asProgress(pr) {
  if (!pr) return null;
  return {
    currentTime: pr.pos / 1000,
    duration: pr.dur / 1000,
    progressPct: pr.watched && !pr.dur ? 100 : pctOf(pr.pos, pr.dur),
    updatedAt: pr.ts,
  };
}

function loadFavorites() {
  return listKeys('fav:')
    .map((k) => { const v = readJSON(k); return v ? { ...toItem(v, k.slice(4)), added_at: v.added_at || 0 } : null; })
    .filter(Boolean)
    .sort((a, b) => b.added_at - a.added_at || a.title.localeCompare(b.title));
}

function loadRecents() {
  return listKeys('cw:')
    .map((k) => {
      const v = readJSON(k);
      if (!v?.series) return null;
      const id = k.slice(3);
      const season = v.season || 0;
      const episode = v.num || 0;
      const pr = readProgress(id, season, episode);
      return {
        ...toItem(v.series, id),
        season: season || undefined,
        episode: episode || undefined,
        epTitle: v.epTitle,
        image: v.image ?? null,
        progressPct: pr ? asProgress(pr).progressPct : 0,
        remaining: pr ? Math.max(0, (pr.dur - pr.pos) / 1000) : 0,
        watched_at: v.ts || 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.watched_at - a.watched_at)
    .slice(0, MAX_RECENTS);
}

function reload() {
  library.favorites = loadFavorites();
  library.recents = loadRecents();
  library.version++;
}

// ─── Migração do formato antigo da web (xf_*) ───────────────────────────────

const oldProgressId = (item) => itemKey(item).replace(/-/g, '_');

function migrateV1() {
  const favs = readJSON('xf_favorites', []);
  const recents = readJSON('xf_recents', []);
  const epKeys = listKeys('xf_ep_prog_');
  const mediaKeys = listKeys('xf_media_prog_');
  const watchedKeys = listKeys('xw_');
  const seriesKeys = listKeys('xf_series_prog_');
  const nothing = !favs.length && !recents.length && !epKeys.length && !mediaKeys.length && !watchedKeys.length && !seriesKeys.length;
  if (nothing) {
    if (readRaw('xf_favorites') != null) writeRaw('xf_favorites', null);
    if (readRaw('xf_recents') != null) writeRaw('xf_recents', null);
    return;
  }

  // id antigo (slug_ano) → item, a partir do que a web já guardava
  const byOldId = new Map();
  for (const it of [...favs, ...recents, ...(readJSON('xf_item_cache', []) || [])]) {
    if (it?.title && it?.type) byOldId.set(oldProgressId(it), it);
  }
  const ensure = (k, v) => { if (readRaw(k) == null) writeRaw(k, v); };

  for (const it of favs) {
    if (it?.title && it?.type) ensure(`fav:${cid(it)}`, JSON.stringify({
      type: it.type, key: cid(it), title: it.title, year: it.year ?? null, cover: it.cover_url ?? null, added_at: it.added_at || 0,
    }));
  }
  for (const it of recents) {
    if (!it?.title || !it?.type) continue;
    ensure(`cw:${cid(it)}`, JSON.stringify({
      series: { type: it.type, key: cid(it), title: it.title, year: it.year ?? null, cover: it.cover_url ?? null },
      season: it.season || 0, num: it.episode || 0, ts: it.watched_at || Date.now(), image: null, epTitle: it.epTitle,
    }));
  }
  const watchedSet = new Set(watchedKeys);
  for (const k of epKeys) {
    const m = /^xf_ep_prog_(.+)_s(\d+)_e(\d+)$/.exec(k);
    const it = m && byOldId.get(m[1]);
    const d = readJSON(k);
    if (!it || !d) continue;
    const watched = (d.progressPct || 0) >= WATCHED_PCT || watchedSet.has(`xw_${m[1]}_s${m[2]}_e${m[3]}`);
    ensure(pKey(cid(it), m[2], m[3]), `${Math.round((d.currentTime || 0) * 1000)},${Math.round((d.duration || 0) * 1000)},${watched ? 1 : 0},${d.updatedAt || Date.now()}`);
  }
  for (const k of watchedKeys) {
    const m = /^xw_(.+)_s(\d+)_e(\d+)$/.exec(k);
    const it = m && byOldId.get(m[1]);
    if (it && readRaw(k) === '1') ensure(pKey(cid(it), m[2], m[3]), `0,0,1,${Date.now()}`);
  }
  for (const k of mediaKeys) {
    const m = /^xf_media_prog_(.+)$/.exec(k);
    const it = m && byOldId.get(m[1]);
    const d = readJSON(k);
    if (!it || !d || it.type === 'live') continue;
    ensure(pKey(cid(it), 0, 0), `${Math.round((d.currentTime || 0) * 1000)},${Math.round((d.duration || 0) * 1000)},${(d.progressPct || 0) >= WATCHED_PCT ? 1 : 0},${d.updatedAt || Date.now()}`);
  }

  // apaga o formato antigo (aqui e, pela sincronização, no servidor)
  for (const k of [...epKeys, ...mediaKeys, ...watchedKeys, ...seriesKeys, 'xf_favorites', 'xf_recents']) writeRaw(k, null);
}

// Trocou de perfil (ou chegaram dados do servidor): migra o que for antigo e relê tudo.
onProfileData(() => {
  if (hasProfile()) migrateV1();
  reload();
});

// ─── Episódios vistos ───────────────────────────────────────────────────────

export function isWatched(item, s, e) {
  return readProgress(cid(item), s, e)?.watched === true;
}

/** Marca/desmarca vários episódios de uma vez: [{season, episode}] */
export function setWatched(item, episodes, value) {
  const id = cid(item);
  for (const { season, episode } of episodes) {
    const prev = readProgress(id, season, episode);
    writeRaw(pKey(id, season, episode), `${value ? prev?.pos ?? 0 : 0},${prev?.dur ?? 0},${value ? 1 : 0},${Date.now()}`);
  }
  library.version++;
}

// ─── Progresso ──────────────────────────────────────────────────────────────

/** @returns {{currentTime:number, duration:number, progressPct:number}|null} (segundos) */
export const getEpisodeProgress = (item, s, e) => asProgress(readProgress(cid(item), s, e));

export const getMediaProgress = (item) => asProgress(readProgress(cid(item), 0, 0));

/** Último episódio tocado da série: {season, episode, epTitle, ...} */
export function getSeriesProgress(item) {
  const v = readJSON(`cw:${cid(item)}`);
  if (!v?.season) return null;
  return { season: v.season, episode: v.num, epTitle: v.epTitle, ...asProgress(readProgress(cid(item), v.season, v.num)) };
}

const light = (item) => ({
  type: item.type, key: cid(item), title: item.title, year: item.year ?? null, cover: item.cover_url ?? null,
});

function writeProgress(item, season, episode, currentTime, duration, finished) {
  const id = cid(item);
  const prev = readProgress(id, season, episode);
  const dur = Math.round(duration * 1000) || prev?.dur || 0;
  const pos = finished && dur ? dur : Math.round(currentTime * 1000);
  const watched = !!prev?.watched || finished || pctOf(pos, dur) >= WATCHED_PCT;
  writeRaw(pKey(id, season, episode), `${pos},${dur},${watched ? 1 : 0},${Date.now()}`);
}

function writeContinue(item, season, episode, epTitle) {
  const id = cid(item);
  const prev = readJSON(`cw:${id}`);
  writeJSON(`cw:${id}`, {
    series: light(item), season, num: episode, ts: Date.now(), image: prev?.image ?? null, epTitle,
  });
  reload();
}

/** Salva o ponto atual de um episódio e atualiza "Continuar assistindo". */
export function saveEpisodeProgress(item, { season, episode, title, currentTime, duration, finished }) {
  writeProgress(item, season, episode, currentTime, duration, finished);
  writeContinue(item, season, episode, title);
}

export function saveMediaProgress(item, { currentTime, duration, finished }) {
  if (item.type === 'live') return; // canal ao vivo não tem ponto de retomada
  writeProgress(item, 0, 0, currentTime, duration, finished);
  writeContinue(item, 0, 0);
}

// ─── Favoritos ──────────────────────────────────────────────────────────────

export const isFavorite = (item) => readRaw(`fav:${cid(item)}`) != null;

export function toggleFavorite(item) {
  const id = cid(item);
  const on = !isFavorite(item);
  if (on) writeJSON(`fav:${id}`, { ...light(item), added_at: Date.now() });
  else writeRaw(`fav:${id}`, null);
  reload();
  return on;
}

// ─── Continuar assistindo ───────────────────────────────────────────────────

export function removeRecent(item) {
  writeRaw(`cw:${cid(item)}`, null);
  reload();
}

export function clearRecents() {
  for (const k of listKeys('cw:')) writeRaw(k, null);
  reload();
}
