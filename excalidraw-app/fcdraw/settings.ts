export const BRAND = { name: "Fcdraw", company: "方成教育", website: "http://www.fcjyboard.com/" };

export type Settings = {
  endpoint: string;
  model: string;
  apiKey: string;
  speech: "system" | "custom";
  speechEndpoint: string;
  speechKey: string;
  speechModel: string;
  autoSummary: boolean;
};

export const defaults: Settings = {
  endpoint: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
  model: "",
  apiKey: "",
  speech: "system",
  speechEndpoint: "",
  speechKey: "",
  speechModel: "whisper-1",
  autoSummary: true,
};

export const loadSettings = (): Settings => {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem("fcdraw-settings") || "{}") };
  } catch {
    return { ...defaults };
  }
};

export const saveSettings = (settings: Settings, rememberKey: boolean) => {
  sessionStorage.setItem("fcdraw-keys", JSON.stringify({apiKey: settings.apiKey, speechKey: settings.speechKey}));
  localStorage.setItem("fcdraw-settings", JSON.stringify({ ...settings, apiKey: rememberKey ? settings.apiKey : "", speechKey: rememberKey ? settings.speechKey : "" }));
};

export const currentSettings = (): Settings => {
  const settings = loadSettings();
  try {
    return { ...settings, ...JSON.parse(sessionStorage.getItem("fcdraw-keys") || "{}") };
  } catch {
    return settings;
  }
};

export const validateEndpoint = (value: string) => {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname))) {
    throw new Error("请使用 HTTPS 接口或局域网 HTTP 接口");
  }
  if (url.username || url.password) {
    throw new Error("请将密钥填入密钥栏");
  }
  return url.href;
};
