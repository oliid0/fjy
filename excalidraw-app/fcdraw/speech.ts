import { Capacitor } from "@capacitor/core";
import { SpeechRecognition } from "@capacitor-community/speech-recognition";

import { currentSettings, validateEndpoint } from "./settings";

export type TranscriptLine = { time: number; text: string };
type WebSpeech = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        resultIndex: number;
        results: {
          length: number;
          [key: number]: {
            isFinal: boolean;
            [key: number]: { transcript: string };
          };
        };
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

export const startSystemSpeech = async (
  onText: (text: string) => void,
  onError: (message: string) => void,
  continuous = false,
): Promise<() => void> => {
  if (Capacitor.isNativePlatform()) {
    if (!(await SpeechRecognition.available()).available) {
      throw new Error(
        "安卓未安装语音识别服务，请安装系统语音服务或选择自定义转写",
      );
    }
    if (
      (await SpeechRecognition.requestPermissions()).speechRecognition !==
      "granted"
    ) {
      throw new Error("请允许麦克风与语音识别权限");
    }
    let stopped = false;
    let restartTimer: ReturnType<typeof setTimeout> | undefined;
    const listen = () => {
      void SpeechRecognition.start({
        language: "zh-CN",
        maxResults: 1,
        partialResults: false,
        popup: false,
      })
        .then(({ matches }) => {
          if (stopped) {
            return;
          }
          const text = matches?.[0];
          if (text) {
            onText(text);
          } else if (!continuous) {
            onError("未识别到语音，请重试");
          }
          if (continuous && !stopped) {
            restartTimer = setTimeout(listen, 400);
          }
        })
        .catch((error) => {
          if (!stopped) {
            stopped = true;
            onError(String(error));
          }
        });
    };
    listen();
    return () => {
      stopped = true;
      clearTimeout(restartTimer);
      void SpeechRecognition.stop().catch(() => {});
    };
  }
  const constructors = window as Window & {
    SpeechRecognition?: new () => WebSpeech;
    webkitSpeechRecognition?: new () => WebSpeech;
  };
  const Constructor =
    constructors.SpeechRecognition || constructors.webkitSpeechRecognition;
  if (!Constructor) {
    throw new Error("此浏览器不支持系统语音识别，请在设置中使用自定义转写接口");
  }
  const speech = new Constructor();
  let stopped = false;
  let received = false;
  speech.lang = "zh-CN";
  speech.continuous = continuous;
  speech.interimResults = false;
  speech.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        received = true;
        onText(event.results[i][0].transcript);
      }
    }
  };
  speech.onerror = ({ error }) => {
    if (error !== "aborted" && error !== "no-speech") {
      stopped = true;
      onError(`语音识别失败：${error}`);
    }
  };
  speech.onend = () => {
    if (continuous && !stopped) {
      try {
        speech.start();
      } catch {
        onError("语音识别已结束，请重新开启");
      }
    } else if (!stopped && !received) {
      onError("未识别到语音，请重试");
    }
  };
  speech.start();
  return () => {
    stopped = true;
    speech.stop();
  };
};

export const transcribe = async (blob: Blob): Promise<TranscriptLine[]> => {
  const settings = currentSettings();
  if (!settings.speechEndpoint) {
    throw new Error("请配置兼容音频转写的自定义接口");
  }
  const form = new FormData();
  form.append(
    "file",
    blob,
    blob.type.includes("mp4") ? "recording.mp4" : "recording.webm",
  );
  form.append("model", settings.speechModel);
  form.append("response_format", "verbose_json");
  form.append("language", "zh");
  const response = await fetch(validateEndpoint(settings.speechEndpoint), {
    method: "POST",
    headers: settings.speechKey
      ? { Authorization: `Bearer ${settings.speechKey}` }
      : {},
    body: form,
    signal: AbortSignal.timeout(180000),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `转写失败 (${response.status})`);
  }
  if (Array.isArray(data.segments) && data.segments.length) {
    const lines: TranscriptLine[] = data.segments
      .filter(
        (line: { text?: unknown; start?: unknown }) =>
          typeof line.text === "string" &&
          typeof line.start === "number" &&
          Number.isFinite(line.start) &&
          line.start >= 0,
      )
      .map((line: { start: number; text: string }) => ({
        time: line.start,
        text: line.text,
      }));
    if (lines.length) {
      return lines;
    }
  }
  if (typeof data.text === "string" && data.text.trim()) {
    return [{ time: 0, text: data.text }];
  }
  throw new Error("转写服务没有返回有效文稿");
};
