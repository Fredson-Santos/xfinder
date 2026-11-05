/**
 * Interpreta o texto colado / arquivo da importação em lote e devolve a lista
 * de servidores. Aceita JSON, links get.php / player_api.php, URLs de stream
 * Xtream (/live/user/pass/...), linhas "host user pass nome" (espaço, vírgula,
 * ponto e vírgula, tab ou pipe) e URLs M3U simples. Linhas "# Nome" ou
 * "#EXTINF:...,Nome" dão nome ao servidor da linha seguinte.
 *
 * (Lógica mantida da versão anterior do painel.)
 */

/**
 * Analisa o texto/linhas e retorna a lista estruturada de servidores
 */
export function parseBatchServerInput(rawText) {
  if (!rawText || !rawText.trim()) return [];
  const text = rawText.trim();

  // 1. JSON Array
  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const results = [];
        for (const item of parsed) {
          if (!item) continue;
          const mUrl = item.m3uUrl || item.m3u_url || item.url;
          if (mUrl && (!item.username || !item.password)) {
            results.push({
              name: item.name || deriveNameFromUrl(mUrl),
              serverType: 'm3u',
              host: null,
              port: null,
              username: null,
              password: null,
              m3uUrl: String(mUrl).trim(),
            });
          } else if (item.host && item.username && item.password) {
            results.push({
              name: item.name || deriveNameFromUrl(item.host),
              serverType: 'xtream',
              host: String(item.host).trim(),
              port: item.port ? String(item.port).trim() : null,
              username: String(item.username).trim(),
              password: String(item.password).trim(),
              m3uUrl: null,
            });
          }
        }
        if (results.length > 0) return deduplicateNames(results);
      }
    } catch (e) {}
  }

  // 2. Análise linha a linha
  const lines = text.split(/\r?\n/);
  const results = [];
  let pendingLabel = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;

    // Linha de comentário (# Nome ou #EXTINF:-1,Nome)
    if (line.startsWith('#')) {
      if (line.toUpperCase().startsWith('#EXTM3U')) continue;
      if (line.toUpperCase().startsWith('#EXTINF')) {
        const parts = line.split(',');
        if (parts.length > 1) pendingLabel = parts.slice(1).join(',').trim();
      } else {
        const cleanComment = line.replace(/^#+\s*/, '').trim();
        if (cleanComment) pendingLabel = cleanComment;
      }
      continue;
    }

    let explicitName = pendingLabel;
    pendingLabel = null;

    // Prefixo "Nome | URL" ou "Nome - URL"
    if (!explicitName) {
      if (line.includes(' | http://') || line.includes(' | https://')) {
        const split = line.split(/ \| (https?:\/\/)/i);
        if (split.length >= 3) {
          explicitName = split[0].trim();
          line = split[1] + split.slice(2).join('');
        }
      } else if (line.includes(' - http://') || line.includes(' - https://')) {
        const split = line.split(/ - (https?:\/\/)/i);
        if (split.length >= 3) {
          explicitName = split[0].trim();
          line = split[1] + split.slice(2).join('');
        }
      }
    }

    // A. URL Xtream em qualquer parte da linha (suporta CSV, get.php, player_api.php, etc.)
    const urlMatch = line.match(/(https?:\/\/[^\s,;"'|]+)/i);
    if (urlMatch) {
      const candidateUrl = urlMatch[1];
      if (candidateUrl.includes('username=') || candidateUrl.includes('get.php') || candidateUrl.includes('player_api.php') || candidateUrl.includes('xmltv.php')) {
        try {
          const urlObj = new URL(candidateUrl);
          const user = urlObj.searchParams.get('username') || urlObj.searchParams.get('user');
          const pass = urlObj.searchParams.get('password') || urlObj.searchParams.get('pass');
          if (user && pass) {
            const host = urlObj.origin;
            const name = explicitName || deriveNameFromUrl(host);
            results.push({
              name,
              serverType: 'xtream',
              host,
              port: null,
              username: user,
              password: pass,
              m3uUrl: null,
            });
            continue;
          }
        } catch (e) {}
      }

      // B. URL no formato de stream direto Xtream: http://host:port/live/user/pass/id.ts
      const livePathMatch = candidateUrl.match(/^(https?:\/\/[^\/]+)\/(?:live|movie|series)\/([^\/]+)\/([^\/]+)\//i);
      if (livePathMatch) {
        const host = livePathMatch[1];
        const user = livePathMatch[2];
        const pass = livePathMatch[3];
        const name = explicitName || deriveNameFromUrl(host);
        results.push({
          name,
          serverType: 'xtream',
          host,
          port: null,
          username: user,
          password: pass,
          m3uUrl: null,
        });
        continue;
      }
    }

    // C. Formato delimitado (espaço, vírgula, ponto e vírgula, tabulação ou pipe)
    // Ex: "http://host:8080 user pass Nome" ou "http://host:8080,user,pass,Nome"
    const delims = ['\t', '|', ',', ';', ' '];
    let matchedDelim = false;
    for (const d of delims) {
      if (line.includes(d)) {
        const parts = line.split(d).map(p => p.trim()).filter(Boolean);
        if (parts.length >= 3) {
          const hostToken = parts.find(t => t.startsWith('http://') || t.startsWith('https://') || /^[a-zA-Z0-9.-]+:\d+$/.test(t));
          if (hostToken) {
            const hostIdx = parts.indexOf(hostToken);
            let userToken, passToken, nameToken;

            if (hostIdx === 0) {
              userToken = parts[1];
              passToken = parts[2];
              nameToken = parts.slice(3).join(' ');
            } else {
              nameToken = parts.slice(0, hostIdx).join(' ');
              userToken = parts[hostIdx + 1];
              passToken = parts[hostIdx + 2];
            }

            if (userToken && passToken) {
              let host = hostToken;
              if (!host.startsWith('http://') && !host.startsWith('https://')) {
                host = 'http://' + host;
              }

              const name = explicitName || nameToken || deriveNameFromUrl(host);
              results.push({
                name,
                serverType: 'xtream',
                host,
                port: null,
                username: userToken,
                password: passToken,
                m3uUrl: null,
              });
              matchedDelim = true;
              break;
            }
          }
        }
      }
    }
    if (matchedDelim) continue;

    // D. URL M3U simples
    if (line.startsWith('http://') || line.startsWith('https://')) {
      const cleanUrl = line.split(/\s+/)[0];
      const name = explicitName || deriveNameFromUrl(cleanUrl);
      results.push({
        name,
        serverType: 'm3u',
        host: null,
        port: null,
        username: null,
        password: null,
        m3uUrl: cleanUrl,
      });
      continue;
    }
  }

  return deduplicateNames(results);
}

function deriveNameFromUrl(urlStr) {
  try {
    const clean = urlStr.startsWith('http') ? urlStr : `http://${urlStr}`;
    const parsed = new URL(clean);
    let host = parsed.hostname.replace(/^www\./, '');
    if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
      host += `:${parsed.port}`;
    }
    return host || 'Servidor IPTV';
  } catch (e) {
    return 'Servidor IPTV';
  }
}

function deduplicateNames(list) {
  const counts = {};
  return list.map(item => {
    const base = item.name.trim() || 'Servidor';
    counts[base] = (counts[base] || 0) + 1;
    if (counts[base] > 1) {
      return { ...item, name: `${base} (${counts[base]})` };
    }
    return { ...item, name: base };
  });
}
