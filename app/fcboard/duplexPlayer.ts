/** Seeduplex official web demo's PCM16 / 24 kHz WebAudio scheduling.
 * Keep sources so barge-in can stop queued audio without recreating a context. */
export const createDuplexPlayer = (changed: (playing: boolean) => void) => {
  let context: AudioContext;
  try {
    context = new AudioContext({ sampleRate: 24000 });
  } catch (failure) {
    if (
      !failure ||
      typeof failure !== "object" ||
      !("name" in failure) ||
      failure.name !== "NotSupportedError"
    ) {
      throw failure;
    }
    // The source buffers retain the protocol's 24 kHz rate; WebAudio resamples
    // them to a device context when its output cannot open at that rate.
    context = new AudioContext();
  }
  const ready = context.resume();
  void ready.catch(() => {});
  const sources = new Set<AudioBufferSourceNode>();
  let next = 0;
  let epoch = 0;
  let closed = false;
  let carry: number | undefined;
  const interrupt = () => {
    epoch++;
    for (const source of sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    sources.clear();
    carry = undefined;
    next = 0;
    changed(false);
  };
  return {
    get playing() {
      return sources.size > 0;
    },
    interrupt,
    async enqueue(encoded: string) {
      const generation = epoch;
      await ready;
      if (closed || generation !== epoch) {
        return;
      }
      const raw = atob(encoded);
      const bytes = new Uint8Array(raw.length + (carry === undefined ? 0 : 1));
      const offset = carry === undefined ? 0 : 1;
      if (carry !== undefined) {
        bytes[0] = carry;
      }
      for (let i = 0; i < raw.length; i++) {
        bytes[i + offset] = raw.charCodeAt(i);
      }
      carry = bytes.length % 2 ? bytes.at(-1) : undefined;
      const samples = Math.floor(bytes.length / 2);
      if (!samples) {
        return;
      }
      if (next - context.currentTime > 120) {
        throw new Error("实时语音播放缓冲过长，请打断后重试");
      }
      const buffer = context.createBuffer(1, samples, 24000);
      const channel = buffer.getChannelData(0);
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < samples; i++) {
        channel[i] = view.getInt16(i * 2, true) / 32768;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        source.disconnect();
        sources.delete(source);
        if (!sources.size) {
          changed(false);
        }
      };
      sources.add(source);
      const start = Math.max(next, context.currentTime + 0.01);
      source.start(start);
      next = start + buffer.duration;
      changed(true);
    },
    async close() {
      closed = true;
      interrupt();
      await context.close();
    },
  };
};
