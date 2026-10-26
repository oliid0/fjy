import { t } from "@excalidraw/excalidraw/i18n";

import { startRealtimeSpeech } from "./realtimeSpeech";
import { currentSettings } from "./settings";
import { startSystemSpeech, transcribe } from "./speech";

import type { LocalSpeechHandle } from "./localSpeech";

/** Question dictation collects text; it never executes a whiteboard command. */
export const startDictation = async (
  onText: (text: string) => void,
  onError: (message: string) => void,
): Promise<LocalSpeechHandle> => {
  const provider = currentSettings().speech;
  if (provider === "cloud" || provider === "local") {
    return startRealtimeSpeech((line) => onText(line.text), onError);
  }
  if (provider === "system") {
    const stop = await startSystemSpeech(onText, onError, true);
    return {
      stop: async () => stop(),
      cancel: async () => stop(),
    };
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
  const chunks: Blob[] = [];
  let discarded = false;
  let stopped: Promise<void> | undefined;
  let complete!: () => void;
  const ended = new Promise<void>((resolve) => (complete = resolve));
  recorder.ondataavailable = ({ data }) => {
    if (data.size && !discarded) {
      chunks.push(data);
    }
  };
  const release = () => {
    stream.getTracks().forEach((track) => track.stop());
    complete();
  };
  recorder.onstop = release;
  recorder.onerror = () => {
    discarded = true;
    release();
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
    onError(t("fcboard.speech_input_failed_please_try_again"));
  };
  try {
    recorder.start();
  } catch (error) {
    release();
    throw error;
  }
  const stop = () =>
    (stopped ||= (async () => {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
      await ended;
      if (discarded) {
        return;
      }
      const lines = await transcribe(
        new Blob(chunks, { type: recorder.mimeType }),
      );
      if (!discarded) {
        lines.forEach((line) => onText(line.text));
      }
    })());
  return {
    stop,
    cancel: async () => {
      discarded = true;
      chunks.length = 0;
      await stop();
    },
  };
};
