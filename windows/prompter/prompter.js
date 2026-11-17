import { icon, paintIcons } from '../shared/icons.js';
import { ReaderView } from '../shared/reader-view.js';
import { normalizeSettings } from '../shared/settings.js';
import { clamp } from '../shared/script-model.js';

const $ = selector => document.querySelector(selector);
const bridge = window.nova;
const play = $('#btn-play');
const pin = $('#btn-pin');
let current = { position: 0, phase: 'idle', sequence: -1 };
let currentDocument = { revision: -1, settings: normalizeSettings() };
let status = {};
const labels = {
  idle: 'En pause', starting: 'Démarrage', countdown: 'Préparation',
  playing: 'En lecture', holding: 'Repère de pause', done: 'Terminé'
};
const reader = new ReaderView($('#stage'), { onSeek: seek });
reader.setDocument('', [], currentDocument.settings);
paintIcons();

function seek(position) {
  if (!reader.model?.tokens.length) return;
  const next = clamp(position, 0, reader.model.tokens.length);
  current = { ...current, position: next };
  update(current, true);
  bridge.sync({ type: 'seek', position: next, revision: currentDocument.revision });
}

function update(frame, instant) {
  current = frame;
  reader.render(frame, instant);
  document.body.dataset.phase = frame.phase;
  document.body.classList.toggle('voice-waiting', Boolean(frame.voiceWaiting));
  $('#reader-status').textContent = frame.voiceWaiting ? 'En attente du texte' : labels[frame.phase] || labels.idle;
  const pct = reader.model?.tokens.length ? Math.round(frame.position / reader.model.tokens.length * 100) : 0;
  $('#reader-percent').textContent = `${pct} %`;
  $('#reader-fill').style.width = `${pct}%`;
  const active = ['starting', 'countdown', 'playing', 'holding'].includes(frame.phase);
  const label = active ? 'Mettre en pause' : 'Démarrer la lecture';
  if (play.getAttribute('aria-label') !== label) {
    play.setAttribute('aria-label', label);
    play.innerHTML = icon(active ? 'pause' : 'play');
  }
}

function receive(message) {
  if (message.type === 'document' && message.revision >= currentDocument.revision) {
    currentDocument = message;
    reader.setDocument(message.text, message.tags, message.settings);
    $('#reader-mode').textContent = message.settings.mode === 'voice' ? 'Voix' : 'Auto';
    pin.setAttribute('aria-pressed', String(message.settings.alwaysTop));
  } else if (message.type === 'frame' && message.revision === currentDocument.revision
    && message.sequence >= current.sequence) {
    update(message, message.instant);
  }
}

function renderWindow(next) {
  status = next;
  const restore = next.maximized || next.fullScreen;
  const max = $('#btn-max');
  const label = restore ? 'Restaurer la fenêtre' : 'Agrandir';
  max.innerHTML = icon(restore ? 'restore' : 'maximize');
  max.setAttribute('aria-label', label);
  max.title = label;
  $('#btn-fullscreen').setAttribute('aria-pressed', String(Boolean(next.fullScreen)));
  document.body.classList.toggle('fullscreen', Boolean(next.fullScreen));
  document.body.classList.toggle('maximized', Boolean(next.maximized));
}

bridge.onSync(receive);
bridge.onReaderStatus(renderWindow);
bridge.snapshot().then(value => {
  if (value.document) receive(value.document);
  if (value.frame) receive(value.frame);
  renderWindow(value.status);
});

const action = command => bridge.sync({ type: 'command', command });
play.addEventListener('click', () => action('play'));
$('#btn-reset').addEventListener('click', () => action('reset'));
pin.addEventListener('click', () => action('pin'));
$('#btn-min').addEventListener('click', () => bridge.readerCommand('minimize'));
$('#btn-max').addEventListener('click', () => bridge.readerCommand('maximize'));
$('#btn-close').addEventListener('click', () => bridge.readerCommand('close'));
$('#btn-fullscreen').addEventListener('click', () => bridge.readerCommand('fullscreen'));

const grip = $('#resize-grip');
grip.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  grip.setPointerCapture(event.pointerId);
  bridge.resizeReader('begin');
});
grip.addEventListener('pointermove', event => {
  if (grip.hasPointerCapture(event.pointerId)) bridge.resizeReader('move');
});
grip.addEventListener('lostpointercapture', () => bridge.resizeReader('end'));
grip.addEventListener('keydown', event => {
  const axes = { ArrowLeft: 'narrower', ArrowRight: 'wider', ArrowUp: 'shorter', ArrowDown: 'taller' };
  if (!Object.hasOwn(axes, event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  bridge.resizeReader('step', axes[event.key]);
});

let wheel = 0;
$('#stage').addEventListener('wheel', event => {
  if (!event.deltaY) return;
  event.preventDefault();
  wheel += event.deltaMode ? event.deltaY * 38 : event.deltaY;
  if (Math.abs(wheel) < 33) return;
  reader.scrollLines(Math.sign(wheel) * Math.min(5, Math.max(1, Math.round(Math.abs(wheel) / 100))));
  wheel = 0;
}, { passive: false });

window.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const { key } = event;
  const editing = event.target.closest('button');
  if (key === ' ' && editing) return;
  const commands = {
    ' ': 'play', MediaPlayPause: 'play', AudioPlay: 'play', r: 'reset', R: 'reset',
    '+': 'font-up', '=': 'font-up', '-': 'font-down', MediaTrackNext: 'speed-up', MediaTrackPrevious: 'speed-down'
  };
  const lines = { ArrowUp: -1, ArrowDown: 1, PageUp: -4, PageDown: 4 };
  if (key in commands) action(commands[key]);
  else if (key in lines) reader.scrollLines(lines[key]);
  else if (key === 'ArrowLeft' || key === 'ArrowRight') seek(Math.round(current.position) + (key === 'ArrowLeft' ? -1 : 1));
  else if (key === 'Home') action('reset');
  else if (key === 'F11' || (key === 'Escape' && status.fullScreen)) bridge.readerCommand('fullscreen');
  else if (key === 'Escape') action('pause');
  else return;
  event.preventDefault();
});
