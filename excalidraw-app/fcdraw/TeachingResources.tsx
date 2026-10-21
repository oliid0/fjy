import { t, useI18n, getLanguage } from "@excalidraw/excalidraw/i18n";
import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { getDataURL } from "@excalidraw/excalidraw/data/blob";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/element/types";
import type { TranslationKeys } from "@excalidraw/excalidraw/i18n";

import catalogue from "./factory-resources.json";
import { classroomCommands } from "./commands";
import { insertionPoint, insertElements } from "./board";
import { Classroom } from "./native";
import { useAnchoredPanel } from "./floating";
import { selectionSignature } from "./selection";

export type TeachingResource = {
  id: string;
  title: string;
  titleKey: string;
  category: string;
  asset?: string;
  cover?: string;
  url?: string;
};
export const teachingResources: TeachingResource[] = catalogue.items;
export const resourceTitle = (item: TeachingResource) =>
  t(`factoryResources.${item.titleKey}` as TranslationKeys);
const resourceMatches = (item: TeachingResource, query: string) =>
  [item.title, resourceTitle(item)].some((name) =>
    name.toLowerCase().includes(query.toLowerCase()),
  );
const subjectNames: Record<string, TranslationKeys> = {
  数学: "fcboard.数学",
  物理: "fcboard.物理",
  化学: "fcboard.化学",
  生物: "fcboard.生物",
  地理与天气: "fcboard.地理与天气",
};

