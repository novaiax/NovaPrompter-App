const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

// Keep the worker close to live audio. If the decoder falls behind, prefer
// a short fresh tail over delaying playback or closing the microphone.
const MAX_IN_FLIGHT = 4;
const BUFFERED_FRAMES = 20;
const RECENT_FRAMES = 9;

class Speech {
  constructor(directory, send) {
    this.directory = directory;
    this.send = send;
  }

  start({ session, generation, sampleRate }) {
    this.stop();
    if (!fs.existsSync(path.join(this.directory, 'model-fr', 'am', 'final.mdl'))) {
      throw new Error('Le modèle vocal français est absent. Réinstallez NovaPrompter.');
    }
    if (!this.worker) this.createWorker();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.fail('Le moteur vocal a mis trop de temps à démarrer.');
        this.dispose();
      }, 15_000);
      this.active = { session, generation, epoch: 0, inFlight: 0, pending: [], resolve, reject, timeout };
      this.worker.postMessage({ type: 'start', session, generation, epoch: 0, sampleRate });
    });
  }

  createWorker() {
    const worker = new Worker(path.join(__dirname, 'speech-worker.cjs'), {
      workerData: { directory: this.directory }
    });
    this.worker = worker;
    worker.on('message', message => {
      if (this.worker === worker) this.onMessage(message);
    });
    worker.on('error', () => {
      if (this.worker === worker) this.fail('Le moteur vocal n’a pas pu démarrer. Réessayez ou réinstallez l’application.');
    });
    worker.on('exit', () => {
      if (this.worker !== worker) return;
      this.worker = null;
      if (this.active) this.fail('Le moteur vocal s’est arrêté. Relancez la lecture pour réessayer.');
    });
  }

  onMessage(message) {
    const active = this.active;
    if (!active || message.session !== active.session) return;
    if (message.type === 'ready') {
      clearTimeout(active.timeout);
      active.resolve(true);
      active.ready = true;
      this.pump(active);
    } else if (message.type === 'ack') {
      active.inFlight = Math.max(0, active.inFlight - 1);
      this.pump(active);
    } else if (message.type === 'error') {
      this.fail('Le moteur vocal a rencontré une erreur. Réessayez ou réinstallez l’application.');
    } else if (message.generation === active.generation && message.epoch === active.epoch) {
      this.send(message);
    }
  }

  pump(active) {
    const { session, generation, epoch } = active;
    if (!active.ready) return;
    if (active.reset) {
      if (active.inFlight) return;
      this.worker.postMessage({ type: 'seek', session, generation, epoch });
      active.reset = false;
    }
    while (active.inFlight < MAX_IN_FLIGHT && active.pending.length) {
      const bytes = active.pending.shift();
      active.inFlight++;
      this.worker.postMessage({ type: 'audio', session, generation, epoch, bytes }, [bytes]);
    }
  }

  audio({ session, generation, bytes }) {
    const active = this.active;
    if (!active?.ready || session !== active.session || generation !== active.generation) return;
    active.pending.push(bytes);
    if (active.pending.length > BUFFERED_FRAMES) {
      active.pending.splice(0, active.pending.length - RECENT_FRAMES);
      if (!active.reset) {
        active.reset = true;
        active.epoch++;
        this.send({ type: 'resync', session, generation });
      }
    }
    this.pump(active);
  }

  seek({ session, generation }) {
    const active = this.active;
    if (active?.session !== session || !Number.isSafeInteger(generation) || generation <= active.generation) return;
    active.generation = generation;
    active.epoch++;
    active.pending.length = 0;
    active.reset = true;
    this.pump(active);
  }

  fail(detail) {
    if (!this.active) return;
    const { session, ready } = this.active;
    if (ready) this.send({ type: 'error', session, detail });
    this.stop(session, new Error(detail));
  }

  stop(session = this.active?.session, error) {
    const active = this.active;
    if (!active || session !== active.session) return;
    this.active = null;
    clearTimeout(active.timeout);
    if (!active.ready) {
      if (error) active.reject(error);
      else active.resolve(false);
    }
    this.worker?.postMessage({ type: 'stop', session });
  }

  dispose() {
    this.stop();
    const worker = this.worker;
    this.worker = null;
    worker?.terminate();
  }
}

module.exports = { Speech };
