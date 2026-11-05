/** Lista de servidores e operações (individuais e em lote). */
import { api } from './api.js';
import { daysUntil } from './format.js';

export const servers = $state({
  list: [],
  loaded: false,
  /** ids em sincronização agora (estado só da interface) */
  syncing: new Set(),
});

export const okServers = () => servers.list.filter((s) => s.status === 'ok');

export async function loadServers() {
  try {
    servers.list = await api.listServers();
  } catch (err) {
    console.error('Falha ao listar servidores:', err);
  }
  servers.loaded = true;
}

/**
 * Classificação usada nos filtros e no status da tabela.
 * @returns {'syncing'|'error'|'expired'|'expiring'|'pending'|'ok'}
 */
export function serverKind(s) {
  if (servers.syncing.has(s.id) || s.status === 'syncing') return 'syncing';
  if (s.status === 'error') return 'error';
  const days = daysUntil(s.expiry);
  if (days !== null && days < 0) return 'expired';
  if (s.status === 'pending') return 'pending';
  if (days !== null && days <= 7) return 'expiring';
  return 'ok';
}

/** Executa `fn` em paralelo com no máximo `limit` tarefas simultâneas. */
async function pool(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

/**
 * Sincroniza servidores (6 por vez) e recarrega a lista uma única vez no fim.
 * @returns {Promise<{ok:number, failed:number, errors:string[]}>}
 */
export async function syncServers(ids, { deleteOnError = false, onEach } = {}) {
  const result = { ok: 0, failed: 0, errors: [] };
  ids.forEach((id) => servers.syncing.add(id));
  servers.syncing = new Set(servers.syncing);

  await pool(ids, 6, async (id) => {
    try {
      await api.syncServer(id, deleteOnError);
      result.ok++;
    } catch (err) {
      result.failed++;
      result.errors.push(err.message);
    } finally {
      servers.syncing.delete(id);
      servers.syncing = new Set(servers.syncing);
      onEach?.(result);
    }
  });

  await loadServers();
  return result;
}

export async function removeServers(ids) {
  const res = await api.removeServers(ids);
  await loadServers();
  return res.removed ?? ids.length;
}

/**
 * Cadastra servidores, valida cada um sincronizando e descarta os que falharem.
 * @param {Array<object>} list itens no formato do parser de lote / formulário
 */
export async function addAndValidate(list, onProgress) {
  const { servers: created = [] } = await api.addServersBatch(list);
  if (!created.length) throw new Error('Nenhum servidor pôde ser cadastrado.');
  const total = created.length;
  return syncServers(created.map((s) => s.id), {
    deleteOnError: true,
    onEach: (r) => onProgress?.({ done: r.ok + r.failed, total, ...r }),
  });
}
