/**
 * Identidade de um título compartilhada entre a web e o app de TV, para que
 * favoritos e progresso sincronizados caiam no mesmo item nos dois lados.
 *
 * Deve produzir exatamente o mesmo que `normalizeTitle` do app de TV
 * (android-tv/…/Models.kt): "série:naruto", "movie:oanoitedoteste"…
 */
const BRACKETS = /\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g;
const PREFIX = /^\s*\|?[a-z]{2,3}\|?\s*[-:|]\s*/;
const TAGS = /\b(legendado|dublado|dual|leg|dub|4k|fhd|uhd|hd|sd|multi|nacional)\b/g;

export function tvNormalize(title) {
  let s = String(title ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(BRACKETS, ' ');
  s = s.replace(PREFIX, '');
  s = s.replace(TAGS, ' ');
  return s.replace(/[^a-z0-9]/g, '');
}

/** ID canônico: "<tipo>:<título normalizado>". */
export const canonicalId = (item) => `${item.type}:${tvNormalize(item.title)}`;
