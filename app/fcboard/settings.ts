import { t } from "@fcboard/fcboard/i18n";
import { Capacitor } from "@capacitor/core";
export const BRAND = {
  name: "Fcboard",
  company: "Education",
  website: "http://www.fcjyboard.com/",
};

export type Settings = {
  endpoint: string;
  model: string;
  ocrModel: string;
  textModel: string;
  imageModel: string;
  ocr: "auto" | "local" | "cloud";
  inkLanguage: "auto" | "zh-Hani-CN" | "en-US";
  mathTranscription: "local" | "cloud";
  translationProvider: "local" | "cloud";
  handwritingGeneration: "local" | "cloud";
  apiKey: string;
  speechRoutingVersion?: number;
  speech: "cloud" | "local" | "system" | "custom";
  assistantVoice: "agent" | "duplex";
  speechResource: string;
  speechEndpoint: string;
  speechKey: string;
  speechModel: string;
  speechLanguage: string;
  ttsEndpoint: string;
  ttsKey: string;
  autoSummary: boolean;
  autoMath: boolean;
  selectionImages: boolean;
  answerStyle: "match" | "handwritten" | "text";
};

export const defaults: Settings = {
  endpoint: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
  model: "doubao-seed-2-0-mini-260428",
  ocrModel: "",
  textModel: "",
  imageModel: "doubao-seedream-5-0-flash-260915",
  ocr: "auto",
  inkLanguage: "auto",
  mathTranscription: "local",
  translationProvider: "local",
  handwritingGeneration: "local",
  apiKey: "",
  speech: "system",
  assistantVoice: "agent",
  speechResource: "volc.seedasr.sauc.duration",
  speechEndpoint: "",
  speechKey: "",
  speechModel: "whisper-1",
  speechLanguage: "auto",
  ttsEndpoint: "",
  ttsKey: "",
  autoSummary: true,
  autoMath: false,
  selectionImages: false,
  answerStyle: "match",
};

export const loadSettings = (): Settings => {
  try {
    const saved = JSON.parse(localStorage.getItem("fcboard-settings") || "{}");
    return {
      ...defaults,
      speech: Capacitor.isNativePlatform() ? "cloud" : defaults.speech,
      assistantVoice: Capacitor.isNativePlatform()
        ? "duplex"
        : defaults.assistantVoice,
      ...saved,
      model: saved.model?.trim() || defaults.model,
      imageModel: saved.imageModel?.trim() || defaults.imageModel,
      selectionImages: saved.selectionImages === true,
    };
  } catch {
    return {
      ...defaults,
      speech: Capacitor.isNativePlatform() ? "cloud" : defaults.speech,
      assistantVoice: Capacitor.isNativePlatform()
        ? "duplex"
        : defaults.assistantVoice,
    };
  }
};

export const saveSettings = (settings: Settings, rememberKey: boolean) => {
  sessionStorage.setItem(
    "fcboard-keys",
    JSON.stringify({
      apiKey: settings.apiKey,
      speechKey: settings.speechKey,
      ttsKey: settings.ttsKey,
    }),
  );
  localStorage.setItem(
    "fcboard-settings",
    JSON.stringify({
      ...settings,
      speechRoutingVersion: 1,
      apiKey: rememberKey ? settings.apiKey : "",
      speechKey: rememberKey ? settings.speechKey : "",
      ttsKey: rememberKey ? settings.ttsKey : "",
    }),
  );
};

export const currentSettings = (): Settings => {
  const settings = loadSettings();
  try {
    const merged = {
      ...settings,
      ...JSON.parse(sessionStorage.getItem("fcboard-keys") || "{}"),
    };
    // Earlier installations saved the old system default even after a cloud key
    // was entered. Migrate that default once; new explicit choices are retained.
    if (
      Capacitor.isNativePlatform() &&
      merged.speechRoutingVersion !== 1 &&
      merged.speech === "system" &&
      merged.speechKey?.trim()
    ) {
      merged.speech = "cloud";
    }
    return merged;
  } catch {
    return settings;
  }
};

export const validateEndpoint = (value: string) => {
  const url = new URL(value);
  const octets = url.hostname.split(".").map(Number);
  const isIPv4 =
    octets.length === 4 &&
    octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
  const local =
    url.hostname === "localhost" ||
    (isIPv4 &&
      (octets[0] === 127 ||
        octets[0] === 10 ||
        (octets[0] === 192 && octets[1] === 168) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)));
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error(
      t("fcboard.use_an_https_endpoint_or_a_local_network_http_endpoint"),
    );
  }
  if (url.username || url.password) {
    throw new Error(t("fcboard.enter_the_key_in_the_api_key_field"));
  }
  return url.href;
};
