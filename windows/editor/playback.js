import { clamp } from '../shared/script-model.js';
import { VoiceAlignment } from '../shared/alignment.js';
import { VoiceCapture } from './voice_vosk.js';

const activePhases = new Set(['starting', 'countdown', 'playing', 'holding']);

export class Playback {
  constructor(bridge, settings, { onFrame, onLevel, onVoice, onTranscript, onDevice }) {
    Object.assign(this, { settings, onFrame, onLevel, onVoice, onTranscript, onDevice });
    this.phase = 'idle';
    this.position = 0;
    this.alignment = new VoiceAlignment();
    this.capture = new VoiceCapture(bridge, {
      onLevel: (rms, peak) => this.level(rms, peak),
      onReady: (purpose, label) => this.ready(purpose, label),
      onError: (message, permission) => this.error(message, permission),
      onTranscript: message => this.transcript(message),
      onResync: () => this.resync()
    });
    this.timer = setInterval(() => this.tick(performance.now()), 42);
  }

  get active() { return activePhases.has(this.phase); }
  get testing() { return this.capture.purpose === 'test'; }
  get length() { return this.model?.tokens.length || 0; }

  load(model, preserve) {
    this.pause();
    this.model = model;
    this.seek(preserve ? this.position : 0);
  }

  emit(instant = false) {
    this.onFrame({
      position: this.position, phase: this.phase, instant,
      remaining: this.remaining, cueAt: this.cueAt,
      voiceWaiting: this.phase === 'playing' && this.settings.mode === 'voice' && this.alignment.waiting
    });
  }

  phaseTo(phase) {
    this.phase = phase;
    this.emit();
  }

  toggle() {
    if (this.active) this.pause();
    else this.play();
  }

  play() {
    if (!this.length || this.active) return;
    this.stopCapture();
    if (this.position >= this.length) this.seek(0);
    if (this.settings.countdown) {
      this.remaining = this.settings.countdown;
      this.until = performance.now() + this.remaining * 1000;
      this.phaseTo('countdown');
    } else this.begin();
  }

  begin() {
    if (this.settings.mode === 'voice') this.startCapture('voice');
    else {
      this.lastTick = performance.now();
      this.phaseTo('playing');
    }
  }

  pause(message) {
    const wasActive = this.active;
    if (!this.testing) this.stopCapture(message);
    this.phase = 'idle';
    this.cueAt = undefined;
    this.remaining = undefined;
    if (wasActive) this.emit();
  }

  seek(position) {
    if (!Number.isFinite(position)) return;
    this.position = clamp(Math.round(position), 0, this.length);
    this.pauseIndex = (this.model?.pauses.length || 0);
    const next = this.model?.pauses.findIndex(cue => cue.at >= this.position);
    if (next >= 0) this.pauseIndex = next;
    this.alignment.reset(this.position);
    this.capture.seek();
    this.onTranscript('');
    if (this.position >= this.length && this.active) {
      this.complete();
    } else {
      if (this.phase === 'done') this.phase = 'idle';
      if (this.phase === 'holding') this.phase = 'playing';
      this.cueAt = undefined;
      this.lastTick = performance.now();
      this.emit(true);
    }
  }

  complete() {
    this.cueAt = undefined;
    this.stopCapture();
    this.phaseTo('done');
  }

  tick(now) {
    if (this.phase === 'countdown') {
      const left = Math.ceil((this.until - now) / 1000);
      if (left <= 0) this.begin();
      else if (left !== this.remaining) { this.remaining = left; this.emit(); }
      return;
    }
    if (this.settings.mode !== 'auto') return;
    if (this.phase === 'holding' && now >= this.until) {
      this.lastTick = now;
      this.cueAt = undefined;
      this.phaseTo('playing');
    }
    if (this.phase !== 'playing') return;
    const dt = clamp((now - this.lastTick) / 1000, 0, 0.2);
    this.lastTick = now;
    const rate = this.settings.pace * (this.length / Math.max(1, this.model.words)) / 60;
    const target = Math.min(this.length, this.position + dt * rate);
    const cue = this.model.pauses[this.pauseIndex];
    if (cue && target >= cue.at) {
      this.position = cue.at;
      this.pauseIndex++;
      this.cueAt = cue.at;
      this.until = now + cue.seconds * 1000;
      this.phaseTo('holding');
    } else {
      this.position = target;
      if (this.position >= this.length) this.complete();
      else this.emit();
    }
  }

  changeInput() {
    if (this.capture.purpose) this.startCapture(this.capture.purpose);
  }

  stopCapture(message = 'Microphone en veille') {
    this.capture.stop();
    this.listening = false;
    this.setVoice(message);
  }

  startCapture(purpose) {
    this.listening = false;
    this.lastSignal = performance.now();
    this.alignment.reset(this.position);
    this.onTranscript('');
    this.capture.start(purpose, this.settings);
    this.setVoice('Connexion au microphone…');
    if (purpose === 'voice') this.phaseTo('starting');
  }

  testMic() {
    if (this.active) return;
    if (this.testing) this.stopCapture();
    else this.startCapture('test');
  }

  ready(purpose, label) {
    this.listening = true;
    this.onDevice(label);
    this.lastSignal = performance.now();
    this.setVoice(purpose === 'test' ? 'Microphone actif · parlez pour vérifier le niveau' : 'À l’écoute', 'good');
    if (purpose === 'voice') this.phaseTo('playing');
  }

  level(rms, peak) {
    this.onLevel(rms, peak);
    if (!this.listening || !this.capture.purpose) return;
    const now = performance.now();
    if (rms > .004) this.lastSignal = now;
    const normal = this.capture.purpose === 'test' ? 'Test du microphone en cours' : 'À l’écoute';
    if (peak >= .985) this.setVoice('Signal élevé · baissez le niveau d’entrée si nécessaire', 'warn');
    else if (now - this.lastSignal > 2500) this.setVoice('Aucun signal détecté · vérifiez l’entrée ou parlez', 'warn');
    else if (rms > .004) {
      if (this.capture.purpose === 'voice') this.followStatus();
      else this.setVoice(normal, 'good');
    }
  }

  setVoice(message, tone = '', permission = false) {
    if (this.voiceMessage === message && this.voicePermission === permission) return;
    this.voiceMessage = message;
    this.voicePermission = permission;
    this.onVoice(message, tone, permission);
  }

  error(message, permission) {
    this.listening = false;
    this.phaseTo('idle');
    this.setVoice(message, 'error', permission);
  }

  followStatus() {
    if (this.alignment.waiting) this.setVoice('En attente du texte · le micro reste actif', 'warn');
    else this.setVoice('À l’écoute', 'good');
  }

  resync() {
    if (this.phase !== 'playing' || this.settings.mode !== 'voice') return;
    this.alignment.resync();
    this.onTranscript('');
    this.followStatus();
    this.emit();
  }

  transcript({ text, final }) {
    if (this.phase !== 'playing' || this.settings.mode !== 'voice') return;
    if (text) this.onTranscript(text);
    const wasWaiting = this.alignment.waiting;
    const next = this.alignment.update(this.model.tokens, text, final);
    const moved = next > this.position;
    this.position = next;
    if (moved && next >= this.length) this.complete();
    else if (moved || wasWaiting !== this.alignment.waiting) {
      this.followStatus();
      this.emit();
    }
  }

  dispose() {
    clearInterval(this.timer);
    this.capture.stop();
  }
}
