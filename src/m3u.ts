/**
 * Minimal IPTV M3U/M3U8 parser.
 *
 * Expected format:
 *   #EXTM3U
 *   #EXTINF:-1 tvg-id="..." tvg-name="..." tvg-logo="..." group-title="...",Title
 *   http://...stream_url...
 */

export interface M3uEntry {
  title:  string;
  url:    string;
  group:  string | null;
  logo:   string | null;
  tvgId:  string | null;
}

/** Parse an M3U/M3U8 string into a list of entries. */
export function parse(content: string): M3uEntry[] {
  const entries: M3uEntry[] = [];
  const lines = content.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    i++;

    if (!line.startsWith('#EXTINF')) continue;

    const title = extractTitle(line);
    const group = extractAttr(line, 'group-title');
    const logo  = extractAttr(line, 'tvg-logo');
    const tvgId = extractAttr(line, 'tvg-id');

    // The very next non-empty, non-comment line is the stream URL
    while (i < lines.length) {
      const next = lines[i].trim();
      if (!next) { i++; continue; }
      if (next.startsWith('#')) break; // next EXTINF block
      entries.push({ title, url: next, group, logo, tvgId });
      i++;
      break;
    }
  }

  return entries;
}

/** Extract the human-readable title (after the last comma on the #EXTINF line). */
function extractTitle(line: string): string {
  const pos = line.lastIndexOf(',');
  return pos !== -1 ? line.slice(pos + 1).trim() : 'Unknown';
}

/** Extract a quoted attribute value: `attr="value"`. */
function extractAttr(line: string, attr: string): string | null {
  const key   = `${attr}="`;
  const start = line.indexOf(key);
  if (start === -1) return null;
  const valueStart = start + key.length;
  const end = line.indexOf('"', valueStart);
  if (end === -1) return null;
  const val = line.slice(valueStart, end).trim();
  return val || null;
}

/** Infer content type from URL and group title. */
export function inferType(entry: M3uEntry): 'series' | 'movie' | 'live' {
  const urlLc   = entry.url.toLowerCase();
  const groupLc = (entry.group ?? '').toLowerCase();

  if (urlLc.includes('/series/') || groupLc.includes('serie') || groupLc.includes('sér')) {
    return 'series';
  }

  if (
    urlLc.includes('/movie/') || urlLc.includes('/vod/') ||
    urlLc.endsWith('.mp4')    || urlLc.endsWith('.mkv')  ||
    urlLc.endsWith('.avi')    || urlLc.endsWith('.mov')  ||
    groupLc.includes('movie') || groupLc.includes('film') || groupLc.includes('vod')
  ) {
    return 'movie';
  }

  return 'live';
}
