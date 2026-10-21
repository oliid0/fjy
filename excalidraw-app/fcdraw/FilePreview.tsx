import { t, useI18n } from "@excalidraw/excalidraw/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CloseIcon,
  chevronLeftIcon,
  chevronRight,
  EraserIcon,
  pencilIcon,
  UndoIcon,
  exportToFileIcon,
  microphoneIcon,
  SelectionIcon,
  RedoIcon,
  MagicIcon,
  gridIcon,
  DeviceDesktopIcon,
} from "@excalidraw/excalidraw/components/icons";
import { Capacitor } from "@capacitor/core";
import { FONT_FAMILY, getFontFamilyString } from "@excalidraw/common";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { Fonts } from "@excalidraw/excalidraw/fonts";
import {
  isPalmContact,
  pointerSamples,
} from "@excalidraw/excalidraw/eraser/stroke";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";

import { classroomCommands } from "./commands";
import { Classroom as NativeClassroom } from "./native";
import { useDeviceInkProfile } from "./ink";

import {
  documentKey,
  eraseDocumentInk,
  hitStroke,
  htmlText,
  loadInk,
  OfficeReader,
  saveInk,
  shapeInk,
  inkSnapshot,
} from "./documents";

import { rememberPage } from "./materials";
import { currentSettings } from "./settings";

import type { Viewer } from "@web-ppt/viewer-core";
import type { Presentation } from "@web-ppt/core";

import type { DocumentInk, InkStroke } from "./documents";

import type { LessonCommand } from "./lesson";

