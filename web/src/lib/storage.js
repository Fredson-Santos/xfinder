/** localStorage sempre protegido: modo privado / cota cheia não quebram a interface. */

export function readJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('localStorage indisponível:', err);
  }
}

export function readRaw(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeRaw(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* ignora */ }
}
