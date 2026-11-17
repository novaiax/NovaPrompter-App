import { icon, paintIcons } from '../shared/icons.js';
import { buildScript, clamp } from '../shared/script-model.js';
import { cleanScript } from '../shared/clean-script.js';
import { ReaderView } from '../shared/reader-view.js';
import { normalizeSettings, readJson, SETTINGS_KEY } from '../shared/settings.js';
import { createCueEditor } from './cues.js';
import { setupIntegrations } from './integrations.js';
import { Playback } from './playback.js';
import { isScript, loadAll, newScript, readImport, saveAll, SCRIPTS_KEY } from './storage.js';
import { loadTags, normalizeTags, saveTags } from './tags.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const bridge = window.nova;
const title = $('#script-title');
const body = $('#script-body');
const progress = $('#progress');
const microphone = $('#mic-device');
const search = $('#search-scripts');
const ACTIVE_KEY = 'novaprompter:activeScript';
const DELETIONS_KEY = 'novaprompter:deletions';
const TAG_STAMP_KEY = 'novaprompter:tagStamp';

const welcome = [
  'Prenez une seconde. Respirez. Puis commencez à lire à voix haute.',
  'En mode Voix, le prompteur suit vos mots. Quand vous marquez une pause, le texte attend avec vous.',
  'Essayez de ralentir, puis de reprendre naturellement. En cliquant sur un mot de l’aperçu, vous pouvez repartir de cet endroit.',
  'Quand vous avez terminé, créez votre propre script ou importez un texte depuis votre ordinateur.'
].join('\n\n');

let scripts = loadAll();
if (localStorage.getItem(SCRIPTS_KEY) === null) {
  scripts = [newScript('Une première lecture', welcome)];
  saveAll(scripts);
}
let selected = localStorage.getItem(ACTIVE_KEY);
let tags = loadTags();
const settings = normalizeSettings(readJson(SETTINGS_KEY, {}));
let deleted = readJson(DELETIONS_KEY, {});
if (!deleted || typeof deleted !== 'object' || Array.isArray(deleted)) deleted = {};
let tagStamp = Number(localStorage.getItem(TAG_STAMP_KEY)) || 0;
let dirty = false;
let saveTimer;
let toastTimer;
let undoToast;
let docRevision = 0;
let frameSequence = 0;
let model = buildScript('');
let indicator = { open: false };
let meterRms = 0;
let deviceScan = 0;
let transcript = '';
const formatter = new Intl.NumberFormat('fr-FR');
const dateFormatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const getScript = () => scripts.find(script => script.id === selected);
const preview = new ReaderView($('#preview'), { preview: true, onSeek: position => playback.seek(position) });

paintIcons();
const meter = Array.from({ length: 14 }, () => document.createElement('i'));
$('#mic-meter').append(...meter);
const playback = new Playback(bridge, settings, {
  onFrame: renderFrame,
  onLevel: renderLevel,
  onVoice: voiceStatus,
  onTranscript: showTranscript,
  onDevice: label => {
    if (settings.micDeviceId && label && settings.micLabel !== label) {
      settings.micLabel = label;
      storeSettings();
    }
    refreshMics(false);
    renderTestButton();
  }
});
const cues = createCueEditor({ getTags: () => tags, setTags: changeTags, insertCue });
const integrations = setupIntegrations(bridge, { snapshot: syncSnapshot, merge: mergeSync, notify });

function notify(message, undo) {
  clearTimeout(toastTimer);
  undoToast = undo;
  $('#toast-message').textContent = message;
  $('#toast-action').hidden = !undo;
  $('#toast').hidden = false;
  toastTimer = setTimeout(hideToast, undo ? 12_000 : 5400);
}

function hideToast() {
  clearTimeout(toastTimer);
  undoToast = null;
  $('#toast').hidden = true;
}

$('#toast-close').addEventListener('click', hideToast);
$('#toast-action').addEventListener('click', () => {
  const operation = undoToast;
  hideToast();
  operation?.();
});

function saveState(message, status = '') {
  $('#save-state').dataset.status = status;
  $('#save-label').textContent = message;
}

