import { clamp } from './script-model.js';

export const SETTINGS_KEY = 'novaprompter:settings';

export const themes = {
  dark: { name: 'Nuit', bg: '#111420', fg: '#f4f3ff' },
  light: { name: 'Papier', bg: '#f4efe4', fg: '#211d25' },
  cream: { name: 'Ivoire', bg: '#efe4cc', fg: '#261b17' },
  amber: { name: 'Ambre', bg: '#211811', fg: '#ffdf9e' },
  green: { name: 'Forêt', bg: '#111e1b', fg: '#c9f2da' },
  blue: { name: 'Encre', bg: '#13243c', fg: '#dceaff' }
};

export const defaults = {
  mode: 'voice', pace: 150, fontSize: 44, lineWidth: 86, focusOffset: 32,
  fontFamily: 'Lexend', fontWeight: 500, lineHeight: 1.5, letterSpacing: 0,
  alignLeft: true, theme: 'dark', colorFg: '#f4f3ff', colorBg: '#111420',
  mirrorH: false, mirrorV: false, alwaysTop: true, opacity: 1, showGuide: true,
  lookahead: 0, countdown: 0, micDeviceId: '', micLabel: '', noiseSuppression: true, autoGain: true,
  obsHost: 'ws://127.0.0.1:4455'
};

export function normalizeSettings(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const s = { ...defaults };
  for (const key of ['alignLeft', 'mirrorH', 'mirrorV', 'alwaysTop', 'showGuide', 'noiseSuppression', 'autoGain']) {
    if (typeof raw[key] === 'boolean') s[key] = raw[key];
  }
  for (const key of ['micDeviceId', 'micLabel', 'obsHost']) {
    if (typeof raw[key] === 'string') s[key] = raw[key];
  }
  if (['auto', 'voice'].includes(raw.mode)) s.mode = raw.mode;
  if (['custom', ...Object.keys(themes)].includes(raw.theme)) s.theme = raw.theme;
  for (const key of ['colorFg', 'colorBg']) {
    if (typeof raw[key] === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw[key])) s[key] = raw[key];
  }
  if (typeof raw.fontFamily === 'string') {
    const first = raw.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
    if (first) s.fontFamily = first;
  }
  const bounds = {
    pace: [65, 320], fontSize: [18, 120], lineWidth: [42, 94], focusOffset: [14, 68],
    fontWeight: [300, 900], lineHeight: [1.15, 2.2], letterSpacing: [-2, 8],
    opacity: [0.5, 1], lookahead: [0, 12], countdown: [0, 5]
  };
  if (Number.isFinite(raw.speed) && !Number.isFinite(raw.pace)) s.pace = clamp(Math.round(raw.speed * 2.5), 65, 320);
  for (const [key, [min, max]] of Object.entries(bounds)) {
    if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) s[key] = clamp(raw[key], min, max);
  }
  return s;
}

export function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
