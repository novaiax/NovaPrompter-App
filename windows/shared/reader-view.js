import { buildScript, clamp } from './script-model.js';
import { themes } from './settings.js';

export class ReaderView {
  constructor(host, { preview = false, onSeek } = {}) {
    this.host = host;
    this.preview = preview;
    this.onSeek = onSeek;
    host.innerHTML = '<div class="reader-guide" aria-hidden="true"><span></span><span></span></div>'
      + '<div class="reading-mask"><div class="reading-copy"></div></div>'
      + '<p class="reader-empty">Votre texte s’affichera ici</p>'
      + '<div class="reader-countdown" aria-hidden="true" hidden></div>';
    this.copy = host.querySelector('.reading-copy');
    this.count = host.querySelector('.reader-countdown');
    this.empty = host.querySelector('.reader-empty');
    this.words = [];
    this.lines = [];
    this.frame = { position: 0 };
    new ResizeObserver(() => this.measure()).observe(host);
    document.fonts.ready.then(() => this.measure());

    this.copy.addEventListener('click', event => {
      const word = event.target.closest('[data-word]');
      if (word) this.onSeek?.(Number(word.dataset.word));
    });
  }

  setDocument(text, tags, settings, sourceModel) {
    const rebuild = text !== this.text || JSON.stringify(tags) !== this.tagKey;
    this.text = text;
    this.tagKey = JSON.stringify(tags);
    this.settings = settings;
    const palette = settings.theme === 'custom'
      ? { bg: settings.colorBg, fg: settings.colorFg }
      : themes[settings.theme] || themes.dark;
    const p = this.host.style;
    const values = {
      '--reader-bg': palette.bg, '--reader-fg': palette.fg,
      '--read-width': `${settings.lineWidth}%`, '--read-focus': `${settings.focusOffset}%`,
      '--read-family': `"${settings.fontFamily.replace(/[^\p{L}\p{N} _-]/gu, '')}", Lexend, sans-serif`,
      '--read-weight': settings.fontWeight, '--read-line': settings.lineHeight,
      '--read-spacing': `${settings.letterSpacing}px`,
      '--flip-x': settings.mirrorH ? -1 : 1, '--flip-y': settings.mirrorV ? -1 : 1,
      '--read-align': settings.alignLeft ? 'left' : 'center'
    };
    for (const [name, value] of Object.entries(values)) p.setProperty(name, value);
    this.host.classList.toggle('show-guide', settings.showGuide);
    this.host.classList.toggle('is-voice', settings.mode === 'voice');
    this.host.classList.toggle('light-reader', parseInt(palette.bg.slice(1, 3), 16) > 155);
    if (rebuild) this.populate(sourceModel || buildScript(text, tags));
    this.measure();
    document.fonts.load(`${settings.fontWeight} 24px ${values['--read-family']}`)
      .then(() => this.measure()).catch(() => {});
  }

  populate(model) {
    this.model = model;
    this.words = [];
    this.marked = -1;
    this.past = 0;
    const fragment = document.createDocumentFragment();
    for (const part of model.parts) {
      if (!part.cue && part.start === undefined) {
        fragment.append(part.text);
        continue;
      }
      const span = document.createElement('span');
      if (part.cue) {
        span.className = 'reading-cue';
        span.textContent = part.cue.label;
        span.style.color = part.cue.color;
        span.style.backgroundColor = part.cue.bgColor;
        span.style.fontSize = `${part.cue.fontSize || 1}em`;
        span.dataset.cue = part.start;
      } else {
        span.className = 'reading-word';
        span.textContent = part.text;
        span.dataset.word = part.start;
        this.words.push({ element: span, start: part.start, end: part.end });
      }
      fragment.append(span);
    }
    this.copy.replaceChildren(fragment);
    this.empty.hidden = Boolean(this.text.trim());
  }

  measure() {
    if (!this.settings || !this.host.clientHeight) return;
    const { fontSize } = this.settings;
    const scale = this.preview ? clamp(this.host.clientWidth / 720, 0.33, 0.77) : 1;
    this.host.style.setProperty('--read-size', `${fontSize * scale}px`);
    const lines = [];
    for (const word of this.words) {
      // offsetTop is unaffected by mirroring and animation.
      const top = word.element.offsetTop;
      const previous = lines.at(-1);
      if (previous && Math.abs(previous.top - top) <= 3) {
        previous.end = word.end;
      } else {
        lines.push({ at: word.start, end: word.end, top, y: top + word.element.offsetHeight / 2 });
      }
    }
    this.lines = lines;
    this.focus = this.host.clientHeight * this.settings.focusOffset / 100;
    this.render(this.frame, true);
  }

  lineAt(position) {
    let left = 0;
    let right = this.lines.length - 1;
    while (left < right) {
      const middle = Math.ceil((left + right) / 2);
      if (this.lines[middle].at <= position) left = middle;
      else right = middle - 1;
    }
    return left;
  }

  scrollLines(amount) {
    if (!this.lines.length) return;
    const index = this.lineAt(this.frame.position);
    const target = index + amount;
    const next = target >= this.lines.length ? this.model.tokens.length
      : this.lines[Math.max(0, target)].at;
    this.onSeek?.(next);
  }

  render(frame, instant = false) {
    this.frame = frame;
    this.count.hidden = frame.phase !== 'countdown';
    this.count.textContent = this.count.hidden ? '' : String(frame.remaining);
    if (!this.settings) return;

    const position = frame.position;
    const voice = this.settings.mode === 'voice';
    const activePosition = position + (voice ? this.settings.lookahead : 0);
    const index = this.lineAt(activePosition);
    const line = this.lines[index];
    let y = line?.y || 0;
    const next = this.lines[index + 1];
    if (!voice && next && line) {
      const fraction = clamp((position - line.at) / (next.at - line.at), 0, 1);
      y += (next.y - y) * fraction;
    }
    this.copy.style.transitionDuration = instant ? '0ms' : (voice ? '180ms' : '65ms');
    const flip = this.settings.mirrorV ? -1 : 1;
    this.copy.style.setProperty('--read-y', `${(this.focus || 0) - flip * y}px`);
    this.highlight(voice ? position : 0, voice);
  }

  highlight(position, enabled) {
    while (this.past < this.words.length && this.words[this.past].end <= position) {
      this.words[this.past++].element.classList.add('past');
    }
    while (this.past > 0 && this.words[this.past - 1].end > position) {
      this.words[--this.past].element.classList.remove('past');
    }
    const want = enabled && this.past < this.words.length ? this.past : -1;
    if (want !== this.marked) {
      this.words[this.marked]?.element.classList.remove('current');
      this.words[want]?.element.classList.add('current');
      this.marked = want;
    }
  }
}