export const FilePreview = ({
  file,
  onClose,
  onVoice,
  listening,
  onReady,
  onTools,
}: {
  file: File;
  onClose: (advance?: boolean) => void;
  onVoice?: () => void;
  listening?: boolean;
  onReady?: (error?: string) => void;
  onTools?: () => void;
}) => {
  useI18n();
  const inkProfile = useDeviceInkProfile();
  const host = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const office = useRef<OfficeReader | null>(null);
  const presentation = useRef<Presentation | null>(null);
  const inkRef = useRef<DocumentInk>({});
  const [ink, setInk] = useState<DocumentInk>({});
  const [draft, setDraft] = useState<InkStroke | null>(null);
  const draftRef = useRef<InkStroke | null>(null);
  const [inkOn, setInkOn] = useState(false);
  const [erase, setErase] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const selectedInkRef = useRef<string[]>([]);
  const [lasso, setLasso] = useState<[number, number][]>([]);
  const past = useRef<Record<number, InkStroke[][]>>({});
  const future = useRef<Record<number, InkStroke[][]>>({});
  const animationBefore = useRef(new Map<string, InkStroke[]>());
  const gestureBefore = useRef<InkStroke[]>([]);
  const erasing = useRef<{
    previous: [number, number];
    width: number;
    height: number;
  } | null>(null);
  const [, refreshHistory] = useState(0);
  const [color, setColor] = useState("#dc2626");
  const [penWidth, setPenWidth] = useState(3);
  const [fontSize, setFontSize] = useState(26);
  const [opacity, setOpacity] = useState(100);
  const pen = useRef({ color, penWidth, fontSize, opacity });
  pen.current = { color, penWidth, fontSize, opacity };
  const [key, setKey] = useState("");
  const [url, setUrl] = useState("");
  const [html, setHtml] = useState("");
  const [page, setPage] = useState(0);
  const pageRef = useRef(0);
  const [pages, setPages] = useState<{ index: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingAnimation, setPendingAnimation] = useState(false);
  const [ratio, setRatio] = useState(16 / 9);
  const [size, setSize] = useState({ width: 1000, height: 600 });
  const [scroll, setScroll] = useState(0);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const [currentText, setCurrentText] = useState("");
  const currentTextRef = useRef("");
  const navigation = useRef(Promise.resolve());
  const navigationId = useRef(0);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [ready, setReady] = useState(false);
  const announced = useRef(false);
  const isSlides = /\.(pptx?|ppsx?)$/i.test(file.name);
  const isImage = /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name);
  const commitInk = useCallback((next: DocumentInk, remember = true) => {
    if (remember) {
      for (const [page, strokes] of Object.entries(next)) {
        const index = Number(page);
        if (inkRef.current[index] !== strokes) {
          const history = (past.current[index] ||= []);
          history.push(inkRef.current[index] || []);
          if (history.length > 100) {
            history.shift();
          }
          future.current[index] = [];
        }
      }
      refreshHistory((value) => value + 1);
    }
    inkRef.current = next;
    setInk(next);
    classroomCommands.changed("document");
  }, []);
  useEffect(() => {
    dialog.current?.focus();
  }, []);

  useEffect(() => {
    let active = true;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    void (async () => {
      try {
        const fingerprint = await documentKey(file);
        const saved = await loadInk(fingerprint);
        if (!active) {
          return;
        }
        setKey(fingerprint);
        commitInk(saved, false);
        setReady(true);
        if (isSlides) {
          const [{ parse }, { Viewer: SlideViewer }] = await Promise.all([
            import("@web-ppt/core"),
            import("@web-ppt/viewer-core"),
          ]);
          const pres = await parse(file);
          if (!active || !host.current) {
            pres.dispose?.();
            return;
          }
          presentation.current = pres;
          setRatio(pres.width / pres.height);
          const instance = new SlideViewer(host.current, pres, {
            animate: !matchMedia("(prefers-reduced-motion: reduce)").matches,
            autoAdvance: false,
            media: "player",
          });
          viewer.current = instance;
          instance.onLinkClick = () => true;
          instance.onChange = (index) => {
            if (index !== pageRef.current) {
              classroomCommands.touch();
              if (classroomCommands.has("lesson.pause")) {
                void classroomCommands.execute({ name: "lesson.pause" });
              }
            }
            pageRef.current = index;
            currentTextRef.current = instance.text(index);
            setCurrentText(currentTextRef.current);
            setPage(index);
            setPendingAnimation(instance.hasPendingAnimation);
          };
          instance.onAnimStep = () =>
            setPendingAnimation(instance.hasPendingAnimation);
          setPages(
            pres.slides.map((_, index) => ({ index, name: String(index + 1) })),
          );
          setPendingAnimation(instance.hasPendingAnimation);
          currentTextRef.current = instance.text(0);
          setCurrentText(currentTextRef.current);
          for (let index = 0; index < pres.slides.length; index++) {
            if (!active) {
              break;
            }
            await rememberPage(
              fingerprint,
              file.name,
              index,
              instance.text(index),
            ).catch(() => setNotice(t("fcboard.课件可播放，资料索引保存失败")));
          }
        } else if (!isImage) {
          const reader = new OfficeReader();
          office.current = reader;
          const views = await reader.open(file, await file.arrayBuffer());
          if (!active) {
            return;
          }
          if (!views.length) {
            throw new Error(t("fcboard.文件中没有可显示的页面"));
          }
          const firstHtml = await reader.render(views[0].index);
          if (!active) {
            return;
          }
          setHtml(firstHtml);
          currentTextRef.current = htmlText(firstHtml);
          setCurrentText(currentTextRef.current);
          setPages(views);
          setRatio(0);
          setLoading(false);
          for (const view of views.slice(0, 300)) {
            if (!active) {
              break;
            }
            const rendered = await reader.render(view.index);
            if (!active) {
              break;
            }
            await rememberPage(
              fingerprint,
              file.name,
              view.index,
              htmlText(rendered),
            ).catch(() => setNotice(t("fcboard.课件可预览，资料索引保存失败")));
          }
        } else {
          setPages([{ index: 0, name: "1" }]);
        }
      } catch (failure) {
        if (active) {
          setError(
            t("fcboard.课件打开失败：{{error}}", { error: String(failure) }),
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
      viewer.current?.destroy();
      viewer.current = null;
      presentation.current?.dispose?.();
      presentation.current = null;
      office.current?.close();
      office.current = null;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file, isSlides, isImage, commitInk]);

  useEffect(() => {
    if (!key || !ready) {
      return;
    }
    if (saveTimer.current) {
      return;
    }
    saveTimer.current = setTimeout(() => {
      saveTimer.current = undefined;
      saveQueue.current = saveQueue.current
        .catch(() => {})
        .then(() => saveInk(key, inkRef.current))
        .catch((failure) => {
          setNotice(
            t("fcboard.板书保存失败，请保持课件打开后重试：{{error}}", {
              error: String(failure),
            }),
          );
          throw failure;
        });
      void saveQueue.current.catch(() => {});
    }, 1000);
  }, [key, ink, ready]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);
  useEffect(() => {
    const parent = stage.current?.parentElement;
    if (!parent) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const available = entry.contentRect;
      const width = ratio
        ? Math.min(available.width, available.height * ratio)
        : available.width;
      setSize({ width, height: ratio ? width / ratio : available.height });
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, [ratio]);
  const navigate = useCallback(
    (index: number) => {
      const task = (async () => {
        if (!Number.isInteger(index) || index < 0 || index >= pages.length) {
          throw new Error(t("fcboard.页码超出范围"));
        }
        if (classroomCommands.has("lesson.pause")) {
          await classroomCommands.execute({ name: "lesson.pause" });
        }
        classroomCommands.touch();
        const generation = ++navigationId.current;
        setScroll(0);
        setLasso([]);
        selectedInkRef.current = [];
        draftRef.current = null;
        setDraft(null);
        if (viewer.current) {
          viewer.current.goTo(index);
          pageRef.current = index;
          setPage(index);
        } else if (office.current) {
          setLoading(true);
          try {
            const value = await office.current.render(pages[index].index);
            if (generation !== navigationId.current) {
              return;
            }
            currentTextRef.current = htmlText(value);
            pageRef.current = index;
            setPage(index);
            setCurrentText(currentTextRef.current);
            setHtml(value);
            void rememberPage(
              key,
              file.name,
              pages[index].index,
              currentTextRef.current,
            ).catch(() => {});
          } finally {
            if (generation === navigationId.current) {
              setLoading(false);
            }
          }
        }
      })();
      navigation.current = task;
      return task;
    },
    [pages, key, file.name],
  );
  useEffect(() => {
    if (html) {
      setCurrentText(htmlText(html));
    }
    const receive = (event: MessageEvent) => {
      if (
        event.source === frame.current?.contentWindow &&
        Number.isFinite(event.data?.fcDocumentScroll)
      ) {
        setScroll(event.data.fcDocumentScroll);
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [html]);

  const next = useCallback(async () => {
    if (classroomCommands.has("lesson.pause")) {
      void classroomCommands.execute({ name: "lesson.pause" });
    }
    classroomCommands.touch();
    if (viewer.current) {
      viewer.current.next();
    } else {
      await navigate(Math.min(pages.length - 1, pageRef.current + 1));
    }
  }, [pages.length, navigate]);
  const previous = useCallback(async () => {
    if (classroomCommands.has("lesson.pause")) {
      void classroomCommands.execute({ name: "lesson.pause" });
    }
    classroomCommands.touch();
    if (viewer.current) {
      viewer.current.prev();
    } else {
      await navigate(Math.max(0, pageRef.current - 1));
    }
  }, [navigate]);
  const close = useCallback(
    async (advance = true) => {
      try {
        if (classroomCommands.has("lesson.pause")) {
          await classroomCommands.execute({ name: "lesson.pause" });
        }
        await saveQueue.current.catch(() => {});
        if (key && ready) {
          await saveInk(key, inkRef.current);
        }
        onClose(advance);
      } catch {
        setNotice(t("fcboard.板书尚未保存，请稍后重试"));
        throw new Error(t("fcboard.板书尚未保存，课件保持打开"));
      }
    },
    [onClose, key, ready],
  );
  const undoInk = useCallback(
    (redo = false) => {
      const index = pageRef.current;
      const source = redo ? future.current[index] : past.current[index];
      const previous = source?.pop();
      if (!previous) {
        return;
      }
      const target = redo ? past.current : future.current;
      (target[index] ||= []).push(inkRef.current[index] || []);
      commitInk({ ...inkRef.current, [index]: previous }, false);
    },
    [commitInk],
  );
  useEffect(() => {
    const registrations = [
      classroomCommands.register(
        "document.next",
        "下一页课件；若有当前页动画，先播放动画",
        next,
      ),
      classroomCommands.register("document.previous", "上一页课件", previous),
      classroomCommands.register(
        "document.page",
        "跳转课件到 args.page（从1开始）",
        (args) => {
          const index = Number(args.page) - 1;
          if (!Number.isInteger(index) || index < 0 || index >= pages.length) {
            throw new Error(t("fcboard.页码超出范围"));
          }
          return navigate(index);
        },
      ),
      classroomCommands.register(
        "document.zoom",
        "缩放课件，args.value=0.5..3，或args.action=zoomIn|zoomOut|resetZoom|zoomToFit",
        (args) => {
          const value =
            typeof args.value === "number"
              ? args.value
              : args.action === "zoomIn"
              ? zoomRef.current + 0.25
              : args.action === "zoomOut"
              ? zoomRef.current - 0.25
              : 1;
          if (!Number.isFinite(value) || value < 0.5 || value > 3) {
            throw new Error(t("fcboard.课件缩放范围为50%到300%"));
          }
          zoomRef.current = value;
          setZoom(value);
        },
      ),
      classroomCommands.register(
        "document.ink",
        "打开或关闭透明板书，args.enabled 为布尔值",
        (args) => setInkOn(args.enabled !== false),
      ),
      classroomCommands.register(
        "document.clearInk",
        "仅清除当前页板书，不修改原课件",
        () => commitInk({ ...inkRef.current, [pageRef.current]: [] }),
      ),
      classroomCommands.register("document.undo", "撤销当前页板书", () =>
        undoInk(),
      ),
      classroomCommands.register("document.redo", "重做当前页板书", () =>
        undoInk(true),
      ),
      classroomCommands.register(
        "document.erase",
        "擦除课件上的板书，args.ids 可指定板书id，省略为圈选板书",
        (args) => {
          const ids =
            args.ids === undefined ? selectedInkRef.current : args.ids;
          if (
            !Array.isArray(ids) ||
            !ids.length ||
            !ids.every((id) => typeof id === "string")
          ) {
            throw new Error(
              t("fcboard.请先圈选要擦除的板书；原课件内容不会被擦除"),
            );
          }
          const chosen = new Set(ids);
          commitInk({
            ...inkRef.current,
            [pageRef.current]: (inkRef.current[pageRef.current] || []).filter(
              (stroke) => !chosen.has(stroke.id),
            ),
          });
          selectedInkRef.current = [];
          setLasso([]);
        },
      ),
      classroomCommands.register(
        "document.select",
        "选择指定课件板书，args.ids 为已存在板书id数组",
        (args) => {
          if (
            !Array.isArray(args.ids) ||
            !args.ids.every((id) => typeof id === "string")
          ) {
            throw new Error(t("fcboard.板书选区无效"));
          }
          const ids = new Set(args.ids);
          selectedInkRef.current = (inkRef.current[pageRef.current] || [])
            .filter((stroke) => ids.has(stroke.id))
            .map((stroke) => stroke.id);
          classroomCommands.changed("document");
        },
      ),
      classroomCommands.register(
        "document.tool",
        "切换课件板书工具，args.tool=freedraw|eraser|selection",
        (args) => {
          if (
            !["freedraw", "eraser", "selection"].includes(String(args.tool))
          ) {
            throw new Error(
              t(
                "fcboard.课件上可使用笔、橡皮或圈选；也可直接说要插入的文字或图形",
              ),
            );
          }
          setInkOn(true);
          setErase(args.tool === "eraser");
          setSelecting(args.tool === "selection");
        },
      ),
      classroomCommands.register(
        "document.style",
        "更改板书或圈选板书：args.color 十六进制颜色，width=1..30,fontSize=8..200,opacity=0..100",
        (args) => {
          if (
            !Object.keys(args).length ||
            Object.keys(args).some(
              (key) => !["color", "width", "fontSize", "opacity"].includes(key),
            )
          ) {
            throw new Error(
              t("fcboard.课件板书可调整颜色、笔宽、字号与透明度"),
            );
          }
          for (const [key, min, max] of [
            ["fontSize", 8, 200],
            ["opacity", 0, 100],
          ] as const) {
            if (
              args[key] !== undefined &&
              (typeof args[key] !== "number" ||
                !Number.isFinite(args[key]) ||
                (args[key] as number) < min ||
                (args[key] as number) > max)
            ) {
              throw new Error(t("fcboard.板书样式超出范围"));
            }
          }
          if (
            args.width !== undefined &&
            (typeof args.width !== "number" ||
              !Number.isFinite(args.width) ||
              args.width < 1 ||
              args.width > 30)
          ) {
            throw new Error(t("fcboard.笔画宽度必须在1到30之间"));
          }
          if (
            args.color !== undefined &&
            (typeof args.color !== "string" ||
              !/^#[a-f0-9]{3}(?:[a-f0-9]{3})?$/i.test(args.color))
          ) {
            throw new Error(t("fcboard.板书颜色无效"));
          }
          if (typeof args.color === "string") {
            setColor(args.color);
          }
          if (typeof args.width === "number") {
            setPenWidth(args.width);
          }
          if (typeof args.fontSize === "number") {
            setFontSize(args.fontSize);
          }
          if (typeof args.opacity === "number") {
            setOpacity(args.opacity);
          }
          pen.current = {
            color:
              typeof args.color === "string" ? args.color : pen.current.color,
            penWidth:
              typeof args.width === "number"
                ? args.width
                : pen.current.penWidth,
            fontSize:
              typeof args.fontSize === "number"
                ? args.fontSize
                : pen.current.fontSize,
            opacity:
              typeof args.opacity === "number"
                ? args.opacity
                : pen.current.opacity,
          };
          const ids = new Set(selectedInkRef.current);
          if (ids.size) {
            commitInk({
              ...inkRef.current,
              [pageRef.current]: (inkRef.current[pageRef.current] || []).map(
                (stroke) =>
                  ids.has(stroke.id)
                    ? {
                        ...stroke,
                        color:
                          typeof args.color === "string"
                            ? args.color
                            : stroke.color,
                        width:
                          typeof args.width === "number"
                            ? args.width
                            : stroke.width,
                        fontSize:
                          typeof args.fontSize === "number"
                            ? args.fontSize
                            : stroke.fontSize,
                        opacity:
                          typeof args.opacity === "number"
                            ? args.opacity
                            : stroke.opacity,
                      }
                    : stroke,
              ),
            });
          }
        },
      ),
      classroomCommands.register("document.text", "@internal", async (args) => {
        if (
          typeof args.text !== "string" ||
          !args.text.trim() ||
          args.text.length > 10000
        ) {
          throw new Error(t("fcboard.板书文本为空或过长"));
        }
        const strokes = inkRef.current[pageRef.current] || [];
        const selected = strokes.filter((stroke) =>
          selectedInkRef.current.includes(stroke.id),
        );
        const source = selected.find((stroke) => stroke.text) || selected[0];
        const presentation = args.presentation ?? currentSettings().answerStyle;
        if (!["match", "handwritten", "text"].includes(String(presentation))) {
          throw new Error(t("fcboard.回答样式不存在"));
        }
        const fontFamily =
          presentation === "handwritten"
            ? FONT_FAMILY.Excalifont
            : presentation === "text"
            ? FONT_FAMILY.Helvetica
            : source?.fontFamily ||
              (source && !source.text
                ? FONT_FAMILY.Excalifont
                : FONT_FAMILY.Helvetica);
        const existing = args.id
          ? strokes.find((stroke) => stroke.id === args.id && stroke.text)
          : undefined;
        if (args.id && !existing) {
          throw new Error(t("fcboard.找不到这段课件板书"));
        }
        const points = strokes
          .filter((stroke) => selectedInkRef.current.includes(stroke.id))
          .flatMap((stroke) => stroke.points);
        const x = points.length
          ? Math.min(750, Math.max(...points.map(([x]) => x)) + 16)
          : 32;
        const y = points.length
          ? Math.min(...points.map(([, y]) => y))
          : Math.max(
              scroll + 32,
              ...strokes.flatMap((stroke) =>
                stroke.points.map(([, y]) => y + (stroke.fontSize || 26) + 16),
              ),
            );
        const next: InkStroke = existing
          ? {
              ...existing,
              text: args.text,
              ...(args.presentation !== undefined ? { fontFamily } : {}),
            }
          : {
              id: crypto.randomUUID(),
              text: args.text,
              points: [[x, y]],
              color: source?.color || pen.current.color,
              width: pen.current.penWidth,
              fontSize: source?.fontSize || pen.current.fontSize,
              fontFamily,
              opacity: source?.opacity ?? pen.current.opacity,
            };
        const targetPage = pageRef.current;
        await Fonts.loadElementsFonts(
          convertToExcalidrawElements([
            {
              type: "text",
              x: 0,
              y: 0,
              text: args.text,
              fontFamily: next.fontFamily,
              fontSize: next.fontSize,
            },
          ]),
        );
        if (args.signal instanceof AbortSignal && args.signal.aborted) {
          return;
        }
        commitInk({
          ...inkRef.current,
          [targetPage]: [
            ...(inkRef.current[targetPage] || []).filter(
              (stroke) => stroke.id !== next.id,
            ),
            next,
          ],
        });
      }),
      classroomCommands.register("document.move", "@internal", (args) => {
        if (
          typeof args.dx !== "number" ||
          typeof args.dy !== "number" ||
          !Number.isFinite(args.dx) ||
          !Number.isFinite(args.dy) ||
          Math.abs(args.dx) > 10000 ||
          Math.abs(args.dy) > 10000
        ) {
          throw new Error(t("fcboard.移动距离无效"));
        }
        const ids = new Set(
          Array.isArray(args.ids) ? args.ids : selectedInkRef.current,
        );
        if (!ids.size) {
          throw new Error(t("fcboard.请先圈选板书"));
        }
        commitInk({
          ...inkRef.current,
          [pageRef.current]: (inkRef.current[pageRef.current] || []).map(
            (stroke) =>
              ids.has(stroke.id)
                ? {
                    ...stroke,
                    anchor: stroke.anchor
                      ? {
                          x: stroke.anchor.x + (args.dx as number),
                          y: stroke.anchor.y + (args.dy as number),
                        }
                      : undefined,
                    points: stroke.points.map(
                      ([x, y]) =>
                        [x + (args.dx as number), y + (args.dy as number)] as [
                          number,
                          number,
                        ],
                    ),
                  }
                : stroke,
          ),
        });
      }),
      classroomCommands.register(
        "document.close",
        "关闭课件并返回白板，板书自动保存",
        (args) => close(args.next !== false),
      ),
      classroomCommands.context("document", () => ({
        name: file.name,
        page: pageRef.current + 1,
        pages: pages.length,
        zoom: zoomRef.current,
        pen: pen.current,
        text: currentTextRef.current,
        ink: inkRef.current[pageRef.current] || [],
        selection: selectedInkRef.current,
        region: lasso,
        viewport: {
          left: stage.current?.getBoundingClientRect().left || 0,
          top: stage.current?.getBoundingClientRect().top || 0,
          width: size.width * zoomRef.current,
          height: size.height * zoomRef.current,
          scroll,
        },
      })),
      classroomCommands.register("document.snapshot", "@internal", async () => {
        await navigation.current;
        if (Capacitor.isNativePlatform() && stage.current) {
          const rect = stage.current.getBoundingClientRect();
          const capture = await NativeClassroom.captureFrame({
            region: {
              x: Math.max(0, rect.left) / innerWidth,
              y: Math.max(0, rect.top) / innerHeight,
              width:
                (Math.min(innerWidth, rect.right) - Math.max(0, rect.left)) /
                innerWidth,
              height:
                (Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top)) /
                innerHeight,
            },
          });
          return {
            text: currentTextRef.current,
            name: file.name,
            page: pageRef.current + 1,
            image: capture.image,
            ink: inkRef.current[pageRef.current] || [],
          };
        }
        const background = viewer.current
          ? await viewer.current.exportPng(1)
          : isImage
          ? file
          : undefined;
        const image = await inkSnapshot(
          inkRef.current[pageRef.current] || [],
          (size.height / Math.max(1, size.width)) * 1000,
          background,
          scroll,
        );
        return {
          text: currentTextRef.current,
          name: file.name,
          page: pageRef.current + 1,
          image,
          ink: inkRef.current[pageRef.current] || [],
        };
      }),
      classroomCommands.register("document.draw", "@internal", (args) => {
        const lesson = String(args.lesson || "");
        const command = args.command as LessonCommand | undefined;
        if (command) {
          const origin = args.origin as { x: number; y: number };
          const source = inkRef.current[page] || [];
          const next = source.filter((stroke) => {
            if (stroke.lesson !== lesson) {
              return true;
            }
            if (command.type === "clear_canvas") {
              return false;
            }
            if (command.type === "clear_annotations") {
              return !stroke.annotation;
            }
            if (command.type === "erase_object") {
              return stroke.commandId !== command.target;
            }
            if (command.type === "erase_area") {
              return !stroke.points.some(
                ([x, y]) =>
                  x >= origin.x + command.x &&
                  x <= origin.x + command.x + command.width &&
                  y >= origin.y + command.y &&
                  y <= origin.y + command.y + command.height,
              );
            }
            return true;
          });
          commitInk({ ...inkRef.current, [page]: next });
          return;
        }
        const stroke = shapeInk(
          args.shape as ExcalidrawElementSkeleton,
          lesson,
          typeof args.image === "string" ? args.image : undefined,
        );
        if (!animationBefore.current.has(stroke.id)) {
          animationBefore.current.set(stroke.id, inkRef.current[page] || []);
        }
        if (args.progress === 1) {
          (past.current[page] ||= []).push(
            animationBefore.current.get(stroke.id)!,
          );
          future.current[page] = [];
          animationBefore.current.delete(stroke.id);
          refreshHistory((value) => value + 1);
        }
        commitInk(
          {
            ...inkRef.current,
            [page]: [
              ...(inkRef.current[page] || []).filter(
                (item) => item.id !== stroke.id,
              ),
              stroke,
            ],
          },
          false,
        );
      }),
      classroomCommands.register("document.insertion", "@internal", (args) => {
        if (typeof args.id !== "string" || !Array.isArray(args.shapes)) {
          throw new Error(t("fcboard.插入对象数据无效"));
        }
        const strokes = (args.shapes as ExcalidrawElementSkeleton[]).map(
          (shape) => shapeInk(shape, "insertion"),
        );
        commitInk({
          ...inkRef.current,
          [page]: [
            ...(inkRef.current[page] || []).filter(
              (stroke) => stroke.insertion?.id !== args.id,
            ),
            ...strokes,
          ],
        });
        selectedInkRef.current = strokes.map((stroke) => stroke.id);
        classroomCommands.changed("document");
      }),
      classroomCommands.register("document.widget", "@internal", (args) => {
        const widget = args.widget as { id: string };
        if (!widget?.id || !Array.isArray(args.shapes)) {
          throw new Error(t("fcboard.教学工具数据无效"));
        }
        const strokes = (args.shapes as ExcalidrawElementSkeleton[]).map(
          (shape) => shapeInk(shape, "widget"),
        );
        commitInk(
          {
            ...inkRef.current,
            [pageRef.current]: [
              ...(inkRef.current[pageRef.current] || []).filter(
                (stroke) => stroke.widget?.id !== widget.id,
              ),
              ...strokes,
            ],
          },
          args.remember !== false,
        );
      }),
      classroomCommands.register("document.plot", "@internal", (args) => {
        setInkOn(true);
        setSelecting(true);
        setErase(false);
        const remove = new Set(args.replaceIds as string[]);
        const strokes = (args.shapes as ExcalidrawElementSkeleton[]).map(
          (shape) => shapeInk(shape, "plot"),
        );
        selectedInkRef.current = strokes.map((stroke) => stroke.id);
        commitInk({
          ...inkRef.current,
          [pageRef.current]: [
            ...(inkRef.current[pageRef.current] || []).filter(
              (stroke) => !remove.has(stroke.id),
            ),
            ...strokes,
          ],
        });
      }),
    ];
    return () => registrations.forEach((stop) => stop());
  }, [
    next,
    previous,
    navigate,
    close,
    file.name,
    pages.length,
    page,
    currentText,
    commitInk,
    size,
    scroll,
    isImage,
    file,
    lasso,
    undoInk,
    color,
    penWidth,
    zoom,
    fontSize,
    opacity,
  ]);
  useEffect(() => {
    if (announced.current || loading) {
      return;
    }
    if (error || pages.length) {
      announced.current = true;
      onReady?.(error || undefined);
    }
  }, [loading, error, pages.length, onReady]);

  const point = (
    event: React.PointerEvent<SVGSVGElement>,
  ): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) / rect.width) * 1000,
      ((event.clientY - rect.top) / rect.width) * 1000 + scroll,
    ];
  };
  const removeAt = (position: [number, number]) => {
    const gesture = erasing.current;
    if (!gesture) {
      return;
    }
    const previous = inkRef.current[page] || [];
    const next = eraseDocumentInk(
      previous,
      gesture.previous,
      position,
      gesture.width,
      gesture.height,
    );
    gesture.previous = position;
    if (next !== previous) {
      commitInk({ ...inkRef.current, [page]: next }, false);
    }
  };
  const cancelInkGesture = () => {
    if (erasing.current) {
      commitInk({ ...inkRef.current, [page]: gestureBefore.current }, false);
    }
    erasing.current = null;
    draftRef.current = null;
    setDraft(null);
  };
  const paths = [...(ink[page] || []), ...(draft ? [draft] : [])];
  return (
    <section
      ref={dialog}
      tabIndex={-1}
      className="fc-preview fc-presentation"
      role="dialog"
      aria-modal="false"
      aria-label={t("fcboard.预览 {{name}}", { name: file.name })}
      onKeyDown={(event) => {
        event.stopPropagation();
        if ((event.target as HTMLElement).closest("input,select,textarea")) {
          return;
        }
        if (event.key === "Escape") {
          if (inkOn) {
            setInkOn(false);
          } else {
            void close().catch(() => {});
          }
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          void next().catch((failure) => setNotice(String(failure)));
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          void previous().catch((failure) => setNotice(String(failure)));
        }
      }}
    >
      <div className="fc-preview-content">
        <div
          ref={stage}
          className="fc-document-stage"
          style={{ width: size.width * zoom, height: size.height * zoom }}
        >
          <div
            className="fc-document-surface"
            style={{
              width: size.width,
              height: size.height,
              transform: `scale(${zoom})`,
            }}
          >
            {isSlides && <div className="fc-slides" ref={host} />}
            {isImage && (
              <img
                src={url}
                alt={file.name}
                onLoad={(event) =>
                  setRatio(
                    event.currentTarget.naturalWidth /
                      event.currentTarget.naturalHeight,
                  )
                }
              />
            )}
            {!isSlides && !isImage && html && (
              <iframe
                ref={frame}
                title={file.name}
                sandbox="allow-scripts"
                srcDoc={html.replace(
                  "</body>",
                  "<script>addEventListener('scroll',function(e){var t=e.target;parent.postMessage({fcDocumentScroll:(t.scrollTop||scrollY)/innerWidth*1000},'*')},true)</script></body>",
                )}
              />
            )}
          </div>
          <svg
            className="fc-document-ink"
            aria-label={t("fcboard.课件透明板书")}
            data-ink-enabled={inkOn}
            style={{
              pointerEvents: inkOn && !loading && !error ? "auto" : "none",
              cursor: erase ? "cell" : "crosshair",
            }}
            viewBox={`0 ${scroll} 1000 ${
              (size.height / Math.max(1, size.width)) * 1000
            }`}
            preserveAspectRatio="none"
            onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0) {
                return;
              }
              if (classroomCommands.has("lesson.pause")) {
                void classroomCommands.execute({ name: "lesson.pause" });
              }
              gestureBefore.current = inkRef.current[page] || [];
              event.currentTarget.setPointerCapture(event.pointerId);
              if (
                erase ||
                (!selecting &&
                  isPalmContact(event, inkProfile?.palmThreshold ?? 36))
              ) {
                const rect = event.currentTarget.getBoundingClientRect();
                const scale = 1000 / rect.width;
                erasing.current = {
                  previous: point(event),
                  width:
                    Math.max(inkProfile?.eraserSize ?? 60, event.width) * scale,
                  height:
                    Math.max(
                      (inkProfile?.eraserSize ?? 60) * 1.2,
                      event.height,
                    ) * scale,
                };
                removeAt(point(event));
              } else {
                const stroke: InkStroke = {
                  id: crypto.randomUUID(),
                  color,
                  width:
                    (penWidth *
                      (inkProfile ? inkProfile.hardPenWidth / 4 : 1) *
                      1000) /
                    event.currentTarget.getBoundingClientRect().width,
                  opacity,
                  points: [point(event)],
                };
                draftRef.current = stroke;
                setDraft(stroke);
              }
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
                return;
              }
              const rect = event.currentTarget.getBoundingClientRect();
              const samples = pointerSamples(event.nativeEvent).map(
                (sample): [number, number] => [
                  ((sample.clientX - rect.left) / rect.width) * 1000,
                  ((sample.clientY - rect.top) / rect.width) * 1000 + scroll,
                ],
              );
              if (erasing.current) {
                samples.forEach(removeAt);
              } else if (draftRef.current) {
                const stroke = {
                  ...draftRef.current,
                  points: [...draftRef.current.points, ...samples],
                };
                draftRef.current = stroke;
                setDraft(stroke);
              }
            }}
            onPointerUp={(event) => {
              if (erasing.current) {
                removeAt(point(event));
              }
              if (draftRef.current && selecting) {
                const polygon = draftRef.current.points;
                const left = Math.min(...polygon.map((p) => p[0])) - 12 / zoom;
                const top = Math.min(...polygon.map((p) => p[1])) - 12 / zoom;
                const right = Math.max(...polygon.map((p) => p[0])) + 12 / zoom;
                const bottom =
                  Math.max(...polygon.map((p) => p[1])) + 12 / zoom;
                const ids = (inkRef.current[page] || [])
                  .filter((stroke) =>
                    polygon.length < 3
                      ? hitStroke(stroke, polygon[0])
                      : stroke.points.some(
                          ([x, y]) =>
                            x >= left && x <= right && y >= top && y <= bottom,
                        ),
                  )
                  .map((stroke) => stroke.id);
                selectedInkRef.current = ids;
                setLasso(polygon);
                classroomCommands.changed("document");
                if (
                  polygon.length < 3 &&
                  ids.some((id) =>
                    (inkRef.current[page] || []).some(
                      (stroke) => stroke.id === id && stroke.plot,
                    ),
                  ) &&
                  classroomCommands.has("math.inspect")
                ) {
                  void classroomCommands.execute({ name: "math.inspect" });
                }
              } else if (draftRef.current) {
                const stroke = draftRef.current;
                if (stroke.points.length === 1) {
                  stroke.points.push([
                    stroke.points[0][0] + 0.01,
                    stroke.points[0][1],
                  ]);
                }
                commitInk({
                  ...inkRef.current,
                  [page]: [...(inkRef.current[page] || []), draftRef.current],
                });
              } else if (
                erasing.current &&
                gestureBefore.current !== inkRef.current[page]
              ) {
                (past.current[page] ||= []).push(gestureBefore.current);
                future.current[page] = [];
                refreshHistory((value) => value + 1);
              }
              erasing.current = null;
              draftRef.current = null;
              setDraft(null);
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={cancelInkGesture}
            onLostPointerCapture={cancelInkGesture}
          >
            {lasso.length > 2 && (
              <polygon
                points={lasso.map((point) => point.join(",")).join(" ")}
                fill="#245bd610"
                stroke="#245bd6"
                strokeWidth="1.5"
                strokeDasharray="6 6"
              />
            )}
            {paths.map((stroke) =>
              stroke.image ? (
                <image
                  key={stroke.id}
                  x={stroke.points[0][0]}
                  y={stroke.points[0][1]}
                  width={stroke.imageWidth}
                  height={stroke.imageHeight}
                  href={stroke.image}
                  opacity={(stroke.opacity ?? 100) / 100}
                />
              ) : stroke.text ? (
                <text
                  key={stroke.id}
                  x={stroke.points[0][0]}
                  y={stroke.points[0][1]}
                  fill={stroke.color}
                  fontSize={stroke.fontSize || 26}
                  fontFamily={getFontFamilyString({
                    fontFamily: stroke.fontFamily || FONT_FAMILY.Helvetica,
                  })}
                  opacity={(stroke.opacity ?? 100) / 100}
                  dominantBaseline="hanging"
                >
                  {stroke.text.split("\n").map((line, index) => (
                    <tspan
                      key={index}
                      x={stroke.points[0][0]}
                      dy={index ? (stroke.fontSize || 26) * 1.3 : 0}
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
              ) : (
                <polyline
                  key={stroke.id}
                  points={stroke.points.map((p) => p.join(",")).join(" ")}
                  fill="none"
                  stroke={stroke.color}
                  strokeWidth={stroke.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={(stroke.opacity ?? 100) / 100}
                />
              ),
            )}
          </svg>
        </div>
      </div>
      {(loading || error || notice) && (
        <p className="fc-document-status" role={error ? "alert" : "status"}>
          {error || notice || t("fcboard.正在打开课件…")}
        </p>
      )}
      <footer
        className="fc-presentation-toolbar"
        role="toolbar"
        aria-label={t("fcboard.课件工具栏")}
      >
        <button
          aria-label={t("fcboard.关闭课件")}
          title={t("fcboard.返回白板")}
          onClick={() => {
            void close().catch(() => {});
          }}
        >
          {CloseIcon}
          <span>{t("fcboard.白板")}</span>
        </button>
        <span className="fc-document-name" title={file.name}>
          {file.name}
        </span>
        <button
          aria-label={t("fcboard.上一页")}
          disabled={page === 0 || loading}
          onClick={() => {
            void previous().catch((failure) => setError(String(failure)));
          }}
        >
          {chevronLeftIcon}
          <span>{t("fcboard.上页")}</span>
        </button>
        <select
          aria-label={t("fcboard.课件页码")}
          value={page}
          disabled={loading}
          onChange={(event) => {
            void navigate(Number(event.target.value)).catch((failure) =>
              setError(String(failure)),
            );
          }}
        >
          {pages.map((view, index) => (
            <option key={view.index} value={index}>
              {index + 1} / {pages.length}
              {view.name && view.name !== String(index + 1)
                ? ` · ${view.name}`
                : ""}
            </option>
          ))}
        </select>
        <button
          aria-label={t("fcboard.下一页")}
          disabled={loading || (page >= pages.length - 1 && !pendingAnimation)}
          onClick={() => {
            void next().catch((failure) => setError(String(failure)));
          }}
        >
          {chevronRight}
          <span>{t("fcboard.下页")}</span>
        </button>
        <button
          aria-label={t("fcboard.板书开关")}
          title={t("fcboard.在课件上板书")}
          aria-pressed={inkOn}
          disabled={loading || !!error}
          onClick={() => setInkOn(!inkOn)}
        >
          {pencilIcon}
          <span>{t("fcboard.板书")}</span>
        </button>
        <button
          aria-label={t("fcboard.缩小课件")}
          disabled={zoom <= 0.5}
          onClick={() => {
            void classroomCommands.execute({
              name: "document.zoom",
              args: { action: "zoomOut" },
            });
          }}
        >
          −
        </button>
        <button
          aria-label={t("fcboard.重置课件缩放")}
          onClick={() => {
            void classroomCommands.execute({
              name: "document.zoom",
              args: { action: "resetZoom" },
            });
          }}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          aria-label={t("fcboard.放大课件")}
          disabled={zoom >= 3}
          onClick={() => {
            void classroomCommands.execute({
              name: "document.zoom",
              args: { action: "zoomIn" },
            });
          }}
        >
          +
        </button>
        {inkOn && (
          <>
            {["#dc2626", "#2563eb", "#17243c"].map((value) => (
              <button
                key={value}
                aria-label={t("fcboard.笔色 {{color}}", { color: value })}
                aria-pressed={color === value && !erase}
                onClick={() => {
                  setColor(value);
                  setErase(false);
                  setSelecting(false);
                }}
              >
                <span className="fc-ink-color" style={{ background: value }} />
              </button>
            ))}
            <button
              aria-label={t("fcboard.擦除板书")}
              aria-pressed={erase}
              onClick={() => {
                setErase(!erase);
                setSelecting(false);
              }}
            >
              {EraserIcon}
              <span>{t("fcboard.橡皮")}</span>
            </button>
            <button
              aria-label={t("fcboard.圈选课件板书")}
              aria-pressed={selecting}
              onClick={() => {
                setSelecting(!selecting);
                setErase(false);
              }}
            >
              {SelectionIcon}
              <span>{t("fcboard.圈选")}</span>
            </button>
            <button
              aria-label={t("fcboard.撤销板书")}
              disabled={!past.current[page]?.length}
              onClick={() => undoInk()}
            >
              {UndoIcon}
              <span>{t("fcboard.撤销")}</span>
            </button>
            <button
              aria-label={t("fcboard.重做板书")}
              disabled={!future.current[page]?.length}
              onClick={() => undoInk(true)}
            >
              {RedoIcon}
              <span>{t("fcboard.重做")}</span>
            </button>
          </>
        )}
        <a
          href={url}
          download={file.name}
          aria-label={t("fcboard.下载原文件")}
          title={t("fcboard.下载原文件")}
        >
          {exportToFileIcon}
          <span>{t("fcboard.原件")}</span>
        </a>
        {onVoice && (
          <button
            aria-label={t("fcboard.课件语音指令")}
            title={t("fcboard.对这页说点什么")}
            aria-pressed={listening}
            onClick={onVoice}
          >
            {microphoneIcon}
            <span>{t("fcboard.语音")}</span>
          </button>
        )}
        <button
          aria-label={t("fcboard.课件 AI 教师")}
          title={t("fcboard.提问或操作课件")}
          onClick={() => {
            void classroomCommands.execute({ name: "assistant.open" });
          }}
        >
          {MagicIcon}
          <span>{t("fcboard.助教")}</span>
        </button>
        {onTools && (
          <button
            aria-label={t("fcboard.课件教学工具")}
            title={t("fcboard.教学工具")}
            onClick={onTools}
          >
            {gridIcon}
            <span>{t("fcboard.教具")}</span>
          </button>
        )}
        {Capacitor.isNativePlatform() && (
          <button
            aria-label={t("fcboard.设备控制")}
            data-network="remote"
            onClick={() =>
              void classroomCommands.execute({
                name: "network.panel",
                args: { panel: "remote" },
              })
            }
          >
            {DeviceDesktopIcon}
            <span>{t("fcboard.控制")}</span>
          </button>
        )}
      </footer>
    </section>
  );
};
