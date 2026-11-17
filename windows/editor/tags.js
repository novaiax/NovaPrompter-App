import { clamp } from '../shared/script-model.js';
import { readJson } from '../shared/settings.js';

const TAGS_KEY = 'novaprompter:tags';
export const DEFAULT_TAGS = [
  { id: 't_souffle', name: 'souffle', label: 'RESPIRER', color: '#c9b8ff', bgColor: '#302447', fontSize: .84, pause: 1.5 },
  { id: 't_pause', name: 'pause', label: 'PAUSE', color: '#f0cc91', bgColor: '#362e24', fontSize: .84, pause: 1 },
  { id: 't_regard', name: 'regard', label: 'REGARD', color: '#a6e6ce', bgColor: '#1e372f', fontSize: .84, pause: 0 },
  { id: 't_emph', name: 'emph', label: 'INSISTER', color: '#f5b6cb', bgColor: '#39253b', fontSize: .84, pause: 0 }
];
export const hexColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

export function sanitizeName(s) {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 24);
}

export function normalizeTags(list) {
  if (!Array.isArray(list)) return [];
  const used = new Set();
  const result = [];
  for (const tag of list) {
    if (typeof tag?.name !== 'string' || !/^[a-z0-9_-]{1,24}$/.test(tag.name) || used.has(tag.name)) continue;
    used.add(tag.name);
    result.push({
      id: typeof tag.id === 'string' ? tag.id : 't_' + crypto.randomUUID(),
      name: tag.name,
      label: (typeof tag.label === 'string' && tag.label.trim().slice(0, 36)) || tag.name,
      color: hexColor(tag.color) ? tag.color : '#c9b8ff',
      bgColor: hexColor(tag.bgColor) ? tag.bgColor : 'transparent',
      fontSize: Number.isFinite(tag.fontSize) ? clamp(tag.fontSize, .5, 2) : 1,
      pause: Number.isFinite(tag.pause) ? clamp(tag.pause, 0, 20) : 0
    });
  }
  return result;
}

export function loadTags() {
  return normalizeTags(readJson(TAGS_KEY, DEFAULT_TAGS));
}

export function saveTags(tags) {
  localStorage.setItem(TAGS_KEY, JSON.stringify(tags));
}