function persist() {
  clearTimeout(saveTimer);
  if (!dirty) return true;
  try {
    saveAll(scripts);
    localStorage.setItem(DELETIONS_KEY, JSON.stringify(deleted));
    dirty = false;
    saveState('Enregistré');
    return true;
  } catch {
    saveState('Stockage plein', 'error');
    return false;
  }
}

function markChanged(immediate = false) {
  dirty = true;
  clearTimeout(saveTimer);
  saveState('Enregistrement…');
  if (immediate) persist();
  else saveTimer = setTimeout(persist, 230);
  integrations.schedule();
}

function updateCurrent() {
  const script = getScript();
  if (!script) return;
  const changedText = script.content !== body.value;
  if (!changedText && script.title === title.value) return;
  script.title = title.value;
  script.content = body.value;
  script.updatedAt = Math.max(Date.now(), (script.updatedAt || 0) + 1);
  markChanged();
  renderScripts();
  if (changedText) updateDocument(true);
}

function renderScripts() {
  const list = $('#script-list');
  const focused = list.contains(document.activeElement) ? document.activeElement.dataset.script : null;
  const query = search.value.trim().toLocaleLowerCase('fr');
  const visible = scripts.filter(script => (script.title + ' ' + script.content).toLocaleLowerCase('fr').includes(query));
  $('#script-count').textContent = formatter.format(scripts.length);
  $('#no-results').hidden = Boolean(visible.length);
  $('#no-results').textContent = query ? 'Aucun script trouvé.' : 'Créez ou importez votre premier script.';
  const fragment = document.createDocumentFragment();
  const sorted = [...visible].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  for (const script of sorted) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'script-item';
    button.dataset.script = script.id;
    if (script.id === selected) button.setAttribute('aria-current', 'true');
    button.innerHTML = '<span class="doc-icon">' + icon('file') + '</span>'
      + '<span class="script-info"><span class="script-name"></span><span class="script-date"></span></span>';
    button.querySelector('.script-name').textContent = script.title.trim() || 'Script sans titre';
    button.querySelector('.script-date').textContent = script.updatedAt && Number.isFinite(script.updatedAt)
      ? dateFormatter.format(script.updatedAt) : 'Brouillon';
    button.addEventListener('click', () => selectScript(script.id));
    button.addEventListener('dblclick', () => { title.focus(); title.select(); });
    li.append(button);
    fragment.append(li);
  }
  list.replaceChildren(fragment);
  if (focused) [...list.querySelectorAll('button')].find(button => button.dataset.script === focused)?.focus();
}

function selectScript(id, { focus = false, reload = false } = {}) {
  if (selected === id && !focus && !reload && (getScript()?.content || '') === body.value) return;
  persist();
  selected = id || '';
  try { localStorage.setItem(ACTIVE_KEY, selected); } catch {}
  const script = getScript();
  title.value = script?.title || '';
  body.value = script?.content || '';
  for (const element of [title, body, $('#open-clean')]) element.disabled = !script;
  for (const summary of $$('.editor-toolbar summary')) {
    summary.setAttribute('aria-disabled', String(!script));
    summary.tabIndex = script ? 0 : -1;
  }
  renderScripts();
  updateDocument(false);
  if (focus) title.focus();
}

function addScript(titleText = '', content = '') {
  const script = newScript(titleText, content);
  scripts.unshift(script);
  search.value = '';
  markChanged(true);
  selectScript(script.id, { focus: !titleText });
}

function emptyFallback() {
  return [...scripts].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]?.id || '';
}

function updateDocument(preserve) {
  model = buildScript(body.value, tags);
  docRevision++;
  publishDocument();
  playback.load(model, preserve);
  $('#word-count').textContent = formatter.format(model.words) + (model.words === 1 ? ' mot' : ' mots');
  const seconds = Math.round(model.words / 145 * 60);
  const duration = seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
  $('#read-time').textContent = '≈ ' + duration + ' de lecture';
  $('#open-clean').disabled = !body.value;
  $('#reset-position').disabled = !model.tokens.length;
  progress.disabled = !model.tokens.length;
}

function publishDocument() {
  preview.setDocument(body.value, tags, settings, model);
  bridge.sync({ type: 'document', revision: docRevision, text: body.value, tags, settings });
}

