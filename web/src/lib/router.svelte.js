/**
 * Roteador por hash (#/serie/x?play=2-5).
 * Cada navegação vira uma entrada no histórico do navegador, então os botões
 * Voltar/Avançar e o F5 funcionam como num site comum.
 */

function parse() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return {
    path: path || '/',
    query: Object.fromEntries(new URLSearchParams(qs)),
    depth: history.state?.xfDepth ?? 0,
  };
}

export const route = $state(parse());

function sync() {
  Object.assign(route, parse());
}
window.addEventListener('popstate', sync);
window.addEventListener('hashchange', sync);

/** Monta "/caminho?a=1" ignorando parâmetros vazios. */
export function href(path, query = {}) {
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')).toString();
  return qs ? `${path}?${qs}` : path;
}

export function navigate(to, { replace = false } = {}) {
  const depth = (history.state?.xfDepth ?? 0) + (replace ? 0 : 1);
  const url = '#' + to;
  if (replace) history.replaceState({ xfDepth: depth }, '', url);
  else history.pushState({ xfDepth: depth }, '', url);
  sync();
  if (!replace) window.scrollTo({ top: 0 });
}

/** Volta uma página; se a página foi aberta direto (link/F5), vai para `fallback`. */
export function back(fallback = '/') {
  if ((history.state?.xfDepth ?? 0) > 0) history.back();
  else navigate(fallback, { replace: true });
}

/** match('/serie/:key', '/serie/abc') → { key: 'abc' } | null */
export function match(pattern, path) {
  const p = pattern.split('/');
  const a = path.split('/');
  if (p.length !== a.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}
