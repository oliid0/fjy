import { Capacitor } from "@capacitor/core";

export const BRAND = {
  name: "Fcdraw",
  company: "方成教育",
  website: "http://www.fcjyboard.com/",
};

export type Settings = {
  endpoint: string;
  model: string;
  apiKey: string;
  speech: "local" | "system" | "custom";
  speechEndpoint: string;
  speechKey: string;
  speechModel: string;
  ttsEndpoint: string;
  ttsKey: string;
  autoSummary: boolean;
  autoMath: boolean;
};

export const defaults: Settings = {
  endpoint: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
  model: "",
  apiKey: "",
  speech: Capacitor.isNativePlatform() ? "local" : "system",
  speechEndpoint: "",
  speechKey: "",
  speechModel: "whisper-1",
  ttsEndpoint: "",
  ttsKey: "",
  autoSummary: true,
  autoMath: true,
};

export const loadSettings = (): Settings => {
  try {
    return {
      ...defaults,
      ...JSON.parse(localStorage.getItem("fcdraw-settings") || "{}"),
    };
  } catch {
    return { ...defaults };
  }
};

export const saveSettings = (settings: Settings, rememberKey: boolean) => {
  sessionStorage.setItem(
    "fcdraw-keys",
    JSON.stringify({
      apiKey: settings.apiKey,
      speechKey: settings.speechKey,
      ttsKey: settings.ttsKey,
    }),
  );
  localStorage.setItem(
    "fcdraw-settings",
    JSON.stringify({
      ...settings,
      apiKey: rememberKey ? settings.apiKey : "",
      speechKey: rememberKey ? settings.speechKey : "",
      ttsKey: rememberKey ? settings.ttsKey : "",
    }),
  );
};

export const currentSettings = (): Settings => {
  const settings = loadSettings();
  try {
    return {
      ...settings,
      ...JSON.parse(sessionStorage.getItem("fcdraw-keys") || "{}"),
    };
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
    throw new Error("请使用 HTTPS 接口或局域网 HTTP 接口");
  }
  if (url.username || url.password) {
    throw new Error("请将密钥填入密钥栏");
  }
  return url.href;
};