function renderFrame(frame) {
  preview.render(frame, frame.instant);
  bridge.sync({ type: 'frame', ...frame, revision: docRevision, sequence: ++frameSequence });
  const total = model.tokens.length;
  const ratio = total ? clamp(frame.position / total, 0, 1) : 0;
  const percent = `${Math.round(ratio * 100)} %`;
  progress.value = String(Math.round(ratio * 1000));
  fillRange(progress);
  progress.setAttribute('aria-valuetext', percent);
  $('#progress-label').textContent = percent;
  const active = playback.active;
  const label = active ? 'Pause' : frame.phase === 'done' ? 'Relire' : 'Démarrer';
  if ($('#play-label').textContent !== label) {
    $('#play-label').textContent = label;
    $('#play-icon').innerHTML = icon(active ? 'pause' : 'play');
  }
  $('#play').disabled = !total;
  $('#transport-light').dataset.phase = frame.phase;
  $('#transport-light').dataset.voiceWaiting = String(frame.voiceWaiting);
  const states = {
    countdown: `Départ dans ${frame.remaining} s`,
    starting: 'Activation du micro…',
    playing: frame.voiceWaiting ? 'En attente du texte' : settings.mode === 'voice' ? 'Suivi vocal en cours' : 'Lecture automatique',
    holding: 'Pause au repère', done: 'Lecture terminée'
  };
  const status = states[frame.phase] || (total ? (frame.position ? 'En pause' : 'Prêt à lire') : 'Ajoutez du texte pour commencer');
  if ($('#transport-message').textContent !== status) $('#transport-message').textContent = status;
  renderTestButton();
}

function fillRange(range) {
  const percent = (Number(range.value) - Number(range.min)) * 100 / (Number(range.max) - Number(range.min));
  range.style.setProperty('--fill', `${percent}%`);
}

function renderLevel(rms, peak) {
  meterRms = rms ? Math.max(rms, meterRms * 0.82) : 0;
  const db = 20 * Math.log10(Math.max(meterRms, 0.00001));
  const lit = Math.round(clamp((db + 58) / 58, 0, 1) * meter.length);
  for (const [i, item] of meter.entries()) item.classList.toggle('lit', i < lit || (i === meter.length - 1 && peak > .985));
  $('#mic-db').textContent = db > -60 ? `${Math.round(db)} dB` : '— dB';
}

function voiceStatus(message, tone = '', permission = false) {
  const status = $('#voice-status');
  status.textContent = message;
  status.dataset.tone = tone;
  $('#mic-privacy').hidden = !permission;
  renderTestButton();
}

function showTranscript(text) {
  if (transcript === text) return;
  transcript = text;
  const output = $('#transcript');
  output.hidden = !text;
  output.textContent = text ? '« ' + text + ' »' : '';
}

function renderTestButton() {
  const button = $('#test-mic');
  button.textContent = playback.testing ? 'Arrêter' : 'Tester';
  button.disabled = playback.active && settings.mode === 'voice';
}

async function refreshMics(announce) {
  const scan = ++deviceScan;
  let permissionStream;
  try {
    const enumerate = async () => (await navigator.mediaDevices.enumerateDevices())
      .filter(device => device.kind === 'audioinput' && !['', 'default', 'communications'].includes(device.deviceId));
    let devices = await enumerate();
    if (announce && !devices.length && !playback.capture.purpose) {
      permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      devices = await enumerate();
    }
    if (scan !== deviceScan) return;
    const found = devices.find(device => device.deviceId === settings.micDeviceId);
    const options = [new Option('Microphone système', '')];
    devices.forEach((device, i) => options.push(new Option(device.label || `Microphone ${i + 1}`, device.deviceId)));
    if (!found && settings.micDeviceId) {
      options.push(new Option((settings.micLabel || 'Micro sélectionné') + ' · indisponible', settings.micDeviceId));
    }
    microphone.replaceChildren(...options);
    microphone.value = settings.micDeviceId;
    if (announce) notify(devices.length ? `${devices.length} entrée${devices.length === 1 ? '' : 's'} audio disponible${devices.length === 1 ? '' : 's'}` : 'Branchez un micro ou cliquez sur Tester.');
  } catch (error) {
    if (announce && error.name === 'NotAllowedError') voiceStatus(
      'Microphone bloqué. Autorisez l’accès des applications de bureau dans Windows.', 'error', true
    );
    else if (announce) notify('La liste des microphones est inaccessible. Vérifiez que le micro est branché.');
  } finally {
    permissionStream?.getTracks().forEach(track => track.stop());
  }
}

function storeSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
  catch { notify('Les réglages n’ont pas pu être enregistrés.'); }
}

function setting(key, value) {
  if (settings[key] === value) return;
  if (key === 'mode') {
    playback.pause();
    playback.stopCapture();
    showTranscript('');
  }
  settings[key] = value;
  storeSettings();
  renderSettings();
  if (['noiseSuppression', 'autoGain'].includes(key)) playback.changeInput();
  else if (key !== 'obsHost') {
    publishDocument();
    playback.emit(true);
  }
}

function renderSettings() {
  for (const input of $$('[data-setting]')) {
    const key = input.dataset.setting;
    if (input.type === 'checkbox') input.checked = settings[key];
    else if (input !== document.activeElement || input.type !== 'text') input.value = String(settings[key]);
    if (input.type === 'range') fillRange(input);
  }
  const format = {
    pace: value => `${value} mots/min`,
    fontSize: value => `${value} px`,
    lineWidth: value => `${value} %`,
    opacity: value => `${Math.round(value * 100)} %`,
    lineHeight: value => value.toLocaleString('fr', { maximumFractionDigits: 2 }),
    focusOffset: value => `${value} %`,
    fontWeight: value => String(value),
    letterSpacing: value => `${value} px`,
    lookahead: value => `${value} mot${value === 1 ? '' : 's'}`
  };
  for (const output of $$('[data-value]')) {
    output.textContent = format[output.dataset.value](settings[output.dataset.value]);
  }
  for (const button of $$('[data-mode]')) button.setAttribute('aria-pressed', String(settings.mode === button.dataset.mode));
  $('#voice-controls').hidden = settings.mode !== 'voice';
  $('#auto-controls').hidden = settings.mode !== 'auto';
  $('#custom-colors').hidden = settings.theme !== 'custom';
}

function showTab(name, focus = false) {
  for (const tab of $$('[data-tab]')) {
    const open = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(open));
    tab.tabIndex = open ? 0 : -1;
    $('#' + tab.getAttribute('aria-controls')).hidden = !open;
    if (open && focus) tab.focus();
  }
}

function openSettings(tab = 'display') {
  $('#cue-menu').open = false;
  showTab(tab);
  if (!$('#settings-dialog').open) $('#settings-dialog').showModal();
}

function insertCue(name) {
  const code = `[${name}]`;
  if (!getScript()) return;
  $('#cue-menu').open = false;
  const from = body.selectionStart;
  const to = body.selectionEnd;
  const before = from > 0 && /\S/.test(body.value[from - 1]) ? ' ' : '';
  const after = to < body.value.length && /\S/.test(body.value[to]) ? ' ' : '';
  if (body.value.length - (to - from) + before.length + code.length + after.length > body.maxLength) return;
  body.focus();
  if (!document.execCommand('insertText', false, before + code + after)) {
    body.setRangeText(before + code + after, from, to, 'end');
  }
  updateCurrent();
}

function changeTags(next, rename, synced = false) {
  try { saveTags(next); }
  catch { notify('Impossible d’enregistrer les repères.'); return false; }
  tags = next;
  if (rename?.[0]) {
    for (const script of scripts) {
      const text = script.content.replaceAll('[' + rename[0] + ']', rename[1] ? '[' + rename[1] + ']' : '');
      if (text !== script.content) {
        script.content = text;
        script.updatedAt = Math.max(Date.now(), (script.updatedAt || 0) + 1);
        dirty = true;
      }
    }
    body.value = getScript()?.content || '';
    persist();
  }
  if (!synced) {
    tagStamp = Math.max(Date.now(), tagStamp + 1);
    try { localStorage.setItem(TAG_STAMP_KEY, String(tagStamp)); } catch {}
    integrations.schedule();
  }
  updateDocument(true);
  return true;
}

function syncSnapshot() {
  persist();
  return {
    stamp: tagStamp,
    payload: {
      scripts: scripts.concat(Object.values(deleted)),
      ...(tagStamp ? { tags } : {}),
      settings: { theme: settings.theme, fontFamily: settings.fontFamily }
    }
  };
}