export const TeachingResources = ({
  api,
}: {
  api: ExcalidrawImperativeAPI;
}) => {
  useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [web, setWeb] = useState<{ url: string; title: string }>();
  const webState = useRef<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const panel = useRef<HTMLElement>(null);
  const style = useAnchoredPanel(panel, "[data-board-insert]", open);
  const native = Capacitor.isNativePlatform();
  const openWeb = async (url: unknown, title = t("fcboard.网页")) => {
    if (typeof url !== "string") {
      throw new Error(t("fcboard.缺少网页地址"));
    }
    const parsed = new URL(url);
    if (
      !["https:", "http:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error(t("fcboard.请输入完整的 http 或 https 网页地址"));
    }
    if (native) {
      await Classroom.openWebResource({
        url: parsed.href,
        language: getLanguage().code,
      });
    } else {
      setWeb({ url: parsed.href, title });
    }
    webState.current = { url: parsed.href, title };
    setOpen(false);
    return { opened: parsed.href };
  };
  const insertResource = async (
    id: unknown,
    args: Record<string, unknown> = {},
  ) => {
    const resource = teachingResources.find((item) => item.id === id);
    if (!resource) {
      throw new Error(t("fcboard.教学资源不存在，请先读取资源清单"));
    }
    if (resource.url) {
      const url = new URL(resource.url);
      if (url.hostname === "phet.colorado.edu") {
        const language = getLanguage().code;
        url.searchParams.set(
          "locale",
          language.startsWith("zh")
            ? language === "zh-CN"
              ? "zh_CN"
              : "zh_TW"
            : language.split("-")[0],
        );
      }
      return openWeb(url.href, resourceTitle(resource));
    }
    if (!resource.asset) {
      throw new Error(t("fcboard.资源文件缺失"));
    }
    const response = await fetch(resource.asset);
    if (!response.ok) {
      throw new Error(t("fcboard.无法读取教学资源，请检查安装文件"));
    }
    const blob = await response.blob();
    const dataURL = await getDataURL(blob);
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(t("fcboard.教学图示读取失败")));
      image.src = dataURL;
    });
    const size =
      typeof args.size === "number" &&
      Number.isFinite(args.size) &&
      args.size >= 40 &&
      args.size <= 1600
        ? args.size
        : 360;
    const scale = Math.min(
      1,
      size / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const position =
      typeof args.x === "number" &&
      typeof args.y === "number" &&
      Number.isFinite(args.x + args.y) &&
      Math.abs(args.x) <= 10000 &&
      Math.abs(args.y) <= 10000
        ? { x: args.x, y: args.y }
        : classroomCommands.has("document.draw")
        ? { x: 60, y: 60 }
        : insertionPoint(api, { width, height });
    const replace =
      Array.isArray(args.replaceIds) &&
      args.replaceIds.length <= 300 &&
      args.replaceIds.every((id) => typeof id === "string")
        ? (args.replaceIds as string[])
        : [];
    if (
      (args.signal instanceof AbortSignal && args.signal.aborted) ||
      (args.sourceSignature &&
        selectionSignature(
          api
            .getSceneElements()
            .filter((element) => replace.includes(element.id)),
        ) !== args.sourceSignature)
    ) {
      return;
    }
    if (classroomCommands.has("document.draw")) {
      await classroomCommands.execute({
        name: "document.draw",
        args: {
          lesson: "resource",
          progress: 1,
          image: dataURL,
          shape: {
            id: crypto.randomUUID(),
            type: "image",
            ...position,
            width,
            height,
          },
        },
      });
    } else {
      const fileId = crypto.randomUUID() as FileId;
      api.addFiles([
        { id: fileId, dataURL, mimeType: "image/png", created: Date.now() },
      ]);
      insertElements(
        api,
        [
          {
            type: "image",
            ...position,
            width,
            height,
            fileId,
            customData: { fcResource: resource.id },
          },
        ],
        replace,
      );
    }
    setOpen(false);
    return { inserted: resource.id };
  };
  useEffect(() => {
    const stops = [
      classroomCommands.register(
        "resources.open",
        "打开原白板教学资源库，可用 args.query 搜索，args.category 筛选数学/物理/化学/生物/地理与天气",
        (args) => {
          setQuery(typeof args.query === "string" ? args.query : "");
          setCategory(typeof args.category === "string" ? args.category : "");
          setError("");
          setOpen(true);
        },
      ),
      classroomCommands.register(
        "resources.list",
        "查找教学资源，args.query 搜索名称，args.category 可筛选学科；返回最多40项真实id、名称和类型，使用前先查询",
        (args) =>
          teachingResources
            .filter(
              (item) =>
                (!args.category || item.category === args.category) &&
                (!args.query || resourceMatches(item, String(args.query))),
            )
            .slice(0, 40)
            .map(({ id, title, category, url, asset }) => ({
              id,
              title,
              category,
              kind: url ? "web" : asset ? "image" : "unknown",
            })),
      ),
      classroomCommands.register(
        "resources.use",
        "使用教学资源，args.id 必须来自 resources 清单；本地图示插入可编辑白板对象，在线实验在应用内打开",
        (args) => insertResource(args.id, args),
      ),
      classroomCommands.register(
        "web.open",
        "在白板内打开网页，args.url 必填 http/https 地址",
        (args) => openWeb(args.url),
      ),
      classroomCommands.context("resources", () => ({
        count: teachingResources.length,
        categories: Array.from(
          new Set(teachingResources.map((item) => item.category)),
        ),
        web: webState.current,
      })),
      ...(native
        ? [
            classroomCommands.register(
              "web.action",
              "操作当前教学网页。args.action=read|click|set|key|scroll|back|forward|reload|close；先read取得控件selector，再click或set(value)，key支持方向键/Enter/Home/End/空格，scroll带x,y。返回真实页面文字和控件状态",
              async (args) => {
                const result = await Classroom.webResourceAction(
                  args as Parameters<typeof Classroom.webResourceAction>[0],
                );
                webState.current = args.action === "close" ? {} : result || {};
                return result;
              },
            ),
          ]
        : []),
    ];
    return () => stops.forEach((stop) => stop());
  });
  const run = async (id: string) => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await insertResource(id);
    } catch (failure) {
      setError(String(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const items = teachingResources.filter(
    (item) =>
      (!category || item.category === category) &&
      (resourceMatches(item, query) ||
        item.id.toLowerCase().includes(query.toLowerCase())),
  );
  return (
    <>
      {open && (
        <section
          ref={panel}
          className="fc-resource-library fc-surface"
          role="dialog"
          aria-label={t("fcboard.教学资源")}
          style={style}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        >
          <header>
            <strong>{t("fcboard.教学资源")}</strong>
            <button
              onClick={() => setOpen(false)}
              aria-label={t("fcboard.关闭教学资源")}
            >
              {t("fcboard.关闭")}
            </button>
          </header>
          <label>
            {t("fcboard.搜索资源")}
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>
            {t("fcboard.学科")}
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">{t("fcboard.全部学科")}</option>
              {Array.from(
                new Set(teachingResources.map((item) => item.category)),
              ).map((name) => (
                <option key={name} value={name}>
                  {subjectNames[name] ? t(subjectNames[name]) : name}
                </option>
              ))}
            </select>
          </label>
          {error && <p role="alert">{error}</p>}
          {busy && <p role="status">{t("fcboard.正在打开资源…")}</p>}
          {!items.length && (
            <p role="status">{t("fcboard.没有符合条件的资源")}</p>
          )}
          <div className="fc-resource-grid">
            {items.map((item) => (
              <button
                key={item.id}
                disabled={busy}
                onClick={() => void run(item.id)}
              >
                {(item.cover || item.asset) && (
                  <img src={item.cover || item.asset} alt="" loading="lazy" />
                )}
                <span>{resourceTitle(item)}</span>
                <small>
                  {item.url ? t("fcboard.在线实验") : t("fcboard.插入图示")}
                </small>
              </button>
            ))}
          </div>
        </section>
      )}
      {web && (
        <section
          className="fc-web-resource fc-surface"
          role="dialog"
          aria-label={web.title}
        >
          <header>
            <strong>{web.title}</strong>
            <a href={web.url} target="_blank" rel="noreferrer">
              {t("fcboard.浏览器打开")}
            </a>
            <button
              onClick={() => {
                setWeb(undefined);
                webState.current = {};
              }}
            >
              {t("fcboard.关闭网页")}
            </button>
          </header>
          <iframe
            title={web.title}
            src={web.url}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            allow="fullscreen"
          />
          <p>
            {t(
              "fcboard.网页由资源提供方加载；若禁止嵌入，请使用“浏览器打开”。",
            )}
          </p>
        </section>
      )}
    </>
  );
};
