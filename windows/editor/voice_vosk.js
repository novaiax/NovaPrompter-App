export class VoiceCapture {
  constructor(bridge, { onLevel, onReady, onError, onTranscript, onResync }) {
    this.bridge = bridge;
    this.onLevel = onLevel;
    this.onReady = onReady;
    this.onError = onError;
    this.onTranscript = onTranscript;
    bridge.onSpeech(message => {
      const run = this.run;
      if (!run || run.session !== message.session) return;
      if (message.type === 'error') this.fail(run, new Error(message.detail));
      if (message.generation !== run.generation) return;
      if (message.type === 'transcript') this.onTranscript(message);
      if (message.type === 'resync') onResync();
    });
  }

  get purpose() {
    return this.run?.purpose;
  }

  async start(purpose, settings) {
    this.stop();
    const run = { session: crypto.randomUUID(), generation: 0, purpose };
    this.run = run;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          ...(settings.micDeviceId ? { deviceId: { exact: settings.micDeviceId } } : {}),
          channelCount: { ideal: 1 },
          echoCancellation: true,
          noiseSuppression: settings.noiseSuppression,
          autoGainControl: settings.autoGain
        }
      });
      if (this.run !== run) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      run.stream = stream;
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error('Aucun signal audio disponible.');
      track.addEventListener('ended', () => this.fail(run, new DOMException('', 'NotFoundError')));
      run.context = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
      const { context } = run;
      await context.audioWorklet.addModule(new URL('./audio-worklet.js', import.meta.url));
      if (this.run !== run) return;
      run.source = context.createMediaStreamSource(stream);
      run.node = new AudioWorkletNode(context, 'prompter-pcm', {
        channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1]
      });
      const silence = context.createGain();
      silence.gain.value = 0;
      run.node.port.onmessage = ({ data }) => {
        if (this.run !== run) return;
        this.onLevel(data.rms, data.peak);
        if (run.speechReady) {
          this.bridge.sendAudio({ session: run.session, generation: run.generation, bytes: data.bytes });
        }
      };
      run.node.onprocessorerror = () => this.fail(run, new Error('La capture du son s’est interrompue.'));
      if (purpose === 'voice') {
        run.speechRequested = true;
        run.speechReady = await this.bridge.startSpeech({
          session: run.session, generation: run.generation, sampleRate: context.sampleRate
        });
        if (this.run !== run || !run.speechReady) return;
      }
      // Keep the worklet in the graph with silent output. Connect only when
      // the recognizer is ready to receive the first words.
      run.source.connect(run.node).connect(silence).connect(context.destination);
      await context.resume();
      if (this.run !== run) return;
      this.onReady(purpose, track.label);
    } catch (error) {
      this.fail(run, error);
    }
  }

  seek() {
    const run = this.run;
    if (run?.purpose !== 'voice') return;
    run.generation++;
    if (run.speechRequested) this.bridge.seekSpeech({ session: run.session, generation: run.generation });
  }

  fail(run, error) {
    if (this.run !== run) return;
    const messages = {
      NotAllowedError: 'Microphone bloqué. Autorisez l’accès des applications de bureau dans Windows.',
      NotFoundError: 'Microphone indisponible ou débranché. Sélectionnez une autre entrée.',
      OverconstrainedError: 'Le micro sélectionné est indisponible. Choisissez une autre entrée.',
      NotReadableError: 'Le micro est indisponible. Vérifiez qu’une autre application ne l’utilise pas en exclusivité.',
      AbortError: 'La capture audio a été interrompue. Vérifiez le micro et réessayez.'
    };
    this.stop();
    const message = messages[error.name] || error.message.replace(/^Error invoking remote method .*?: Error: /, '');
    this.onError(message, error.name === 'NotAllowedError');
  }

  stop() {
    const run = this.run;
    if (!run) return;
    this.run = null;
    if (run.speechRequested) this.bridge.stopSpeech(run.session);
    if (run.node) {
      run.node.port.onmessage = null;
      run.node.disconnect();
    }
    run.source?.disconnect();
    run.stream?.getTracks().forEach(track => track.stop());
    run.context?.close().catch(() => {});
    this.onLevel(0, 0);
  }
}