function mergeSync(result, sent) {
  if (!Array.isArray(result.scripts)) throw new Error('La réponse de synchronisation est incomplète.');
  const byId = new Map(scripts.map(script => [script.id, script]));
  const remote = new Set();
  for (const script of result.scripts.filter(isScript)) {
    remote.add(script.id);
    const current = byId.get(script.id);
    const tombstone = Object.hasOwn(deleted, script.id) ? deleted[script.id] : null;
    if (tombstone && (script.updatedAt || 0) <= tombstone.updatedAt) continue;
    if (tombstone) delete deleted[script.id];
    if (!current || (script.updatedAt || 0) > (current.updatedAt || 0)) byId.set(script.id, script);
  }
  for (const item of sent.payload.scripts) {
    if (item.deleted && deleted[item.id]?.updatedAt === item.updatedAt && !remote.has(item.id)) delete deleted[item.id];
  }
  scripts = [...byId.values()];
  dirty = true;
  persist();
  const active = getScript();
  if (!active) selectScript(emptyFallback(), { reload: true });
  else if (body.value !== active.content || title.value !== active.title) selectScript(active.id, { reload: true });
  else renderScripts();
  if (sent.stamp && tagStamp === sent.stamp) {
    tagStamp = 0;
    try { localStorage.removeItem(TAG_STAMP_KEY); } catch {}
  }
  if (!tagStamp && Array.isArray(result.tags)) {
    const received = normalizeTags(result.tags);
    if (JSON.stringify(received) !== JSON.stringify(tags) && changeTags(received, null, true)) cues.render();
  }
}

async function importFiles() {
  try {
    const files = await bridge.importFiles();
    if (!files.length) return;
    const incoming = files.map(file => {
      try { return readImport(file); }
      catch (error) { throw new Error(`${file.name} · ${error.message}`); }
    });
    const imported = incoming.flatMap(batch => batch.scripts);
    if (!imported.length) { notify('Aucun script dans cette sauvegarde.'); return; }
    scripts.unshift(...imported);
    search.value = '';
    markChanged(true);
    selectScript(imported[0].id);
    const combined = normalizeTags(tags.concat(...incoming.map(batch => Array.isArray(batch.tags) ? batch.tags : [])));
    if (combined.length !== tags.length && changeTags(combined)) cues.render();
    if (!dirty) notify(`${imported.length} script${imported.length === 1 ? ' importé' : 's importés'}`);
    else notify('Import ouvert. Exportez une sauvegarde pour le conserver.');
  } catch (error) {
    notify(error.message.replace(/^Error invoking remote method .*?: Error: /, ''));
  }
}

async function exportFile(options) {
  try {
    if (await bridge.exportFile(options)) {
      if ($('#settings-dialog').open) $('#settings-dialog').close();
      notify('Export terminé.');
    }
  } catch (error) { notify(error.message.replace(/^Error invoking remote method .*?: Error: /, '')); }
}

function positionAtCaret() {
  playback.seek(buildScript(body.value.slice(0, body.selectionStart), tags).tokens.length);
  if (model.tokens.length) notify('Lecture positionnée au curseur.');
}

function cleanPreview() {
  const before = $('#clean-before').value;
  const after = cleanScript(before, {
    timestamps: $('#clean-time').checked, formatting: $('#clean-format').checked, spacing: $('#clean-space').checked
  });
  $('#clean-after').value = after;
  $('#apply-clean').disabled = before === after;
  const diff = before.length - after.length;
  $('#clean-delta').textContent = before === after ? 'Le texte est déjà propre.'
    : diff > 0 ? `${formatter.format(diff)} caractère${diff === 1 ? '' : 's'} retiré${diff === 1 ? '' : 's'}.` : 'Aperçu mis à jour.';
}

async function openReader(fullscreen = false) {
  try {
    await bridge.openReader();
    if (fullscreen) await bridge.readerCommand('fullscreen');
  } catch { notify('Impossible d’ouvrir le prompteur.'); }
}

function updateReaderStatus(status) {
  if (indicator.open && !status.open && playback.active) playback.pause();
  indicator = status;
  $('#open-reader-label').textContent = status.open ? 'Afficher le prompteur' : 'Ouvrir le prompteur';
}

