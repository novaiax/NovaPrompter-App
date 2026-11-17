import { readJson } from '../shared/settings.js';

export const SCRIPTS_KEY = 'novaprompter:scripts';
export const MAX_SCRIPT_LENGTH = 250_000;

export function isScript(script) {
  return typeof script?.id === 'string' && typeof script.title === 'string' && typeof script.content === 'string';
}

export function loadAll() {
  const list = readJson(SCRIPTS_KEY, []);
  return Array.isArray(list) ? list.filter(isScript).filter(script => !script.deleted) : [];
}

export function saveAll(list) {
  localStorage.setItem(SCRIPTS_KEY, JSON.stringify(list));
}

export function newScript(title = '', content = '') {
  const now = Date.now();
  return { id: 's_' + crypto.randomUUID(), title, content, createdAt: now, updatedAt: now };
}

export function readImport({ name, text }) {
  if (/\.json$/i.test(name)) {
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error('Sauvegarde JSON invalide.'); }
    const list = Array.isArray(data) ? data : data?.scripts;
    if (!Array.isArray(list) || list.some(script =>
      typeof script?.title !== 'string' || typeof script.content !== 'string')) {
      throw new Error('Cette sauvegarde ne contient pas de scripts NovaPrompter.');
    }
    if (list.some(script => script.content.length > MAX_SCRIPT_LENGTH)) throw new Error('Un script dépasse 250 000 caractères.');
    return { scripts: list.filter(script => !script.deleted).map(script => newScript(script.title.slice(0, 160), script.content)), tags: data.tags };
  }
  if (text.length > MAX_SCRIPT_LENGTH) throw new Error('Un script dépasse 250 000 caractères.');
  return { scripts: [newScript(name.replace(/\.[^.]+$/, '').slice(0, 160), text.replace(/\r\n?/g, '\n'))] };
}
