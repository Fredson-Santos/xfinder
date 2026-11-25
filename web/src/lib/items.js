/**
 * Cache dos itens abertos, para reabrir uma página direto pela URL (F5,
 * favoritos, histórico) sem precisar refazer a busca.
 */
import { readJSON, writeJSON } from './storage.js';
import { itemKey, groupResults } from './streams.js';
import { canonicalId } from './identity.js';
import { api } from './api.js';

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

/**
 * Itens vindos da sincronização (favoritos/histórico gravados em outro
 * aparelho) não trazem os servidores de reprodução. Busca o título e devolve
 * o item com `servers`. Se não achar, devolve o item como está.
 */
export async function hydrateItem(item) {
  if (!item || item.servers?.length) return item;
  try {
    const want = canonicalId(item);
    const found = groupResults(await api.search(item.title)).filter((g) => g.type === item.type && canonicalId(g) === want);
    if (!found.length) return item;
    // vários grupos (ex.: anos diferentes): junta as fontes de todos
    const servers = found.flatMap((g) => g.servers);
    return { ...found[0], key: item.key, servers, year: item.year ?? found[0].year, cover_url: item.cover_url || found[0].cover_url };
  } catch {
    return item;
  }
}