function command(action) {
  switch (action) {
    case 'play': playback.toggle(); break;
    case 'pause': playback.pause(); break;
    case 'reset': playback.seek(0); break;
    case 'pin': setting('alwaysTop', !settings.alwaysTop); break;
    case 'font-up': setting('fontSize', clamp(settings.fontSize + 3, 18, 120)); break;
    case 'font-down': setting('fontSize', clamp(settings.fontSize - 3, 18, 120)); break;
    case 'speed-up': setting('pace', clamp(settings.pace + 10, 65, 320)); break;
    case 'speed-down': setting('pace', clamp(settings.pace - 10, 65, 320)); break;
  }
}

bridge.onSync(message => {
  if (message.type === 'command') command(message.command);
  if (message.type === 'seek' && message.revision === docRevision) playback.seek(message.position);
});
bridge.onReaderStatus(updateReaderStatus);
bridge.snapshot().then(value => updateReaderStatus(value.status));

title.addEventListener('input', updateCurrent);
body.addEventListener('input', updateCurrent);
search.addEventListener('input', renderScripts);
$('#new-script').addEventListener('click', () => addScript());
$('#import-script').addEventListener('click', importFiles);
$('#open-reader').addEventListener('click', () => openReader());
$('#play').addEventListener('click', () => playback.toggle());
$('#reset-position').addEventListener('click', () => playback.seek(0));
progress.addEventListener('input', () => playback.seek(Number(progress.value) / 1000 * model.tokens.length));
$('#test-mic').addEventListener('click', () => { playback.testMic(); renderTestButton(); });
$('#refresh-mics').addEventListener('click', () => refreshMics(true));
$('#mic-privacy').addEventListener('click', () => bridge.microphonePrivacy().catch(() => notify('Ouvrez les réglages de confidentialité du microphone dans Windows.')));
microphone.addEventListener('change', () => {
  settings.micDeviceId = microphone.value;
  settings.micLabel = microphone.selectedOptions[0]?.textContent || '';
  storeSettings();
  if (playback.capture.purpose) playback.changeInput();
  else voiceStatus('Microphone en veille');
});
navigator.mediaDevices?.addEventListener('devicechange', () => refreshMics(false));

for (const button of $$('[data-mode]')) button.addEventListener('click', () => setting('mode', button.dataset.mode));
for (const input of $$('[data-setting]')) {
  input.addEventListener(input.type === 'range' ? 'input' : 'change', () => {
    const value = input.type === 'checkbox' ? input.checked
      : input.type === 'range' || input.hasAttribute('data-number') ? Number(input.value) : input.value;
    setting(input.dataset.setting, value);
  });
}

