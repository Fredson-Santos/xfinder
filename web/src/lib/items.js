/**
 * Cache dos itens abertos, para reabrir uma página direto pela URL (F5,
 * favoritos, histórico) sem precisar refazer a busca.
 */
import { readJSON, writeJSON } from './storage.js';
import { itemKey } from './streams.js';

const KEY = 'xf_item_cache';
const MAX = 80;

export function rememberItem(item) {
  const cache = readJSON(KEY, []).filter((x) => x.key !== item.key);
  cache.unshift({ ...item, key: item.key || itemKey(item) });
  writeJSON(KEY, cache.slice(0, MAX));
}

/** Procura no cache e, em seguida, nos favoritos/recentes. */
export function findItem(key, extraLists = []) {
  for (const list of [readJSON(KEY, []), ...extraLists]) {
    const hit = list.find((x) => (x.key || itemKey(x)) === key);
    if (hit) return { ...hit, key };
  }
  return null;
}
