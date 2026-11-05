/** Preferências do usuário (persistidas no navegador). */
import { readJSON, writeJSON, readRaw, writeRaw } from './storage.js';

const KEY = 'xf_settings';
const DEFAULTS = { skipIntro: true, autoNext: true, resume: true };

export const SKIP_INTRO_SECS = 90;

export const settings = $state({
  ...DEFAULTS,
  ...readJSON(KEY, {}),
  theme: readRaw('xfinder-theme') || 'dark',
});

export function setSetting(key, value) {
  settings[key] = value;
  if (key === 'theme') {
    writeRaw('xfinder-theme', value);
    document.documentElement.dataset.theme = value;
  } else {
    const { theme, ...rest } = settings;
    writeJSON(KEY, rest);
  }
}
