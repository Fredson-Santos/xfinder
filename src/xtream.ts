/**
 * Xtream Codes API client.
 * Port of src-tauri/src/xtream.rs → TypeScript using Node.js built-in fetch.
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

function baseUrl(host: string, port: string): string {
  let h = host.startsWith('http') ? host : `http://${host}`;
  if (h.endsWith('/')) h = h.slice(0, -1);
  return port ? `${h}:${port}` : h;
}

function apiUrl(host: string, port: string, user: string, pass: string): string {
  return `${baseUrl(host, port)}/player_api.php?username=${user}&password=${pass}`;
}

/** Xtream APIs are inconsistent — stream_id may be a number or a numeric string. */
export function idToString(v: unknown): string {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  return '';
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Response types ──────────────────────────────────────────────────────────

export interface UserInfo {
  username?:        string;
  exp_date?:        string;
  active_cons?:     string;
  max_connections?: string;
  status?:          string;
}

export interface XtreamInfo {
  user_info: UserInfo;
}

export interface VodStream {
  name:                string;
  stream_id:           number | string;
  stream_icon?:        string | null;
  category_id?:        string | null;
  container_extension?: string | null;
  releaseDate?:        string | null;
  added?:              string | null;
}

export interface SeriesEntry {
  series_id:    number | string;
  name:         string;
  cover?:       string | null;
  category_id?: string | null;
  releaseDate?: string | null;
}

export interface LiveStream {
  name:        string;
  stream_id:   number | string;
  stream_icon?: string | null;
  category_id?: string | null;
}

// ─── API calls ───────────────────────────────────────────────────────────────

/** Authenticate and retrieve account info (expiry, connections, etc.) */
export async function getInfo(host: string, port: string, user: string, pass: string): Promise<XtreamInfo> {
  try {
    return await fetchJson<XtreamInfo>(apiUrl(host, port, user, pass), 15_000);
  } catch (e) {
    throw new Error(`Connection error: ${e}`);
  }
}

/** Fetch full VOD (movie) catalogue — may be large, 120 s timeout */
export async function getVod(host: string, port: string, user: string, pass: string): Promise<VodStream[]> {
  try {
    return await fetchJson<VodStream[]>(`${apiUrl(host, port, user, pass)}&action=get_vod_streams`, 120_000);
  } catch (e) {
    throw new Error(`VOD fetch error: ${e}`);
  }
}

/** Fetch full series catalogue */
export async function getSeries(host: string, port: string, user: string, pass: string): Promise<SeriesEntry[]> {
  try {
    return await fetchJson<SeriesEntry[]>(`${apiUrl(host, port, user, pass)}&action=get_series`, 120_000);
  } catch (e) {
    throw new Error(`Series fetch error: ${e}`);
  }
}

/** Fetch live streams catalogue */
export async function getLive(host: string, port: string, user: string, pass: string): Promise<LiveStream[]> {
  try {
    return await fetchJson<LiveStream[]>(`${apiUrl(host, port, user, pass)}&action=get_live_streams`, 120_000);
  } catch (e) {
    throw new Error(`Live fetch error: ${e}`);
  }
}

/** Get full series info with season/episode breakdown (called on demand) */
export async function getSeriesInfo(
  host: string, port: string, user: string, pass: string, seriesId: string,
): Promise<unknown> {
  try {
    return await fetchJson<unknown>(
      `${apiUrl(host, port, user, pass)}&action=get_series_info&series_id=${seriesId}`,
      30_000,
    );
  } catch (e) {
    throw new Error(`Series info fetch error: ${e}`);
  }
}
