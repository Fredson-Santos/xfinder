/** Cliente REST do backend Go (/api/*). Erros HTTP viram exceções com a mensagem do servidor. */

async function request(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export const api = {
  listServers: () => request('GET', '/servers'),

  /** @returns {Promise<number>} id criado */
  addServer: (server) => request('POST', '/servers', server).then((d) => d.id),

  /** @returns {Promise<{servers:{id:number,name:string}[]}>} */
  addServersBatch: (servers) => request('POST', '/servers/batch', { servers }),

  removeServers: (ids) => request('POST', '/servers/delete-batch', { serverIds: ids }),

  /**
   * Sincroniza um servidor. `deleteOnError` é explícito: o padrão do backend
   * apaga o servidor quando a sincronização falha.
   */
  syncServer: (id, deleteOnError = false) =>
    request('POST', `/servers/${id}/sync?deleteOnError=${deleteOnError}`).then((d) => d.message),

  search: (query) => request('GET', `/search?q=${encodeURIComponent(query)}`),

  getEpisodes: (occ, seriesId) =>
    request('GET', `/episodes?${new URLSearchParams({
      serverType: occ.server_type ?? '',
      host: occ.host ?? '',
      port: occ.port ?? '',
      username: occ.username ?? '',
      password: occ.password ?? '',
      seriesId: seriesId ?? '',
    })}`),

  exportUrl: (format) => `/api/servers/export?format=${encodeURIComponent(format)}`,
};
