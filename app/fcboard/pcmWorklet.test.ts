import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const script = readFileSync(resolve("public/fc-pcm-worklet.js"), "utf8");

it.each([0.02, 0.1, 0.5])(
  "emits actual worklet PCM at %s seconds while preserving the trailing flush",
  (duration) => {
    const sent: {
      pcm?: Float32Array;
      sampleRate?: number;
      flushed?: boolean;
    }[] = [];
    let Processor!: new (options: unknown) => {
      process(input: Float32Array[][]): boolean;
      port: { onmessage: (value: { data: string }) => void };
    };
    class Base {
      port = {
        postMessage: (value: typeof sent[number]) => sent.push(value),
        onmessage: undefined,
      };
    }
    // Execute the shipped processor, with the browser worklet host supplied by the fixture.
    // eslint-disable-next-line no-new-func -- Executes the actual shipped worklet in a browser-host fixture.
    new Function(
      "AudioWorkletProcessor",
      "sampleRate",
      "registerProcessor",
      script,
    )(Base, 16000, (_name: string, value: typeof Processor) => {
      Processor = value;
    });
    const worklet = new Processor({
      processorOptions: { blockDuration: duration },
    });
    const size = Math.round(16000 * duration);
    worklet.process([[new Float32Array(size + 7).fill(0.5)]]);
    expect(sent).toHaveLength(1);
    expect(sent[0].pcm).toHaveLength(size);
    expect(sent[0].sampleRate).toBe(16000);
    worklet.port.onmessage({ data: "flush" });
    expect(sent[1].pcm).toHaveLength(7);
    expect(Array.from(sent[1].pcm!)).toEqual(Array(7).fill(0.5));
    expect(sent[2]).toEqual({ flushed: true });
  },
);
