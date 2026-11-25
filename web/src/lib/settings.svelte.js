/**
 * Preferências do usuário. As de reprodução são do perfil (sincronizadas, com
 * as mesmas chaves do app de TV: set:auto_next…); o tema é do navegador.
 */
import { readJSON, readRaw, writeRaw, hasProfile, onProfileData } from './storage.js';

const DEFAULTS = { skipIntro: true, autoNext: true, resume: true };
const NAMES = { skipIntro: 'skip_intro', autoNext: 'auto_next', resume: 'resume' };

export const SKIP_INTRO_SECS = 90;

export const settings = $state({
  ...DEFAULTS,
  theme: readRaw('xfinder-theme') || 'dark',
});

export function setSetting(key, value) {
  settings[key] = value;
  if (key === 'theme') {
    writeRaw('xfinder-theme', value);
    document.documentElement.dataset.theme = value;
  } else {
    writeRaw(`set:${NAMES[key]}`, value ? '1' : '0');
  }
}

function load() {
  // formato antigo da web: um JSON em xf_settings
  const old = readJSON('xf_settings');
  if (old) {
    for (const [k, name] of Object.entries(NAMES)) {
      if (k in old && readRaw(`set:${name}`) == null) writeRaw(`set:${name}`, old[k] ? '1' : '0');
    }
  }
  if (readRaw('xf_settings') != null) writeRaw('xf_settings', null);
  for (const [k, name] of Object.entries(NAMES)) {
    const v = readRaw(`set:${name}`);
    settings[k] = v == null ? DEFAULTS[k] : v === '1';
  }
}

// Ajustes são por perfil: relê quando o perfil muda ou chegam dados do servidor.
onProfileData(() => { if (hasProfile()) load(); });
