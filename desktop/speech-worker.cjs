const { parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');
const koffi = require('koffi');

let native;
let model;
let recognizer;
let session;
let generation;
let epoch;
let lastPartial = '';
let chunksSincePartial = 0;

function loadModel() {
  if (model) return;
  // Resolve the official runtime dependencies from the same directory as Vosk.
  for (const dll of ['libwinpthread-1.dll', 'libgcc_s_seh-1.dll', 'libstdc++-6.dll']) {
    koffi.load(path.join(workerData.directory, dll));
  }
  const library = koffi.load(path.join(workerData.directory, 'libvosk.dll'));
  native = {
    model: library.func('void *vosk_model_new(const char *path)'),
    log: library.func('void vosk_set_log_level(int level)'),
    recognizer: library.func('void *vosk_recognizer_new(void *model, float sample_rate)'),
    free: library.func('void vosk_recognizer_free(void *recognizer)'),
    reset: library.func('void vosk_recognizer_reset(void *recognizer)'),
    accept: library.func('int vosk_recognizer_accept_waveform(void *recognizer, const uint8_t *data, int length)'),
    result: library.func('const char *vosk_recognizer_result(void *recognizer)'),
    partial: library.func('const char *vosk_recognizer_partial_result(void *recognizer)')
  };
  native.log(-1);
  model = native.model(path.join(workerData.directory, 'model-fr'));
  if (!model) throw new Error('Modèle vocal français introuvable ou endommagé.');
}

function releaseRecognizer() {
  if (recognizer) native.free(recognizer);
  recognizer = null;
  lastPartial = '';
  chunksSincePartial = 0;
}

parentPort.on('message', message => {
  const { type } = message;
  try {
    if (type === 'start') {
      releaseRecognizer();
      session = message.session;
      generation = message.generation;
      epoch = message.epoch;
      loadModel();
      recognizer = native.recognizer(model, message.sampleRate);
      if (!recognizer) throw new Error('Le moteur vocal n’a pas accepté le format du micro.');
      parentPort.postMessage({ type: 'ready', session });
    } else if (message.session === session && recognizer) {
      if (type === 'stop') releaseRecognizer();
      if (type === 'seek') {
        native.reset(recognizer);
        generation = message.generation;
        epoch = message.epoch;
        lastPartial = '';
        chunksSincePartial = 0;
      }
      if (type === 'audio' && generation === message.generation && epoch === message.epoch) {
        const bytes = new Uint8Array(message.bytes);
        const status = native.accept(recognizer, bytes, bytes.byteLength);
        if (status < 0) throw new Error('Le moteur vocal n’a pas pu traiter le signal.');
        const final = status === 1;
        if (!final && ++chunksSincePartial < 2) return;
        chunksSincePartial = 0;
        const result = JSON.parse(final ? native.result(recognizer) : native.partial(recognizer));
        const text = (final ? result.text : result.partial) || '';
        if (final || text !== lastPartial) {
          parentPort.postMessage({ type: 'transcript', session, generation, epoch, final, text });
        }
        lastPartial = final ? '' : text;
      }
    }
  } catch (error) {
    releaseRecognizer();
    parentPort.postMessage({ type: 'error', session, detail: error.message });
  } finally {
    if (type === 'audio') parentPort.postMessage({ type: 'ack', session: message.session });
  }
});
