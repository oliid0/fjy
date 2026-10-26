import { Capacitor } from "@capacitor/core";

import { startCloudSpeech } from "./cloudSpeech";
import { startLocalSpeech } from "./localSpeech";
import { currentSettings } from "./settings";
import { startSystemSpeech } from "./speech";

import type { LocalSpeechHandle } from "./localSpeech";
import type { TranscriptLine } from "./speech";

/** A failed cloud session is released before the offline engine takes the microphone. */
export const startRealtimeSpeech = async (
  onLine: (line: TranscriptLine) => void,
  onError: (message: string) => void,
  stream?: MediaStream,
  onActivity?: () => void,
): Promise<LocalSpeechHandle> => {
  type Attempt = {
    cloud: boolean;
    opening: Promise<LocalSpeechHandle>;
    recovery?: Promise<void>;
  };
  const started = Date.now();
  let current: Attempt;
  let closed = false;
  let cancelled = false;
  let finished = false;
  let finishing: Promise<void> | undefined;
  let latestTime = 0;
  let transition: Promise<void>;
  const report = (error: unknown) => {
    if (!closed) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };
  const recover = (attempt: Attempt, error: unknown): Promise<void> => {
    if (attempt.recovery) {
      return attempt.recovery;
    }
    if (closed || current !== attempt) {
      return Promise.resolve();
    }
    if (!attempt.cloud) {
      attempt.recovery = Promise.resolve();
      report(error);
      return attempt.recovery;
    }
    attempt.recovery = (async () => {
      const handle = await attempt.opening.catch(() => undefined);
      await handle?.cancel().catch(() => {});
      if (!closed) {
        await open(false);
      }
    })();
    transition = attempt.recovery;
    return attempt.recovery;
  };
  const open = (cloud: boolean) => {
    const offset = (Date.now() - started) / 1000;
    const attempt = { cloud } as Attempt;
    current = attempt;
    const deliver = (line: TranscriptLine) => {
      if (!cancelled && !finished && current === attempt && !attempt.recovery) {
        latestTime = Math.max(latestTime, offset + line.time);
        onLine({ ...line, time: latestTime });
      }
    };
    const fail = (message: string) => {
      void recover(attempt, new Error(message)).catch(report);
    };
    const activity = () => {
      if (!closed && current === attempt && !attempt.recovery) {
        onActivity?.();
      }
    };
    attempt.opening = Promise.resolve().then(async () => {
      // Browser fallback uses its speech API; the Android fallback is the bundled model.
      if (
        !cloud &&
        currentSettings().speech !== "local" &&
        !Capacitor.isNativePlatform()
      ) {
        const stop = await startSystemSpeech(
          (text) => {
            deliver({ time: (Date.now() - started) / 1000 - offset, text });
            activity();
          },
          fail,
          true,
        );
        return { stop: async () => stop(), cancel: async () => stop() };
      }
      return (cloud ? startCloudSpeech : startLocalSpeech)(
        deliver,
        fail,
        stream,
        activity,
      );
    });
    return attempt.opening.then(() => {});
  };
  const cloud =
    currentSettings().speech === "cloud" && navigator.onLine !== false;
  transition = open(cloud);
  try {
    await transition;
  } catch (error) {
    if (!cloud) {
      throw error;
    }
    await recover(current!, error);
  }
  // A provider may report a connection failure before its start promise resolves.
  await transition;
  const finish = (discard: boolean) => {
    cancelled ||= discard;
    closed = true;
    return (finishing ||= (async () => {
      await transition.catch(() => {});
      if (current.cloud && current.recovery) {
        finished = true;
        return;
      }
      const handle = await current.opening.catch(() => undefined);
      try {
        await handle?.[cancelled ? "cancel" : "stop"]();
      } finally {
        finished = true;
      }
    })());
  };
  return { stop: () => finish(false), cancel: () => finish(true) };
};
