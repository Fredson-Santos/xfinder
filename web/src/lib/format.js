/** Formatação de tempo, datas e textos (pt-BR). */

/** 3725 → "1:02:05" · 65 → "1:05" */
export function clock(secs) {
  if (!isFinite(secs) || secs < 0) secs = 0;
  const s = Math.floor(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 4320 → "1h 12min" · 300 → "5 min" */
export function humanDuration(secs) {
  const m = Math.max(1, Math.round(secs / 60));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}min` : `${h}h`;
}

export function timeAgo(ts) {
  if (!ts) return '';
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ontem';
  if (d < 7) return `há ${d} dias`;
  return new Date(ts).toLocaleDateString('pt-BR');
}

export const TYPE_LABEL = { movie: 'Filme', series: 'Série', live: 'Ao vivo' };

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const formatNumber = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));

/** Dias até o vencimento (negativo = vencido); null = sem vencimento. */
export function daysUntil(expiry) {
  if (!expiry) return null;
  return Math.ceil((new Date(expiry) - new Date()) / 86400000);
}

export function slugify(text) {
  return String(text ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}