$('#open-settings').addEventListener('click', () => openSettings());
$('#display-settings').addEventListener('click', () => openSettings());
$('#font-smaller').addEventListener('click', () => command('font-down'));
$('#font-larger').addEventListener('click', () => command('font-up'));
$('#add-cue').addEventListener('open-cues', () => openSettings('cues'));
$('#open-shortcuts').addEventListener('click', () => $('#shortcuts-dialog').showModal());
for (const button of $$('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
for (const tab of $$('[data-tab]')) {
  tab.addEventListener('click', () => showTab(tab.dataset.tab));
  tab.addEventListener('keydown', event => {
    const tabs = $$('[data-tab]');
    const cursor = tabs.indexOf(tab);
    const advance = { ArrowLeft: -1, ArrowRight: 1, Home: -cursor, End: tabs.length - 1 - cursor };
    if (!Object.hasOwn(advance, event.key)) return;
    event.preventDefault();
    const next = (cursor + advance[event.key] + tabs.length) % tabs.length;
    showTab(tabs[next].dataset.tab, true);
  });
}

document.addEventListener('click', event => {
  for (const menu of $$('.dropdown')) {
    if (!menu.contains(event.target) || event.target.closest('.menu-popover button')) menu.open = false;
    if (!getScript() && menu.querySelector('summary').contains(event.target)) event.preventDefault();
  }
});

$('#start-at-cursor').addEventListener('click', positionAtCaret);
$('#duplicate-script').addEventListener('click', () => {
  const active = getScript();
  if (active) addScript(((active.title || 'Script') + ' – copie').slice(0, 160), active.content);
});
$('#export-script').addEventListener('click', () => {
  const active = getScript();
  if (active) exportFile({ name: active.title, text: active.content, format: 'txt' });
});
$('#export-library').addEventListener('click', () => exportFile({
  name: 'Sauvegarde NovaPrompter', format: 'json',
  text: JSON.stringify({ format: 'NovaPrompter', scripts, tags }, null, 2)
}));
$('#ask-delete').addEventListener('click', () => {
  const active = getScript();
  if (!active) return;
  $('#delete-name').textContent = active.title || 'Script sans titre';
  $('#delete-dialog').showModal();
});
$('#delete-script').addEventListener('click', () => {
  const active = getScript();
  if (!active) return;
  const removedAt = Math.max(Date.now(), (active.updatedAt || 0) + 1);
  deleted[active.id] = { id: active.id, title: '', content: '', updatedAt: removedAt, deleted: true };
  scripts = scripts.filter(script => script.id !== active.id);
  markChanged(true);
  selectScript(emptyFallback(), { reload: true });
  $('#delete-dialog').close();
  notify('Script supprimé.', () => {
    active.updatedAt = Math.max(Date.now(), removedAt + 1);
    delete deleted[active.id];
    scripts.unshift(active);
    markChanged(true);
    selectScript(active.id);
  });
});
$('#open-clean').addEventListener('click', () => {
  $('#clean-before').value = body.value;
  cleanPreview();
  $('#clean-dialog').showModal();
});
for (const id of ['clean-time', 'clean-format', 'clean-space']) $(`#${id}`).addEventListener('change', cleanPreview);
$('#apply-clean').addEventListener('click', () => {
  const before = $('#clean-before').value;
  const cleaned = $('#clean-after').value;
  const id = selected;
  $('#clean-dialog').close();
  if (body.value !== before || cleaned === before) return;
  body.value = cleaned;
  updateCurrent();
  notify('Nettoyage appliqué.', () => {
    const script = scripts.find(item => item.id === id);
    if (!script || script.content !== cleaned) { notify('Le script a été modifié depuis le nettoyage.'); return; }
    script.content = before;
    script.updatedAt = Math.max(Date.now(), script.updatedAt + 1);
    markChanged(true);
    if (selected === id) selectScript(id, { reload: true });
  });
});

window.addEventListener('keydown', event => {
  if ($$('dialog[open]').length) return;
  const { key } = event;
  if (key === 'Escape') {
    const menus = $$('.dropdown[open]');
    if (menus.length) { for (const menu of menus) menu.open = false; return; }
    if (playback.active) playback.pause();
    return;
  }
  if (event.ctrlKey && !event.altKey) {
    if (key.toLowerCase() === 'n') addScript();
    else if (key.toLowerCase() === 'o') importFiles();
    else if (key.toLowerCase() === 's') notify(persist() ? 'Script enregistré.' : 'Le stockage est plein. Exportez le script pour le conserver.');
    else if (key === 'Enter') positionAtCaret();
    else if (key === ',') openSettings();
    else return;
    event.preventDefault();
    return;
  }
  if (event.altKey || event.metaKey) return;
  if (key === 'F11') { event.preventDefault(); openReader(true); return; }
  if (event.target.closest('input,textarea,select,summary,button,[contenteditable=true]')) return;
  const commands = {
    ' ': 'play', MediaPlayPause: 'play', AudioPlay: 'play', r: 'reset', R: 'reset',
    '+': 'font-up', '=': 'font-up', '-': 'font-down',
    MediaTrackNext: 'speed-up', MediaTrackPrevious: 'speed-down'
  };
  if (Object.hasOwn(commands, key)) { event.preventDefault(); command(commands[key]); }
});

window.addEventListener('blur', persist);
window.addEventListener('pagehide', () => { persist(); playback.dispose(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });

if (![...$('#reader-font').options].some(option => option.value === settings.fontFamily)) {
  $('#reader-font').add(new Option(settings.fontFamily, settings.fontFamily));
}
renderSettings();
selectScript(getScript()?.id || emptyFallback(), { reload: true });
refreshMics(false);
