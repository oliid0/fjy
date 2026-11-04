import { createDuplexPlayer } from "./duplexPlayer";

it("schedules PCM16 chunks without gaps, keeps split samples, and stops all queued sound on barge-in", async () => {
  const nodes: {
    buffer: AudioBuffer;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
  }[] = [];
  const channels: Float32Array[] = [];
  const close = vi.fn().mockResolvedValue(undefined);
  const resume = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal(
    "AudioContext",
    class {
      currentTime = 10;
      destination = {};
      resume = resume;
      close = close;
      createBuffer(_channels: number, samples: number, rate: number) {
        const data = new Float32Array(samples);
        channels.push(data);
        return { duration: samples / rate, getChannelData: () => data };
      }
      createBufferSource() {
        const source = {
          buffer: {} as AudioBuffer,
          start: vi.fn(),
          stop: vi.fn(),
          disconnect: vi.fn(),
          connect: vi.fn(),
          onended: null as (() => void) | null,
        };
        nodes.push(source);
        return source;
      }
    },
  );
  try {
    const changed = vi.fn();
    const player = createDuplexPlayer(changed);
    expect(resume).toHaveBeenCalledTimes(1);
    await player.enqueue(btoa(String.fromCharCode(0, 128, 0)));
    await player.enqueue(btoa(String.fromCharCode(0, 255, 127)));
    expect(Array.from(channels[0])).toEqual([-1]);
    expect(Array.from(channels[1])).toEqual([0, 32767 / 32768]);
    expect(nodes[0].start).toHaveBeenCalledWith(10.01);
    expect(nodes[1].start).toHaveBeenCalledWith(10.01 + 1 / 24000);
    expect(player.playing).toBe(true);
    player.interrupt();
    expect(player.playing).toBe(false);
    expect(
      nodes.every(
        (node) => node.stop.mock.calls.length === 1 && node.onended === null,
      ),
    ).toBe(true);
    expect(changed).toHaveBeenLastCalledWith(false);
    await player.close();
    expect(close).toHaveBeenCalledTimes(1);
    await player.enqueue("AAAA");
    expect(nodes).toHaveLength(2);
  } finally {
    vi.unstubAllGlobals();
  }
});
