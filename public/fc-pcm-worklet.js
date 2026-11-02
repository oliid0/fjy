/* global sampleRate */
// Audio runs off the UI thread; cloud capture uses 100 ms, offline uses 500 ms.
class FcboardPCM extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const duration =
      options?.processorOptions?.blockDuration === 0.1 ? 0.1 : 0.5;
    this.targetRate =
      options?.processorOptions?.targetSampleRate === 16000
        ? 16000
        : sampleRate;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.buffer = new Float32Array(Math.round(this.targetRate * duration));
    this.offset = 0;
    this.port.onmessage = ({ data }) => {
      if (data === "flush") {
        this.flush();
        this.port.postMessage({ flushed: true });
      }
    };
  }
  flush() {
    if (!this.offset) {
      return;
    }
    const pcm = this.buffer.slice(0, this.offset);
    this.port.postMessage({ pcm, sampleRate: this.targetRate }, [pcm.buffer]);
    this.offset = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) {
      return true;
    }
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) {
        value += channel[i];
      }
      this.sum += value / channels.length;
      this.count++;
      this.phase += this.targetRate;
      if (this.phase >= sampleRate) {
        const averaged = this.sum / this.count;
        while (this.phase >= sampleRate) {
          this.buffer[this.offset++] = averaged;
          this.phase -= sampleRate;
          if (this.offset === this.buffer.length) {
            this.flush();
          }
        }
        this.sum = 0;
        this.count = 0;
      }
    }
    return true;
  }
}
registerProcessor("fcboard-pcm", FcboardPCM);
