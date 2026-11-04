/* global sampleRate */
// Audio runs off the UI thread: duplex 20 ms, cloud ASR 100 ms, offline 500 ms.
class FcboardPCM extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const requested = options?.processorOptions?.blockDuration;
    const duration = [0.02, 0.1, 0.5].includes(requested) ? requested : 0.5;
    this.outputRate = options?.processorOptions?.targetSampleRate || sampleRate;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.buffer = new Float32Array(Math.round(this.outputRate * duration));
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
    this.port.postMessage({ pcm, sampleRate: this.outputRate }, [pcm.buffer]);
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
      // Official duplex demo averages input samples when downsampling.
      // Keep the fractional phase between render quanta, so 44.1/48 kHz
      // devices produce exact 16 kHz frames without UI-thread resampling.
      this.sum += value / channels.length;
      this.count++;
      this.phase += this.outputRate;
      if (this.phase >= sampleRate) {
        const sample = this.sum / this.count;
        while (this.phase >= sampleRate) {
          this.buffer[this.offset++] = sample;
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
