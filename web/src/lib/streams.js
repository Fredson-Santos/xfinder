/**
 * Montagem de URLs de stream, agrupamento dos resultados da busca e
 * estrutura de temporadas/episódios. Funções puras (sem DOM nem estado).
 */
import { slugify } from './format.js';

/** URL de reprodução de uma ocorrência (servidor) de um item. */
export function buildStreamUrl(occ, streamId, ext, type) {
  if (occ.raw_url) return occ.raw_url; // M3U: URL direta
  if (!occ.host) return '';
  const pathType = type === 'live' ? 'live' : type === 'series' ? 'series' : 'movie';
  const extension = type === 'live' ? 'ts' : (ext || 'mp4');
  const port = occ.port ? `:${occ.port}` : '';
  const host = occ.host.startsWith('http') ? occ.host : `http://${occ.host}`;
  return `${host}${port}/${pathType}/${occ.username}/${occ.password}/${streamId}.${extension}`;
}

export const serverHost = (occ) =>
  occ.server_type === 'm3u' || !occ.host ? 'Lista M3U' : `${occ.host.replace(/^https?:\/\//, '')}${occ.port ? ':' + occ.port : ''}`;

// ─── Itens ──────────────────────────────────────────────────────────────────

/** Chave estável de um item (usada na URL e no cache). */
export const itemKey = (item) => slugify(item.title) + (item.year ? '-' + item.year : '');

const YEAR_SUFFIX = /\s*\((19|20)\d{2}\)\s*/g;

/** Título para exibição: sem o "(2008)" que alguns servidores colocam no nome. */
const displayTitle = (title) => String(title).replace(YEAR_SUFFIX, ' ').replace(/\s+/g, ' ').trim();

/**
 * Normaliza o título para juntar o mesmo conteúdo vindo de servidores
 * diferentes. Marcas como "[L]" (legendado) são mantidas: dublado e
 * legendado continuam itens separados.
 */
function normalizeTitle(title) {
  return displayTitle(title)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(4k|uhd|fhd|hd|sd|h\.?265|hevc)\b/g, ' ')
    .replace(/\[\s*\]/g, ' ') // "[FHD]" sem a qualidade → igual a "FHD"
    .replace(/[^a-z0-9\[\]]+/g, ' ')
    .trim();
}

/**
 * A API devolve uma linha por servidor. Aqui viram um item por título,
 * com todos os servidores em `servers` (fontes para failover). Linhas sem
 * ano entram no grupo de mesmo título que tem ano.
 */
export function groupResults(rows) {
  const byTitle = new Map(); // tipo|título → Map(ano → grupo)
  for (const r of rows) {
    const tKey = `${r.type}|${normalizeTitle(r.title)}`;
    if (!byTitle.has(tKey)) byTitle.set(tKey, new Map());
    const years = byTitle.get(tKey);
    const year = r.year ?? null;

    let g = years.get(year ?? 'none');
    if (!g && year === null && years.size) g = years.values().next().value;
    if (!g && year !== null && years.has('none') && years.size === 1) {
      g = years.get('none');
      years.delete('none');
      g.year = year;
      years.set(year, g);
    }
    if (!g) {
      g = { title: displayTitle(r.title), type: r.type, year, cover_url: r.cover_url ?? null, servers: [] };
      years.set(year ?? 'none', g);
    }
    if (!g.cover_url && r.cover_url) g.cover_url = r.cover_url;
    for (const occ of r.servers || []) {
      if (g.servers.some((s) => s.server_id === occ.server_id && s.stream_id === occ.stream_id)) continue;
      // Em séries, o ID da série é próprio de cada servidor
      g.servers.push({ ...occ, series_id: r.external_id ?? occ.stream_id ?? null });
    }
  }
  // A chave vira id no {#each}: títulos diferentes que gerem o mesmo slug
  // ganham sufixo, senão o Svelte aborta a renderização da lista inteira.
  const used = new Set();
  return [...byTitle.values()].flatMap((years) => [...years.values()]).map((g) => {
    const base = itemKey(g);
    let key = base;
    for (let n = 2; used.has(g.type + key); n++) key = `${base}-${n}`;
    used.add(g.type + key);
    return { ...g, key };
  });
}

/** Fontes de um filme/canal: uma por servidor. */
export function mediaSources(item) {
  return (item?.servers || [])
    .map((occ) => ({
      name: occ.server_name,
      host: serverHost(occ),
      url: buildStreamUrl(occ, occ.stream_id, occ.container_extension, item.type),
    }))
    .filter((s) => s.url);
}

// ─── Séries ─────────────────────────────────────────────────────────────────

export const xtreamServers = (series) => (series?.servers || []).filter((s) => s.server_type === 'xtream' && s.series_id);

export const episodeNumber = (ep) => Number(ep.episode_num ?? ep.num ?? 0);

/** @returns {Array<{num:number, episodes:object[]}>} temporadas e episódios em ordem */
export function seasonsOf(episodeData) {
  if (!episodeData?.episodes) return [];
  return Object.entries(episodeData.episodes)
    .map(([num, eps]) => ({
      num: parseInt(num, 10),
      episodes: [...(eps || [])].sort((a, b) => episodeNumber(a) - episodeNumber(b)),
    }))
    .filter((s) => s.episodes.length)
    .sort((a, b) => a.num - b.num);
}

/** Lista plana na ordem de exibição (para fila, "continuar" e "marcar como visto"). */
export function flattenEpisodes(episodeData) {
  const list = [];
  for (const season of seasonsOf(episodeData)) {
    for (const ep of season.episodes) {
      const num = episodeNumber(ep);
      list.push({
        season: season.num,
        episode: num,
        title: ep.title?.trim() || `Episódio ${num}`,
        raw: ep,
        durationSecs: Number(ep.info?.duration_secs) || 0,
      });
    }
  }
  return list;
}

export function episodeUrl(occ, ep) {
  return buildStreamUrl(occ, ep.id || ep.stream_id || '', ep.container_extension || 'mp4', 'series');
}

export function findEpisode(episodeData, season, episode) {
  const eps = episodeData?.episodes?.[String(season)] || [];
  return eps.find((e) => episodeNumber(e) === episode) || null;
}
