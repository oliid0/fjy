import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { getLanguage, t } from "@fcboard/fcboard/i18n";
export type SearchKind = "word" | "photo" | "video";
export type SearchMedia = {
  url: string;
  pictureUrl: string;
  desc: string;
  from: string;
  duration: number;
  width: number;
  height: number;
};
export type SearchPage = { text: string; items: SearchMedia[] };
export const searchBaseUrl = "http://ai.lango-tech.com:8098/ai-api";
const paths = {
  word: "searchWord",
  photo: "searchPhoto",
  video: "searchVideo",
};
export const searchUrl = (value: unknown) => {
  if (typeof value !== "string") {
    return "";
  }
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
};
const string = (value: unknown) => (typeof value === "string" ? value : "");
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
/** Actual SearchFuncRes uses code0; deployed service serializes that code as a string. */
export const readSearchPage = (
  kind: SearchKind,
  value: unknown,
): SearchPage => {
  const body = value as {
    code?: unknown;
    data?: unknown;
    message?: unknown;
    msg?: unknown;
  } | null;
  if (
    !body ||
    (body.code !== 0 && body.code !== "0") ||
    !Array.isArray(body.data)
  ) {
    throw Error(
      string(body?.message) || string(body?.msg) || t("fcboard.search_failed"),
    );
  }
  if (kind === "word") {
    return { text: string(body.data[0]?.abstractText), items: [] };
  }
  const items = body.data.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const item = entry as Record<string, unknown>;
    const url = searchUrl(item.url);
    return url
      ? [
          {
            url,
            pictureUrl: searchUrl(item.pictureUrl),
            desc: string(item.desc),
            from: string(item.from),
            duration: number(item.duration),
            width: number(item.width),
            height: number(item.height),
          },
        ]
      : [];
  });
  if (kind === "photo") {
    items.sort((a, b) => b.width * b.height - a.width * a.height);
  }
  return { text: "", items };
};
/** Original three independent POSTs and page offsets, using the existing Capacitor HTTP bridge. */
export const searchPage = async (
  kind: SearchKind,
  keyword: string,
  page: number,
  signal: AbortSignal,
): Promise<SearchPage> => {
  signal.throwIfAborted();
  if (
    !keyword.trim() ||
    keyword.length > 10000 ||
    !Number.isSafeInteger(page) ||
    page < 1
  ) {
    throw Error(t("fcboard.invalid_style_parameters"));
  }
  const language = getLanguage().code.replaceAll("-", "_");
  const body = {
    keyword: keyword.trim(),
    language,
    page: kind === "word" ? 1 : page,
  };
  const headers = {
    source: "PC",
    language,
    "Content-Type": "application/json",
  };
  const url = `${searchBaseUrl}/media/${paths[kind]}`;
  let data: unknown;
  let status: number;
  if (Capacitor.isNativePlatform()) {
    const result = await CapacitorHttp.post({
      url,
      headers,
      data: body,
      connectTimeout: 15000,
      readTimeout: 30000,
    });
    data = result.data;
    status = result.status;
  } else {
    const request = new AbortController();
    const abort = () => request.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => request.abort(), 30000);
    try {
      const result = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: request.signal,
      });
      status = result.status;
      data = await result.json();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }
  signal.throwIfAborted();
  if (status < 200 || status >= 300) {
    throw Error(`${t("fcboard.search_failed")} (${status})`);
  }
  if (typeof data === "string") {
    data = JSON.parse(data);
  }
  return readSearchPage(kind, data);
};
export const searchDuration = (seconds: number) => {
  const time = Math.floor(seconds);
  if (!Number.isFinite(time) || time <= 0 || time >= 86400) {
    return "00:00";
  }
  const parts = [Math.floor(time / 60) % 60, time % 60].map((n) =>
    String(n).padStart(2, "0"),
  );
  if (time >= 3600) {
    parts.unshift(String(Math.floor(time / 3600)));
  }
  return parts.join(":");
};
