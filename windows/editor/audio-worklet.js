class PrompterPCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkLength = Math.round(sampleRate * 0.065);
    this.buffer = new Int16Array(this.chunkLength);
    this.offset = 0;
    this.energy = 0;
    this.peak = 0;
  }

  process(inputs) {
    const mono = inputs[0]?.[0];
    if (!mono) return true;
    for (const sample of mono) {
      const value = Math.max(-1, Math.min(1, sample));
      this.buffer[this.offset++] = value < 0 ? value * 32768 : value * 32767;
      this.energy += value * value;
      this.peak = Math.max(this.peak, Math.abs(value));
      if (this.offset === this.chunkLength) {
        this.port.postMessage({
          bytes: this.buffer.buffer,
          rms: Math.sqrt(this.energy / this.chunkLength),
          peak: this.peak
        }, [this.buffer.buffer]);
        this.buffer = new Int16Array(this.chunkLength);
        this.offset = this.energy = this.peak = 0;
      }
    }
    return true;
  }
}

registerProcessor('prompter-pcm', PrompterPCM);
