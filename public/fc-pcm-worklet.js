/* global sampleRate */
// Audio runs off the UI thread; cloud capture uses 100 ms, offline uses 500 ms.
class FcboardPCM extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const duration =
      options?.processorOptions?.blockDuration === 0.1 ? 0.1 : 0.5;
    this.buffer = new Float32Array(Math.round(sampleRate * duration));
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
    this.port.postMessage({ pcm, sampleRate }, [pcm.buffer]);
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
      this.buffer[this.offset++] = value / channels.length;
      if (this.offset === this.buffer.length) {
        this.flush();
      }
    }
    return true;
  }
}
registerProcessor("fcboard-pcm", FcboardPCM);
