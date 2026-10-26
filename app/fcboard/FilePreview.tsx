import { MaterialSelect } from "@excalidraw/excalidraw/components/MaterialSelect";
import { InteractiveResourceFrame } from "@excalidraw/excalidraw/components/InteractiveResourceFrame";
import { validateInteractiveResource } from "@excalidraw/excalidraw/interactiveHtml";
import { newIframeElement } from "@excalidraw/element";
import { getLanguage, t, useI18n } from "@excalidraw/excalidraw/i18n";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Popper from "@mui/material/Popper";
import ClickAwayListener from "@mui/material/ClickAwayListener";
import Slider from "@mui/material/Slider";
import { FactoryPenSettings } from "@excalidraw/excalidraw/components/FactoryPenSettings";
import {
  switchWhiteboardPen,
  whiteboardInkStyle,
} from "@excalidraw/excalidraw/whiteboardPen";
import { rainbowInkStops } from "@excalidraw/element/rainbowInk";
import { finishFactoryInk } from "@excalidraw/element/factoryInk";
import factoryEraser from "@excalidraw/excalidraw/components/FactoryEraser.png?url";
import { pointFrom } from "@excalidraw/math";
import {
  circleRegion,
  regionPath,
  regionHandleAt,
  resizeRegion,
  regionCorners,
} from "@excalidraw/excalidraw/lasso/region";
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
} from "@excalidraw/excalidraw/components/icons";
import { Capacitor } from "@capacitor/core";
import {
  FONT_FAMILY,
  getFontFamilyString,
  DRAGGING_THRESHOLD,
} from "@excalidraw/common";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { Fonts } from "@excalidraw/excalidraw/fonts";
import {
  isPalmContact,
  pointerSamples,
} from "@excalidraw/excalidraw/eraser/stroke";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";
import type {
  RegionBounds,
  RegionHandle,
} from "@excalidraw/excalidraw/lasso/region";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { TransientMessage } from "./TransientMessage";

import { classroomCommands, commandObjectIds } from "./commands";
import { Classroom as NativeClassroom } from "./native";
import { useDeviceInkProfile } from "./ink";

import {
  documentKey,
  documentStrokeBounds,
  hitStroke,
  selectDocumentRegion,
  moveDocumentStroke,
  eraseDocumentInk,
  eraseDocumentObjects,
  htmlText,
  loadInk,
  OfficeReader,
  saveInk,
  shapeInk,
  inkSnapshot,
  documentSourceSignature,
} from "./documents";

import { rememberPage } from "./materials";
import { currentSettings } from "./settings";
import { layoutBoardText } from "./textLayout";
import { prepareQuestionWriting } from "./questionWriting";
import { MaterialPanel } from "./MaterialPanel";
import { documentStrokeGeometry } from "./documentInk";
import {
  inkAssistMode,
  recognizeInkContent,
  settleInkRecognition,
} from "./inkRecognition";
import {
  documentWritingParts,
  insertionWritingTargets,
  insertionWritingAt,
  insertionWritingText,
  insertionWritingTextIds,
} from "./insertionWriting";
import { drawPlot } from "./board";
import { insertGeneratedImage } from "./imageGeneration";
import { changeQuestionAnswer } from "./questionAnswer";
import { resourcePlacement } from "./resourcePlacement";
import {
  applyCanvasConfiguration,
  canvasConfigurationPatch,
  canvasConfigurationSnapshot,
} from "./canvasConfiguration";
import { languageInkSignature, parseLanguageStudy } from "./languageStudy";

import type { Viewer } from "@web-ppt/viewer-core";
import type { Presentation } from "@web-ppt/core";

import type { DocumentInk, InkStroke } from "./documents";

import type { LessonCommand } from "./lesson";

const StrokePath = ({ stroke }: { stroke: InkStroke }) => {
  const id = useId();
  const geometry = documentStrokeGeometry(stroke);
  const rainbow = stroke.fcInk?.pen === "rainbow";
  const origin = stroke.fcInk?.rainbow?.x ?? 0;
  return (
    <>
      {rainbow && (
        <defs>
          <linearGradient
            id={id}
            gradientUnits="userSpaceOnUse"
            x1={origin}
            x2={origin + (stroke.fcInk?.rainbow?.width ?? 1000)}
            y1={0}
            y2={0}
          >
            {rainbowInkStops.map(([offset, color]) => (
              <stop key={offset} offset={offset} stopColor={color} />
            ))}
          </linearGradient>
        </defs>
      )}
      <path
        data-language={stroke.language ? stroke.id : undefined}
        data-widget={stroke.widget?.id}
        d={geometry.path}
        fill={geometry.filled ? stroke.color : stroke.fill || "none"}
        stroke={
          geometry.filled || !stroke.width
            ? "none"
            : rainbow
            ? `url(#${id})`
            : stroke.color
        }
        strokeWidth={stroke.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={geometry.dashes?.join(" ")}
        strokeDashoffset={-geometry.dashOffset}
        opacity={(stroke.opacity ?? 100) / 100}
      />
    </>
  );
};

const visibleDocumentArea = (
  stage: HTMLElement | null,
  size: { width: number; height: number },
  zoom: number,
  scroll: number,
) => {
  const rect = stage?.getBoundingClientRect();
  const clip = stage?.parentElement?.getBoundingClientRect();
  const scale = (rect?.width || size.width * zoom) / 1000;
  return {
    scale,
    viewport: {
      left:
        16 / scale +
        Math.max(0, ((clip?.left || 0) - (rect?.left || 0)) / scale),
      top:
        scroll +
        16 / scale +
        Math.max(0, ((clip?.top || 0) - (rect?.top || 0)) / scale),
      right:
        Math.min(
          1000,
          ((clip?.right ?? rect?.right ?? size.width) - (rect?.left || 0)) /
            scale,
        ) -
        16 / scale,
      bottom:
        scroll +
        Math.min(
          size.height * zoom,
          (clip?.bottom ?? rect?.bottom ?? size.height) - (rect?.top || 0),
        ) /
          scale -
        16 / scale,
    },
  };
};

export const FilePreview = ({
  api,
  file,
  onClose,
  onVoice,
  listening,
  onReady,
  onTools,
}: {
  api: ExcalidrawImperativeAPI;
  file: File;
  onClose: (advance?: boolean) => void;
  onVoice?: () => void;
  listening?: boolean;
  onReady?: (error?: string) => void;
  onTools?: () => void;
}) => {
  const { langCode } = useI18n();
  const inkProfile = useDeviceInkProfile();
  const deviceProfileRef = useRef(inkProfile);
  deviceProfileRef.current = inkProfile;
  const [penState, setPenState] = useState(() => api.getAppState());
  const penStateRef = useRef(penState);
  const [penAnchor, setPenAnchor] = useState<HTMLElement | null>(null);
  const [eraserAnchor, setEraserAnchor] = useState<HTMLElement | null>(null);
  useEffect(
    () =>
      api.onChange((_elements, state) => {
        penStateRef.current = state;
        setPenState(state);
      }),
    [api],
  );
  const host = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const office = useRef<OfficeReader | null>(null);
  const presentation = useRef<Presentation | null>(null);
  const inkRef = useRef<DocumentInk>({});
  const documentId = useRef(crypto.randomUUID());
  const recognized = useRef(new Set<string>());
  const failedRecognition = useRef(new Set<string>());
  const assistRequest = useRef<AbortController | null>(null);
  const [ink, setInk] = useState<DocumentInk>({});
  const [draft, setDraft] = useState<InkStroke | null>(null);
  const draftRef = useRef<InkStroke | null>(null);
  const [inkOn, setInkOn] = useState(false);
  const [erase, setErase] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const documentTool = useRef("hand");
  documentTool.current = !inkOn
    ? "hand"
    : selecting
    ? "lasso"
    : erase
    ? "eraser"
    : "freedraw";
  const selectedInkRef = useRef<string[]>([]);
  const [lasso, setLasso] = useState<[number, number][]>([]);
  const selectionGesture = useRef<{
    before: [number, number][];
    ids: string[];
    bounds?: RegionBounds;
    handle: RegionHandle | null;
    origin: [number, number];
    extent: RegionBounds;
    started: boolean;
  } | null>(null);
  const past = useRef<Record<number, InkStroke[][]>>({});
  const future = useRef<Record<number, InkStroke[][]>>({});
  const animationBefore = useRef(new Map<string, InkStroke[]>());
  const gestureBefore = useRef<InkStroke[]>([]);
  const gesturePage = useRef(0);
  const activePointer = useRef<{ id: number; target: SVGSVGElement } | null>(
    null,
  );
  const [eraserPreview, setEraserPreview] = useState<{
    position: [number, number];
    width: number;
    height: number;
  } | null>(null);
  const erasing = useRef<{
    mode: "stroke" | "object";
    previous: [number, number];
    width: number;
    height: number;
  } | null>(null);
  const [, refreshHistory] = useState(0);
  const color = penState.currentItemStrokeColor;
  const penWidth = penState.currentItemStrokeWidth;
  const [fontSize, setFontSize] = useState(26);
  const opacity = penState.currentItemOpacity;
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
        Object.values(saved)
          .flat()
          .forEach((stroke) => recognized.current.add(stroke.id));
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
            ).catch(() =>
              setNotice(
                t(
                  "fcboard.playback_is_available_but_the_resource_index_could_not_be_saved",
                ),
              ),
            );
          }
        } else if (!isImage) {
          const reader = new OfficeReader();
          office.current = reader;
          const views = await reader.open(file, await file.arrayBuffer());
          if (!active) {
            return;
          }
          if (!views.length) {
            throw new Error(t("fcboard.this_file_has_no_displayable_pages"));
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
            ).catch(() =>
              setNotice(
                t(
                  "fcboard.preview_is_available_but_the_resource_index_could_not_be_saved",
                ),
              ),
            );
          }
        } else {
          setPages([{ index: 0, name: "1" }]);
        }
      } catch (failure) {
        if (active) {
          setError(
            t("fcboard.could_not_open_document_error", {
              error: String(failure),
            }),
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
            t(
              "fcboard.could_not_save_annotations_keep_the_document_open_and_retry_error",
              {
                error: String(failure),
              },
            ),
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
          throw new Error(t("fcboard.page_number_out_of_range"));
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
        setNotice(
          t("fcboard.annotations_have_not_been_saved_please_try_again_shortly"),
        );
        throw new Error(
          t("fcboard.annotations_have_not_been_saved_keep_this_file_open"),
        );
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
      selectedInkRef.current = [];
      setLasso([]);
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
            throw new Error(t("fcboard.page_number_out_of_range"));
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
            throw new Error(
              t("fcboard.document_zoom_must_be_between_50_and_300"),
            );
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
          const chosen = commandObjectIds(
            ids,
            inkRef.current[pageRef.current] || [],
          );
          commitInk({
            ...inkRef.current,
            [pageRef.current]: (inkRef.current[pageRef.current] || []).filter(
              (stroke) => !chosen.has(stroke.id),
            ),
          });
          selectedInkRef.current = [];
          setLasso([]);
          return { ids: [...chosen] };
        },
      ),
      classroomCommands.register(
        "document.select",
        "选择指定课件板书，args.ids 为已存在板书id数组",
        (args) => {
          const ids = commandObjectIds(
            args.ids,
            inkRef.current[pageRef.current] || [],
            true,
          );
          selectedInkRef.current = (inkRef.current[pageRef.current] || [])
            .filter((stroke) => ids.has(stroke.id))
            .map((stroke) => stroke.id);
          setLasso([]);
          classroomCommands.changed("document");
          return { ids: [...ids] };
        },
      ),
      classroomCommands.register(
        "document.duplicate",
        "复制当前圈选板书",
        () => {
          const page = pageRef.current;
          const all = inkRef.current[page] || [];
          const selected = all.filter((stroke) =>
            selectedInkRef.current.includes(stroke.id),
          );
          if (!selected.length) {
            throw new Error(t("fcboard.circle_annotations_first"));
          }
          const area = visibleDocumentArea(
            stage.current,
            size,
            zoomRef.current,
            scroll,
          );
          const bounds = selected.map(documentStrokeBounds);
          const left = Math.min(...bounds.map((box) => box.left));
          const right = Math.max(...bounds.map((box) => box.right));
          const top = Math.min(...bounds.map((box) => box.top));
          const bottom = Math.max(...bounds.map((box) => box.bottom));
          const dx = Math.max(
            area.viewport.left - left,
            Math.min(24 / area.scale, area.viewport.right - right),
          );
          const dy = Math.max(
            area.viewport.top - top,
            Math.min(24 / area.scale, area.viewport.bottom - bottom),
          );
          const moved = (point: { x: number; y: number }) => ({
            x: point.x + dx,
            y: point.y + dy,
          });
          const ids = new Map<string, string>();
          const duplicateId = (id: string) => {
            if (!ids.has(id)) {
              ids.set(id, crypto.randomUUID());
            }
            return ids.get(id)!;
          };
          const copies = selected.map(
            (stroke): InkStroke => ({
              ...stroke,
              id: crypto.randomUUID(),
              lesson: undefined,
              commandId: undefined,
              language: stroke.language
                ? {
                    ...stroke.language,
                    group: duplicateId(stroke.language.group),
                  }
                : undefined,
              points: stroke.points.map(([x, y]) => [x + dx, y + dy]),
              anchor: stroke.anchor ? moved(stroke.anchor) : undefined,
              widget: stroke.widget
                ? {
                    ...stroke.widget,
                    id: duplicateId(stroke.widget.id),
                    origin: moved(stroke.widget.origin),
                  }
                : undefined,
              insertion: stroke.insertion
                ? {
                    ...stroke.insertion,
                    id: duplicateId(stroke.insertion.id),
                    origin: moved(stroke.insertion.origin),
                  }
                : undefined,
              plot: stroke.plot
                ? {
                    ...stroke.plot,
                    id: duplicateId(stroke.plot.id),
                    position: moved(stroke.plot.position),
                    origin: moved(stroke.plot.origin),
                  }
                : undefined,
              fcInk: stroke.fcInk?.rainbow
                ? {
                    ...stroke.fcInk,
                    rainbow: {
                      ...stroke.fcInk.rainbow,
                      x: stroke.fcInk.rainbow.x + dx,
                    },
                  }
                : stroke.fcInk,
            }),
          );
          selectedInkRef.current = copies.map((stroke) => stroke.id);
          setLasso((points) => points.map(([x, y]) => [x + dx, y + dy]));
          commitInk({ ...inkRef.current, [page]: [...all, ...copies] });
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
                "fcboard.use_the_pen_eraser_or_lasso_on_the_document_or_describe_text_or_shapes_to_insert",
              ),
            );
          }
          setInkOn(true);
          setErase(args.tool === "eraser");
          setSelecting(args.tool === "selection");
          if (args.tool !== "selection") {
            selectedInkRef.current = [];
            setLasso([]);
            classroomCommands.changed("document");
          }
        },
      ),
      classroomCommands.register(
        "document.style",
        "更改板书或圈选板书：args.color 十六进制颜色，width=1..30,fontSize=8..200,opacity=0..100,pen=hard|brush|highlighter|dashed|rainbow|text|shape|magic|function|calculation|language",
        (args) => {
          if (
            !Object.keys(args).length ||
            Object.keys(args).some(
              (key) =>
                !["color", "width", "fontSize", "opacity", "pen"].includes(key),
            )
          ) {
            throw new Error(
              t(
                "fcboard.you_can_adjust_annotation_color_pen_width_text_size_and_opacity",
              ),
            );
          }
          const penMode = (
            ["hard", "brush", "highlighter", "dashed", "rainbow"] as const
          ).find((value) => value === args.pen);
          const assist = inkAssistMode(args.pen);
          if (args.pen !== undefined && !penMode && !assist) {
            throw new Error(t("fcboard.unknown_pen_type"));
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
              throw new Error(t("fcboard.annotation_style_value_out_of_range"));
            }
          }
          if (
            args.width !== undefined &&
            (typeof args.width !== "number" ||
              !Number.isFinite(args.width) ||
              args.width < 1 ||
              args.width > 30)
          ) {
            throw new Error(t("fcboard.ink_width_out_of_range"));
          }
          if (
            args.color !== undefined &&
            (typeof args.color !== "string" ||
              !/^#[a-f0-9]{3}(?:[a-f0-9]{3})?$/i.test(args.color))
          ) {
            throw new Error(t("fcboard.invalid_annotation_color"));
          }
          if (penMode || assist) {
            api.updateScene({
              appState: {
                ...switchWhiteboardPen(api.getAppState(), penMode || "hard"),
                currentItemInkAssist: assist,
              },
            });
          }
          if (typeof args.color === "string") {
            api.updateScene({
              appState: { currentItemStrokeColor: args.color },
            });
          }
          if (typeof args.width === "number") {
            api.updateScene({
              appState: { currentItemStrokeWidth: args.width },
            });
          }
          if (typeof args.fontSize === "number") {
            setFontSize(args.fontSize);
          }
          if (typeof args.opacity === "number") {
            api.updateScene({ appState: { currentItemOpacity: args.opacity } });
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
          throw new Error(t("fcboard.annotation_text_is_empty_or_too_long"));
        }
        const strokes = inkRef.current[pageRef.current] || [];
        const sourceIds =
          Array.isArray(args.sourceIds) &&
          args.sourceIds.every((id) => typeof id === "string")
            ? args.sourceIds
            : args.placement === "center"
            ? []
            : selectedInkRef.current;
        const selected = strokes.filter((stroke) =>
          sourceIds.includes(stroke.id),
        );
        const sourceSignature = documentSourceSignature(selected);
        const language =
          args.language === undefined
            ? undefined
            : parseLanguageStudy(JSON.stringify(args.language));
        if (
          language &&
          (args.text !== language.translation ||
            !selected.length ||
            args.targetLanguage !== getLanguage().code)
        ) {
          throw new DOMException("Language source changed", "AbortError");
        }
        const languageGroup = language ? crypto.randomUUID() : undefined;
        if (args.sourceSignature && args.sourceSignature !== sourceSignature) {
          throw new DOMException("Document ink changed", "AbortError");
        }
        const replaceIds = new Set(
          args.placement === "replace" ? sourceIds : [],
        );
        const source = selected.find((stroke) => stroke.text) || selected[0];
        const presentation = args.presentation ?? currentSettings().answerStyle;
        if (!["match", "handwritten", "text"].includes(String(presentation))) {
          throw new Error(t("fcboard.unknown_answer_style"));
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
          throw new Error(t("fcboard.annotation_not_found"));
        }
        const boxes = selected.map(documentStrokeBounds);
        const bounds = boxes.length
          ? {
              left: Math.min(...boxes.map((box) => box.left)),
              top: Math.min(...boxes.map((box) => box.top)),
              right: Math.max(...boxes.map((box) => box.right)),
              bottom: Math.max(...boxes.map((box) => box.bottom)),
            }
          : undefined;
        const { scale, viewport } = visibleDocumentArea(
          stage.current,
          size,
          zoomRef.current,
          scroll,
        );
        const measuredSize =
          source?.fontSize ||
          (bounds && selected.some((stroke) => !stroke.text && !stroke.image)
            ? (bounds.bottom - bounds.top) /
              (typeof args.sourceLines === "number" &&
              args.sourceLines >= 1 &&
              args.sourceLines <= 1000
                ? args.sourceLines
                : 1)
            : pen.current.fontSize / scale);
        const layout = layoutBoardText(
          args.text,
          measuredSize,
          fontFamily,
          viewport,
          strokes
            .filter(
              (stroke) =>
                stroke.id !== existing?.id && !replaceIds.has(stroke.id),
            )
            .map(documentStrokeBounds),
          existing
            ? { x: existing.points[0][0], y: existing.points[0][1] }
            : args.placement === "replace" && bounds
            ? { x: bounds.left, y: bounds.top }
            : { x: viewport.left, y: viewport.top },
          8 / scale,
          {
            mode: existing
              ? "replace"
              : args.placement === "replace"
              ? "replace"
              : args.placement === "inline"
              ? "inline"
              : args.placement === "center"
              ? "center"
              : "below",
            bounds: existing ? undefined : bounds,
          },
        );
        if (!layout) {
          throw new Error(
            t(
              "fcboard.there_is_not_enough_visible_space_leave_some_room_for_writing",
            ),
          );
        }
        const next: InkStroke = existing
          ? {
              ...existing,
              text: layout.text,
              originalText: args.text,
              fontSize: layout.fontSize,
              lineHeight: layout.lineHeight,
              points: [[layout.x, layout.y]],
              ...(args.presentation !== undefined ? { fontFamily } : {}),
            }
          : {
              id: crypto.randomUUID(),
              text: layout.text,
              originalText: args.text,
              lineHeight: layout.lineHeight,
              points: [[layout.x, layout.y]],
              color: source?.color || pen.current.color,
              width: pen.current.penWidth,
              fontSize: layout.fontSize,
              fontFamily,
              opacity: source?.opacity ?? pen.current.opacity,
              ...(languageGroup
                ? { language: { group: languageGroup, source: false } }
                : {}),
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
        if (
          (args.signal instanceof AbortSignal && args.signal.aborted) ||
          (language && args.targetLanguage !== getLanguage().code) ||
          targetPage !== pageRef.current ||
          documentSourceSignature(
            (inkRef.current[targetPage] || []).filter((stroke) =>
              sourceIds.includes(stroke.id),
            ),
          ) !== sourceSignature
        ) {
          throw new DOMException("Document selection changed", "AbortError");
        }
        commitInk({
          ...inkRef.current,
          [targetPage]: [
            ...(inkRef.current[targetPage] || [])
              .filter(
                (stroke) => stroke.id !== next.id && !replaceIds.has(stroke.id),
              )
              .map((stroke) =>
                language && languageGroup && sourceIds.includes(stroke.id)
                  ? {
                      ...stroke,
                      language: {
                        group: languageGroup,
                        source: true,
                        ...(stroke.id === selected[0].id
                          ? {
                              study: language,
                              targetLanguage: String(args.targetLanguage),
                              signature: languageInkSignature(
                                selected.map((item) => item.points),
                              ),
                            }
                          : {}),
                      },
                    }
                  : stroke,
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
          throw new Error(t("fcboard.invalid_movement_distance"));
        }
        const ids = commandObjectIds(
          args.ids === undefined ? selectedInkRef.current : args.ids,
          inkRef.current[pageRef.current] || [],
        );
        commitInk({
          ...inkRef.current,
          [pageRef.current]: (inkRef.current[pageRef.current] || []).map(
            (stroke) =>
              ids.has(stroke.id)
                ? moveDocumentStroke(
                    stroke,
                    args.dx as number,
                    args.dy as number,
                  )
                : stroke,
          ),
        });
        return { ids: [...ids], dx: args.dx, dy: args.dy };
      }),
      classroomCommands.register(
        "document.close",
        "关闭课件并返回白板，板书自动保存",
        (args) => close(args.next !== false),
      ),
      classroomCommands.context("document.layout", () => ({
        ...visibleDocumentArea(stage.current, size, zoomRef.current, scroll),
        obstacles: (inkRef.current[pageRef.current] || []).map((stroke) => ({
          id: stroke.id,
          ...documentStrokeBounds(stroke),
        })),
      })),
      classroomCommands.context("document", () => ({
        configuration: canvasConfigurationSnapshot(
          penStateRef.current,
          deviceProfileRef.current,
          true,
        ),
        id: documentId.current,
        name: file.name,
        page: pageRef.current + 1,
        pages: pages.length,
        zoom: zoomRef.current,
        tool: documentTool.current,
        pen: pen.current,
        text: currentTextRef.current,
        ink: inkRef.current[pageRef.current] || [],
        selection: selectedInkRef.current,
        selectionInProgress: !!activePointer.current,
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
      classroomCommands.register("document.answer", "@internal", (args) => {
        const page = pageRef.current;
        const items = inkRef.current[page] || [];
        const anchor = String(args.anchor || "");
        const next = changeQuestionAnswer(
          items,
          anchor,
          items.find((item) => item.id === anchor)?.questionAnswer,
          args.ids as string[] | undefined,
        );
        commitInk(
          {
            ...inkRef.current,
            [page]: next.items.map((item) =>
              item.id === anchor
                ? { ...item, questionAnswer: next.answer }
                : item,
            ),
          },
          args.ids === undefined,
        );
        return {
          collapsed: !!next.answer.folded,
          count: next.answer.ids.length,
        };
      }),
      classroomCommands.register(
        "document.strokes",
        "@internal",
        async (args) => {
          if (args.signal instanceof AbortSignal) {
            args.signal.throwIfAborted();
          }
          const page = pageRef.current;
          const replaced = commandObjectIds(
            args.replaceIds ?? [],
            inkRef.current[page] || [],
            true,
          );
          const signature = () =>
            documentSourceSignature(
              (inkRef.current[page] || []).filter((stroke) =>
                replaced.has(stroke.id),
              ),
            );
          const before = signature();
          const elements = await prepareQuestionWriting(args, () => {
            const current = classroomCommands.read("document") as
              | { id?: string }
              | undefined;
            if (
              current?.id !== documentId.current ||
              pageRef.current !== page ||
              before !== signature()
            ) {
              throw new DOMException("Question target changed", "AbortError");
            }
            const { scale, viewport } = visibleDocumentArea(
              stage.current,
              size,
              zoomRef.current,
              scroll,
            );
            return {
              scale,
              viewport,
              obstacles: (inkRef.current[page] || [])
                .filter((stroke) => !replaced.has(stroke.id))
                .map(documentStrokeBounds),
              fontSize: pen.current.fontSize / scale,
              color: pen.current.color,
              width: pen.current.penWidth,
              opacity: pen.current.opacity,
            };
          });
          if (args.signal instanceof AbortSignal) {
            args.signal.throwIfAborted();
          }
          const current = classroomCommands.read("document") as
            | { id?: string }
            | undefined;
          if (
            current?.id !== documentId.current ||
            pageRef.current !== page ||
            before !== signature()
          ) {
            throw new DOMException("Question target changed", "AbortError");
          }
          const strokes = elements.map((element) => {
            if (element.type !== "text" && element.type !== "freedraw") {
              throw new Error(t("fcboard.invalid_annotation_coordinates"));
            }
            return shapeInk(element, "");
          });
          commitInk({
            ...inkRef.current,
            [page]: [
              ...(inkRef.current[page] || []).filter(
                (stroke) => !replaced.has(stroke.id),
              ),
              ...strokes,
            ],
          });
          const ids = strokes.map((stroke) => stroke.id);
          if (args.select !== false) {
            selectedInkRef.current = ids;
            classroomCommands.changed("document");
          }
          return { ids };
        },
      ),
      classroomCommands.register("document.draw", "@internal", (args) => {
        if (
          (args.signal instanceof AbortSignal && args.signal.aborted) ||
          (args.sourcePage !== undefined &&
            args.sourcePage !== pageRef.current + 1)
        ) {
          throw new DOMException("Document changed", "AbortError");
        }
        const replaceIds = new Set(
          Array.isArray(args.replaceIds) ? args.replaceIds : [],
        );
        if (
          args.sourceSignature &&
          documentSourceSignature(
            (inkRef.current[pageRef.current] || []).filter((stroke) =>
              replaceIds.has(stroke.id),
            ),
          ) !== args.sourceSignature
        ) {
          throw new DOMException("Document ink changed", "AbortError");
        }
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
        const shapes = args.shapes === undefined ? [args.shape] : args.shapes;
        if (!Array.isArray(shapes) || !shapes.length || shapes.length > 20000) {
          throw new Error(t("fcboard.invalid_lesson_command"));
        }
        const strokes = (shapes as ExcalidrawElementSkeleton[]).map((shape) =>
          shapeInk(
            shape,
            lesson,
            typeof args.image === "string" ? args.image : undefined,
          ),
        );
        const ids = new Set(strokes.map((stroke) => stroke.id));
        const groupId =
          typeof args.groupId === "string" ? args.groupId : strokes[0].id;
        if (!animationBefore.current.has(groupId)) {
          animationBefore.current.set(groupId, inkRef.current[page] || []);
        }
        if (args.progress === 1) {
          const before = animationBefore.current.get(groupId)!;
          const own = (stroke: InkStroke) =>
            typeof args.commandId === "string"
              ? stroke.lesson === lesson && stroke.commandId === args.commandId
              : ids.has(stroke.id);
          (past.current[page] ||= []).push([
            ...(inkRef.current[page] || []).filter((stroke) => !own(stroke)),
            ...before.filter(own),
          ]);
          future.current[page] = [];
          animationBefore.current.delete(groupId);
          refreshHistory((value) => value + 1);
        }
        commitInk(
          {
            ...inkRef.current,
            [page]: [
              ...(inkRef.current[page] || []).filter(
                (item) =>
                  !ids.has(item.id) &&
                  !replaceIds.has(item.id) &&
                  !(
                    typeof args.commandId === "string" &&
                    item.lesson === lesson &&
                    item.commandId === args.commandId
                  ),
              ),
              ...strokes,
            ],
          },
          false,
        );
      }),
      classroomCommands.register("document.resource", "@internal", (args) => {
        if (args.signal instanceof AbortSignal) {
          args.signal.throwIfAborted();
        }
        const resource = validateInteractiveResource(args.resource);
        const page = pageRef.current;
        const current = inkRef.current[page] || [];
        const { viewport, scale } = visibleDocumentArea(
          stage.current,
          size,
          zoomRef.current,
          scroll,
        );
        const position = resourcePlacement(
          viewport,
          current.map(documentStrokeBounds),
          scale,
        );
        const element = newIframeElement({
          type: "iframe",
          ...position,
          strokeWidth: 0,
          customData: { fcInteractiveResource: resource },
        });
        commitInk({
          ...inkRef.current,
          [page]: [...current, shapeInk(element, "resource")],
        });
        setInkOn(false);
        setSelecting(false);
        return { ids: [element.id] };
      }),
      classroomCommands.register("document.insertion", "@internal", (args) => {
        if (typeof args.id !== "string" || !Array.isArray(args.shapes)) {
          throw new Error(t("fcboard.invalid_insertion_data"));
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
          throw new Error(t("fcboard.invalid_teaching_tool_data"));
        }
        const strokes = (args.shapes as ExcalidrawElementSkeleton[]).map(
          (shape) => shapeInk(shape, "widget"),
        );
        const page = pageRef.current;
        const current = inkRef.current[page] || [];
        const selected = current.some(
          (stroke) =>
            stroke.widget?.id === widget.id &&
            selectedInkRef.current.includes(stroke.id),
        );
        const before = args.before as InkStroke[] | undefined;
        if (before !== undefined) {
          if (
            !Array.isArray(before) ||
            !before.length ||
            before.some((stroke) => stroke.widget?.id !== widget.id)
          ) {
            throw new Error(t("fcboard.invalid_teaching_tool_data"));
          }
          const history = (past.current[page] ||= []);
          history.push([
            ...current.filter((stroke) => stroke.widget?.id !== widget.id),
            ...before,
          ]);
          if (history.length > 100) {
            history.shift();
          }
          future.current[page] = [];
          refreshHistory((value) => value + 1);
        }
        if (selected) {
          selectedInkRef.current = strokes.map((stroke) => stroke.id);
        }
        commitInk(
          {
            ...inkRef.current,
            [page]: [
              ...current.filter((stroke) => stroke.widget?.id !== widget.id),
              ...strokes,
            ],
          },
          before === undefined && args.remember !== false,
        );
      }),
      classroomCommands.register("document.plot", "@internal", (args) => {
        setInkOn(true);
        if (!args.keepTool) {
          setSelecting(true);
        }
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
    api,
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

  const penConfiguration = JSON.stringify([
    penState.currentItemInkAssist,
    penState.currentItemPenMode,
    penState.whiteboardPenTip,
    penState.whiteboardPenTips,
    penState.whiteboardDualPen,
    langCode,
  ]);
  const previousPenConfiguration = useRef(penConfiguration);
  useEffect(() => {
    if (previousPenConfiguration.current !== penConfiguration) {
      previousPenConfiguration.current = penConfiguration;
      Object.values(inkRef.current)
        .flat()
        .forEach((stroke) => recognized.current.add(stroke.id));
      assistRequest.current?.abort();
    }
  }, [penConfiguration]);
  const drawing = !!draft;
  useEffect(() => {
    if (!ready || loading || !inkOn || erase || selecting || drawing) {
      return;
    }
    const currentInk = inkRef.current[page] || [];
    const targets = insertionWritingTargets(documentWritingParts(currentInk));
    const targetFor = (stroke: InkStroke) =>
      !stroke.fcInk?.assist || stroke.fcInk.assist === "text"
        ? insertionWritingAt(targets, stroke.points[0])
        : undefined;
    const pending = currentInk.filter((stroke) => {
      if (
        stroke.lesson ||
        stroke.questionInput ||
        stroke.language ||
        !stroke.fcInk ||
        recognized.current.has(stroke.id)
      ) {
        return false;
      }
      if (stroke.fcInk.assist || targetFor(stroke)) {
        return true;
      }
      recognized.current.add(stroke.id);
      return false;
    });
    const last = pending.at(-1);
    const target = last ? targetFor(last) : undefined;
    const assistMode = target ? "text" : last?.fcInk?.assist;
    const source = pending.filter((stroke) =>
      target
        ? targetFor(stroke)?.key === target.key
        : !targetFor(stroke) && stroke.fcInk?.assist === assistMode,
    );
    if (!source.length || !assistMode) {
      return;
    }
    const signature = documentSourceSignature(source);
    const requestKey = `${signature}:${target?.stamp || ""}`;
    if (failedRecognition.current.has(requestKey)) {
      return;
    }
    const request = new AbortController();
    assistRequest.current = request;
    const sourceIds = source.map((stroke) => stroke.id);
    const current = () =>
      !request.signal.aborted &&
      pageRef.current === page &&
      (!target ||
        insertionWritingTargets(
          documentWritingParts(inkRef.current[page] || []),
        ).some(
          (item) => item.key === target.key && item.stamp === target.stamp,
        )) &&
      documentSourceSignature(
        (inkRef.current[page] || []).filter((stroke) =>
          sourceIds.includes(stroke.id),
        ),
      ) === signature;
    const since = Date.now();
    const timer = setTimeout(
      () => {
        void (async () => {
          const boxes = source.map(documentStrokeBounds);
          const left = Math.min(...boxes.map((box) => box.left));
          const top = Math.min(...boxes.map((box) => box.top));
          const right = Math.max(...boxes.map((box) => box.right));
          const bottom = Math.max(...boxes.map((box) => box.bottom));
          const result = await recognizeInkContent(
            assistMode,
            () => inkSnapshot(source, bottom - top + 32, undefined, top - 16),
            source.map((stroke) => stroke.points),
            request.signal,
            target?.insertion.kind === "fourline" ? "en-US" : undefined,
          );
          await settleInkRecognition(assistMode, since, request.signal);
          if (!current()) {
            return;
          }
          if (target && result.kind === "text") {
            const shape = insertionWritingText(
              target,
              result.text,
              source[0].color,
              sourceIds,
            );
            if (!shape) {
              return;
            }
            const current = inkRef.current[page] || [];
            const remove = new Set([
              ...sourceIds,
              ...insertionWritingTextIds(target, documentWritingParts(current)),
            ]);
            sourceIds.forEach((id) => recognized.current.add(id));
            commitInk({
              ...inkRef.current,
              [page]: [
                ...current.filter((stroke) => !remove.has(stroke.id)),
                shapeInk(shape, "insertion"),
              ],
            });
          } else if (result.kind === "language") {
            sourceIds.forEach((id) => recognized.current.add(id));
            await classroomCommands.execute({
              name: "document.text",
              args: {
                text: result.study.translation,
                presentation: "handwritten",
                placement: "below",
                sourceIds,
                sourceSignature: signature,
                sourceLines: result.text.split("\n").length,
                language: result.study,
                targetLanguage: result.targetLanguage,
                signal: request.signal,
              },
            });
          } else if (result.kind === "text" || result.kind === "calculation") {
            const text =
              result.kind === "text"
                ? result.text
                : `${
                    /=\s*$/.test(result.text) || /^[xyz] =/.test(result.answer)
                      ? ""
                      : "= "
                  }${result.answer}`;
            await classroomCommands.execute({
              name: "document.text",
              args: {
                text,
                presentation: result.kind === "text" ? "text" : "match",
                placement: result.kind === "text" ? "replace" : "inline",
                sourceIds,
                sourceSignature: signature,
                sourceLines: result.text.split("\n").length,
                signal: request.signal,
              },
            });
          } else if (result.kind === "function") {
            drawPlot(
              api,
              result.plot,
              { x: right + 240, y: top + 230 },
              [],
              signature,
              true,
              { left, top, right, bottom },
            );
          } else if (result.kind === "magic") {
            await insertGeneratedImage(api, result.prompt, request.signal, {
              referenceImage: result.image,
              bounds: { left, top, right, bottom },
              replaceIds: sourceIds,
              sourceSignature: signature,
              sourcePage: page + 1,
            });
          } else {
            const width = Math.max(1, right - left);
            const height = Math.max(1, bottom - top);
            const first = source[0].points[0];
            const last = source.at(-1)!.points.at(-1)!;
            const shape: ExcalidrawElementSkeleton =
              result.shape === "triangle"
                ? {
                    type: "line",
                    x: left + width / 2,
                    y: top,
                    points: [
                      pointFrom(0, 0),
                      pointFrom(width / 2, height),
                      pointFrom(-width / 2, height),
                      pointFrom(0, 0),
                    ],
                  }
                : result.shape === "line" || result.shape === "arrow"
                ? {
                    type: result.shape,
                    x: first[0],
                    y: first[1],
                    points: [
                      pointFrom(0, 0),
                      pointFrom(last[0] - first[0], last[1] - first[1]),
                    ],
                  }
                : { type: result.shape, x: left, y: top, width, height };
            const stroke = shapeInk(
              {
                ...shape,
                id: crypto.randomUUID(),
                strokeWidth: source[0].width,
                strokeColor: source[0].color,
                opacity: source[0].opacity ?? 100,
              },
              "recognized",
            );
            commitInk({
              ...inkRef.current,
              [page]: [
                ...(inkRef.current[page] || []).filter(
                  (stroke) => !sourceIds.includes(stroke.id),
                ),
                stroke,
              ],
            });
          }
          sourceIds.forEach((id) => recognized.current.add(id));
        })().catch(() => {
          if (!request.signal.aborted) {
            failedRecognition.current.add(requestKey);
            if (failedRecognition.current.size > 100) {
              failedRecognition.current.delete(
                failedRecognition.current.values().next().value!,
              );
            }
          }
        });
      },
      assistMode === "function" || assistMode === "calculation" ? 350 : 700,
    );
    return () => {
      clearTimeout(timer);
      request.abort();
    };
  }, [
    ink,
    page,
    drawing,
    ready,
    loading,
    inkOn,
    erase,
    selecting,
    scroll,
    zoom,
    api,
    commitInk,
    langCode,
  ]);
  useEffect(
    () => classroomCommands.onInvalidate(() => assistRequest.current?.abort()),
    [],
  );

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
    const previous = inkRef.current[gesturePage.current] || [];
    const next = (
      gesture.mode === "object" ? eraseDocumentObjects : eraseDocumentInk
    )(previous, gesture.previous, position, gesture.width, gesture.height);
    gesture.previous = position;
    if (next !== previous) {
      commitInk({ ...inkRef.current, [gesturePage.current]: next }, false);
    }
  };
  const cancelInkGesture = useCallback(() => {
    assistRequest.current?.abort();
    const owner = activePointer.current;
    activePointer.current = null;
    if (erasing.current) {
      commitInk(
        { ...inkRef.current, [gesturePage.current]: gestureBefore.current },
        false,
      );
    }
    if (selectionGesture.current) {
      if (selectionGesture.current.handle === "move") {
        commitInk(
          { ...inkRef.current, [gesturePage.current]: gestureBefore.current },
          false,
        );
      }
      selectedInkRef.current = selectionGesture.current.ids;
      setLasso(selectionGesture.current.before);
      selectionGesture.current = null;
      classroomCommands.changed("document");
    }
    erasing.current = null;
    draftRef.current = null;
    setDraft(null);
    setEraserPreview(null);
    if (owner?.target.hasPointerCapture(owner.id)) {
      owner.target.releasePointerCapture(owner.id);
    }
  }, [commitInk]);
  useEffect(() => {
    cancelInkGesture();
    setPenAnchor(null);
    setEraserAnchor(null);
  }, [inkOn, erase, selecting, page, zoom, scroll, cancelInkGesture]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        cancelInkGesture();
      }
    };
    window.addEventListener("blur", cancelInkGesture);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("blur", cancelInkGesture);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [cancelInkGesture]);
  const eraseContact = (
    event: Pick<
      PointerEvent,
      "pointerType" | "width" | "height" | "button" | "buttons"
    >,
  ) =>
    erase ||
    (event.pointerType === "pen" &&
      (event.button === 2 || event.button === 5 || !!(event.buttons & 34))) ||
    (!selecting &&
      api.getAppState().palmEraser !== false &&
      isPalmContact(
        event,
        api.getAppState().palmEraserThreshold ??
          inkProfile?.palmThreshold ??
          36,
      ));
  const startErasure = (
    event: React.PointerEvent<SVGSVGElement>,
    position: [number, number],
    contact = event.nativeEvent,
  ) => {
    const scale = 1000 / event.currentTarget.getBoundingClientRect().width;
    const size = Math.max(
      12,
      Math.min(
        240,
        api.getAppState().eraserSize ?? inkProfile?.eraserSize ?? 60,
      ),
    );
    const palm =
      api.getAppState().palmEraser !== false &&
      isPalmContact(
        contact,
        api.getAppState().palmEraserThreshold ??
          inkProfile?.palmThreshold ??
          36,
      );
    erasing.current = {
      mode:
        erase &&
        !palm &&
        !(
          contact.pointerType === "pen" &&
          (contact.button === 2 ||
            contact.button === 5 ||
            !!(contact.buttons & 34))
        )
          ? api.getAppState().eraserMode || "stroke"
          : "stroke",
      previous: position,
      width: (palm ? Math.max(size, contact.width) : size) * scale,
      height:
        (palm ? Math.max(size * 1.2, contact.height) : size * 1.2) * scale,
    };
    draftRef.current = null;
    setDraft(null);
  };
  const updateInkGesture = (event: React.PointerEvent<SVGSVGElement>) => {
    if (
      activePointer.current?.id !== event.pointerId ||
      !event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      return false;
    }
    if (gesturePage.current !== pageRef.current) {
      cancelInkGesture();
      return false;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const events = pointerSamples(event.nativeEvent);
    const samples = events.map((sample): [number, number] => [
      ((sample.clientX - rect.left) / rect.width) * 1000,
      ((sample.clientY - rect.top) / rect.width) * 1000 + scroll,
    ]);
    const selection = selectionGesture.current;
    if (selection?.bounds && selection.handle) {
      const [x, y] = samples.at(-1)!;
      const area = visibleDocumentArea(
        stage.current,
        size,
        zoomRef.current,
        scroll,
      );
      if (selection.handle === "move") {
        const dx = x - selection.origin[0];
        const dy = y - selection.origin[1];
        setLasso(selection.before.map(([px, py]) => [px + dx, py + dy]));
        const ids = new Set(selection.ids);
        if (!dx && !dy && inkRef.current[page] === gestureBefore.current) {
          return true;
        }
        commitInk(
          {
            ...inkRef.current,
            [page]:
              !dx && !dy
                ? gestureBefore.current
                : gestureBefore.current.map((stroke) =>
                    ids.has(stroke.id)
                      ? moveDocumentStroke(stroke, dx, dy)
                      : stroke,
                  ),
          },
          false,
        );
      } else {
        setLasso(
          regionPath(
            resizeRegion(
              selection.bounds,
              selection.handle,
              { x, y },
              area.viewport,
              area.scale,
            ),
          ),
        );
      }
      return true;
    }
    let from = 0;
    if (!erasing.current) {
      from = events.findIndex(eraseContact);
      if (from >= 0) {
        startErasure(event, samples[from], events[from]);
      } else {
        from = 0;
      }
    }
    if (erasing.current) {
      samples.slice(from).forEach(removeAt);
      setEraserPreview({ ...erasing.current, position: samples.at(-1)! });
    } else if (draftRef.current) {
      if (selection && !selection.started) {
        const bounds = selection.extent;
        for (const [x, y] of samples) {
          bounds.left = Math.min(bounds.left, x);
          bounds.right = Math.max(bounds.right, x);
          bounds.top = Math.min(bounds.top, y);
          bounds.bottom = Math.max(bounds.bottom, y);
        }
        if (
          (Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top) *
            rect.width) /
            1000 >=
          DRAGGING_THRESHOLD
        ) {
          selection.started = true;
          selectedInkRef.current = [];
          setLasso([]);
        }
      }
      const stroke = {
        ...draftRef.current,
        points: [...draftRef.current.points, ...samples],
        pressures: draftRef.current.simulatePressure
          ? []
          : [
              ...(draftRef.current.pressures || []),
              ...events.map((sample) => sample.pressure),
            ],
      };
      draftRef.current = stroke;
      setDraft(stroke);
    }
    return true;
  };
  const paths = [...(ink[page] || []), ...(draft ? [draft] : [])];
  const regionBounds =
    lasso.length === 4
      ? {
          left: lasso[0][0],
          top: lasso[0][1],
          right: lasso[2][0],
          bottom: lasso[2][1],
        }
      : undefined;
  return (
    <section
      ref={dialog}
      tabIndex={-1}
      className="fc-preview fc-presentation"
      role="dialog"
      aria-modal="false"
      aria-label={t("fcboard.preview_name", { name: file.name })}
      onKeyDown={(event) => {
        event.stopPropagation();
        if ((event.target as HTMLElement).closest("input,select,textarea")) {
          return;
        }
        if (event.key === "Escape") {
          if (eraserAnchor) {
            setEraserAnchor(null);
          } else if (penAnchor) {
            setPenAnchor(null);
          } else if (inkOn) {
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
            {isImage && url && (
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
            onDoubleClick={(event) => {
              const languageId = (event.target as Element)
                .closest("[data-language]")
                ?.getAttribute("data-language");
              if (languageId) {
                event.preventDefault();
                event.stopPropagation();
                void classroomCommands
                  .execute({ name: "language.card", args: { id: languageId } })
                  .catch(() => {});
                return;
              }
              const id = (event.target as Element)
                .closest("[data-widget]")
                ?.getAttribute("data-widget");
              const widget = (inkRef.current[pageRef.current] || []).find(
                (stroke) => stroke.widget?.id === id,
              )?.widget;
              if (widget && ["cube", "cylinder"].includes(widget.kind)) {
                event.preventDefault();
                event.stopPropagation();
                void classroomCommands
                  .execute({
                    name: "tools.configure",
                    args: {
                      id: widget.id,
                      solid: {
                        unfold: widget.params.solid.unfold >= 0.5 ? 0 : 1,
                      },
                    },
                  })
                  .catch((failure) =>
                    setNotice(
                      failure instanceof Error
                        ? failure.message
                        : String(failure),
                    ),
                  );
              }
            }}
            onContextMenu={(event) => event.preventDefault()}
            aria-label={t("fcboard.document_annotations")}
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
              if (
                !event.isPrimary ||
                (event.button !== 0 &&
                  !(
                    event.pointerType === "pen" &&
                    (event.button === 2 || event.button === 5)
                  ))
              ) {
                return;
              }
              if (activePointer.current) {
                cancelInkGesture();
              }
              assistRequest.current?.abort();
              if (classroomCommands.has("lesson.pause")) {
                void classroomCommands.execute({ name: "lesson.pause" });
              }
              gestureBefore.current = inkRef.current[page] || [];
              gesturePage.current = page;
              activePointer.current = {
                id: event.pointerId,
                target: event.currentTarget,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
              if (eraseContact(event)) {
                const position = point(event);
                startErasure(event, position);
                removeAt(position);
                setEraserPreview({ ...erasing.current!, position });
              } else {
                if (selecting) {
                  const origin = point(event);
                  const bounds =
                    lasso.length === 4
                      ? {
                          left: lasso[0][0],
                          top: lasso[0][1],
                          right: lasso[2][0],
                          bottom: lasso[2][1],
                        }
                      : undefined;
                  const handle = bounds
                    ? regionHandleAt(
                        bounds,
                        { x: origin[0], y: origin[1] },
                        ((event.pointerType === "touch" ? 16 : 10) * 1000) /
                          event.currentTarget.getBoundingClientRect().width,
                      )
                    : null;
                  selectionGesture.current = {
                    before: lasso,
                    ids: selectedInkRef.current,
                    bounds,
                    handle,
                    origin,
                    extent: {
                      left: origin[0],
                      right: origin[0],
                      top: origin[1],
                      bottom: origin[1],
                    },
                    started: false,
                  };
                  classroomCommands.changed("document");
                  if (handle) {
                    return;
                  }
                }
                const style = whiteboardInkStyle(
                  api.getAppState(),
                  event,
                  inkProfile,
                  1000 / event.currentTarget.getBoundingClientRect().width,
                );
                if (style.customData.fcInk.pen === "rainbow") {
                  style.customData.fcInk.rainbow = { x: 0, width: 1000 };
                }
                const stroke: InkStroke = {
                  id: crypto.randomUUID(),
                  color: selecting ? "#245bd6" : style.strokeColor,
                  width: selecting ? 1.5 : style.strokeWidth,
                  opacity: selecting ? 100 : style.opacity,
                  fcInk: selecting ? undefined : style.customData.fcInk,
                  strokeStyle: selecting ? "dashed" : style.strokeStyle,
                  simulatePressure: style.simulatePressure,
                  pressures: style.simulatePressure ? [] : [event.pressure],
                  points: [point(event)],
                };
                draftRef.current = stroke;
                setDraft(stroke);
              }
            }}
            onPointerMove={updateInkGesture}
            onPointerUp={(event) => {
              if (!updateInkGesture(event)) {
                return;
              }
              let inspectPlot = false;
              if (selecting && selectionGesture.current) {
                const area = visibleDocumentArea(
                  stage.current,
                  size,
                  zoomRef.current,
                  scroll,
                );
                const selection = selectionGesture.current;
                const end = point(event);
                const bounds = draftRef.current
                  ? circleRegion(
                      draftRef.current.points,
                      area.viewport,
                      area.scale,
                    )
                  : selection.bounds && selection.handle
                  ? selection.handle === "move"
                    ? {
                        left:
                          selection.bounds.left + end[0] - selection.origin[0],
                        right:
                          selection.bounds.right + end[0] - selection.origin[0],
                        top:
                          selection.bounds.top + end[1] - selection.origin[1],
                        bottom:
                          selection.bounds.bottom +
                          end[1] -
                          selection.origin[1],
                      }
                    : resizeRegion(
                        selection.bounds,
                        selection.handle,
                        { x: end[0], y: end[1] },
                        area.viewport,
                        area.scale,
                      )
                  : undefined;
                selectedInkRef.current =
                  selection.handle === "move"
                    ? selection.ids
                    : bounds
                    ? selectDocumentRegion(inkRef.current[page] || [], bounds)
                    : selection.ids;
                setLasso(bounds ? regionPath(bounds) : selection.before);
                // A deliberate plot tap keeps the existing parameter editor.
                // Ordinary taps and circle gestures never enter object editing.
                if (
                  !bounds &&
                  !selection.handle &&
                  classroomCommands.has("math.inspect")
                ) {
                  const plot = gestureBefore.current.find(
                    (stroke) =>
                      stroke.plot && hitStroke(stroke, selection.origin),
                  )?.plot;
                  if (plot) {
                    selectedInkRef.current = gestureBefore.current
                      .filter((stroke) => stroke.plot?.id === plot.id)
                      .map((stroke) => stroke.id);
                    inspectPlot = true;
                  }
                }
                if (
                  selectionGesture.current.handle === "move" &&
                  gestureBefore.current !== inkRef.current[page]
                ) {
                  (past.current[page] ||= []).push(gestureBefore.current);
                  future.current[page] = [];
                  refreshHistory((value) => value + 1);
                }
                selectionGesture.current = null;
              } else if (draftRef.current) {
                const stroke = {
                  ...draftRef.current,
                  fcInk: finishFactoryInk(draftRef.current.fcInk),
                };
                commitInk({
                  ...inkRef.current,
                  [page]: [...(inkRef.current[page] || []), stroke],
                });
              } else if (
                erasing.current &&
                gestureBefore.current !== inkRef.current[page]
              ) {
                (past.current[page] ||= []).push(gestureBefore.current);
                future.current[page] = [];
                refreshHistory((value) => value + 1);
              }
              activePointer.current = null;
              if (selecting) {
                classroomCommands.changed("document");
              }
              erasing.current = null;
              draftRef.current = null;
              setDraft(null);
              setEraserPreview(null);
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              if (inspectPlot) {
                void classroomCommands.execute({ name: "math.inspect" });
              }
            }}
            onPointerCancel={(event) => {
              if (activePointer.current?.id === event.pointerId) {
                cancelInkGesture();
              }
            }}
            onLostPointerCapture={(event) => {
              if (activePointer.current?.id === event.pointerId) {
                cancelInkGesture();
              }
            }}
          >
            {regionBounds && (
              <g
                data-document-region
                pointerEvents="none"
                fill="none"
                stroke="#245bd6"
              >
                <rect
                  x={regionBounds.left}
                  y={regionBounds.top}
                  width={regionBounds.right - regionBounds.left}
                  height={regionBounds.bottom - regionBounds.top}
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray="4 4"
                />
                <path
                  d={regionCorners(regionBounds, (size.width * zoom) / 1000)
                    .map(
                      (points) =>
                        `M${points.map((point) => point.join(",")).join(" L")}`,
                    )
                    .join(" ")}
                  strokeWidth="3"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )}
            {paths.map((stroke) =>
              stroke.resource ? (
                <foreignObject
                  key={stroke.id}
                  x={stroke.points[0][0]}
                  y={stroke.points[0][1]}
                  width={stroke.resource.width}
                  height={stroke.resource.height}
                  opacity={(stroke.opacity ?? 100) / 100}
                  style={{ pointerEvents: inkOn ? "none" : "auto" }}
                >
                  <InteractiveResourceFrame
                    resource={stroke.resource}
                    objectId={stroke.id}
                    surface="document"
                  />
                </foreignObject>
              ) : stroke.image ? (
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
                  data-language={stroke.language ? stroke.id : undefined}
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
                      dy={
                        index
                          ? (stroke.fontSize || 26) * (stroke.lineHeight || 1.3)
                          : 0
                      }
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
              ) : (
                <StrokePath key={stroke.id} stroke={stroke} />
              ),
            )}
            {eraserPreview && (
              <image
                aria-hidden="true"
                pointerEvents="none"
                href={factoryEraser}
                x={eraserPreview.position[0] - eraserPreview.width / 2}
                y={eraserPreview.position[1] - eraserPreview.height / 2}
                width={eraserPreview.width}
                height={eraserPreview.height}
              />
            )}
          </svg>
        </div>
      </div>
      <TransientMessage
        className="fc-document-status"
        role={error ? "alert" : "status"}
        message={error || notice}
      />
      {penAnchor && (
        <ClickAwayListener onClickAway={() => setPenAnchor(null)}>
          <Popper
            open
            anchorEl={penAnchor}
            container={dialog.current}
            placement="top"
            sx={{ zIndex: 1300 }}
            modifiers={[
              { name: "offset", options: { offset: [0, 16] } },
              { name: "preventOverflow", options: { padding: 12 } },
            ]}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setPenAnchor(null);
              }
            }}
          >
            <MaterialPanel
              className="fc-pen-properties fc-document-pen-settings"
              role="dialog"
              aria-label={t("fcboard.pen")}
            >
              <FactoryPenSettings
                state={penState}
                app={{ api, props: { UIOptions: { inkProfile } } }}
                close={() => setPenAnchor(null)}
              />
            </MaterialPanel>
          </Popper>
        </ClickAwayListener>
      )}
      {eraserAnchor && (
        <ClickAwayListener onClickAway={() => setEraserAnchor(null)}>
          <Popper
            open
            anchorEl={eraserAnchor}
            container={dialog.current}
            placement="top"
            sx={{ zIndex: 1300 }}
            modifiers={[
              { name: "offset", options: { offset: [0, 12] } },
              { name: "preventOverflow", options: { padding: 12 } },
            ]}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setEraserAnchor(null);
              }
            }}
          >
            <MaterialPanel
              className="fc-document-eraser-settings"
              role="dialog"
              aria-label={t("fcboard.eraser_settings")}
            >
              <label>
                {t("fcboard.erase_mode")}
                <MaterialSelect
                  aria-label={t("fcboard.erase_mode")}
                  value={penState.eraserMode || "stroke"}
                  onChange={(event) => {
                    try {
                      applyCanvasConfiguration(
                        api,
                        canvasConfigurationPatch(
                          api,
                          { eraserMode: event.target.value },
                          inkProfile,
                        ),
                      );
                    } catch (failure) {
                      setNotice(
                        failure instanceof Error
                          ? failure.message
                          : String(failure),
                      );
                    }
                  }}
                >
                  <option value="stroke">
                    {t("fcboard.erase_part_of_a_stroke")}
                  </option>
                  <option value="object">
                    {t("fcboard.erase_entire_object")}
                  </option>
                </MaterialSelect>
              </label>
              <label>
                {t("fcboard.eraser_size_screen_pixels")}
                <Slider
                  aria-label={t("fcboard.eraser_size_screen_pixels")}
                  min={12}
                  max={240}
                  value={penState.eraserSize ?? inkProfile?.eraserSize ?? 60}
                  valueLabelDisplay="auto"
                  onChange={(_, value) => {
                    try {
                      applyCanvasConfiguration(
                        api,
                        canvasConfigurationPatch(
                          api,
                          { eraserSize: value },
                          inkProfile,
                        ),
                      );
                    } catch (failure) {
                      setNotice(
                        failure instanceof Error
                          ? failure.message
                          : String(failure),
                      );
                    }
                  }}
                />
              </label>
            </MaterialPanel>
          </Popper>
        </ClickAwayListener>
      )}
      <footer
        className="fc-presentation-toolbar"
        role="toolbar"
        aria-label={t("fcboard.document_toolbar")}
      >
        <button
          aria-label={t("fcboard.close_document")}
          title={t("fcboard.return_to_board")}
          onClick={() => {
            void close().catch(() => {});
          }}
        >
          {CloseIcon}
          <span>{t("fcboard.board")}</span>
        </button>
        <span className="fc-document-name" title={file.name}>
          {file.name}
        </span>
        <button
          aria-label={t("fcboard.previous_page")}
          disabled={page === 0 || loading}
          onClick={() => {
            void previous().catch((failure) => setError(String(failure)));
          }}
        >
          {chevronLeftIcon}
          <span>{t("fcboard.previous")}</span>
        </button>
        <MaterialSelect
          aria-label={t("fcboard.document_page")}
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
        </MaterialSelect>
        <button
          aria-label={t("fcboard.next_page")}
          disabled={loading || (page >= pages.length - 1 && !pendingAnimation)}
          onClick={() => {
            void next().catch((failure) => setError(String(failure)));
          }}
        >
          {chevronRight}
          <span>{t("fcboard.next")}</span>
        </button>
        <button
          aria-label={t("fcboard.toggle_annotations")}
          title={t("fcboard.annotate_document")}
          aria-pressed={inkOn && !erase && !selecting}
          aria-expanded={!!penAnchor}
          disabled={loading || !!error}
          onClick={(event) => {
            if (inkOn && !erase && !selecting) {
              setPenAnchor(penAnchor ? null : event.currentTarget);
            } else {
              setInkOn(true);
              setErase(false);
              setSelecting(false);
            }
          }}
        >
          {pencilIcon}
          <span>{t("fcboard.annotate")}</span>
        </button>
        <button
          aria-label={t("fcboard.zoom_out_document")}
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
          aria-label={t("fcboard.reset_document_zoom")}
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
          aria-label={t("fcboard.zoom_in_document")}
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
                aria-label={t("fcboard.pen_color_color", { color: value })}
                aria-pressed={color === value && !erase}
                onClick={() => {
                  api.updateScene({
                    appState: { currentItemStrokeColor: value },
                  });
                  setErase(false);
                  setSelecting(false);
                }}
              >
                <span className="fc-ink-color" style={{ background: value }} />
              </button>
            ))}
            <button
              aria-label={t("fcboard.erase_annotations")}
              aria-pressed={erase}
              aria-expanded={!!eraserAnchor}
              onClick={(event) => {
                if (erase) {
                  setEraserAnchor(eraserAnchor ? null : event.currentTarget);
                } else {
                  setErase(true);
                }
                setSelecting(false);
              }}
            >
              {EraserIcon}
              <span>{t("fcboard.eraser")}</span>
            </button>
            <button
              aria-label={t("fcboard.circle_document_annotations")}
              aria-pressed={selecting}
              onClick={() => {
                setSelecting(true);
                setErase(false);
              }}
            >
              {SelectionIcon}
              <span>{t("fcboard.circle")}</span>
            </button>
            <button
              aria-label={t("fcboard.undo_annotation")}
              disabled={!past.current[page]?.length}
              onClick={() => undoInk()}
            >
              {UndoIcon}
              <span>{t("fcboard.undo")}</span>
            </button>
            <button
              aria-label={t("fcboard.redo_annotation")}
              disabled={!future.current[page]?.length}
              onClick={() => undoInk(true)}
            >
              {RedoIcon}
              <span>{t("fcboard.redo")}</span>
            </button>
          </>
        )}
        <a
          href={url}
          download={file.name}
          aria-label={t("fcboard.download_original_file")}
          title={t("fcboard.download_original_file")}
        >
          {exportToFileIcon}
          <span>{t("fcboard.original")}</span>
        </a>
        {onVoice && (
          <button
            aria-label={t("fcboard.document_voice_commands")}
            title={t("fcboard.give_a_command_about_this_page")}
            aria-pressed={listening}
            onClick={onVoice}
          >
            {microphoneIcon}
            <span>{t("fcboard.voice")}</span>
          </button>
        )}
        <button
          aria-label={t("fcboard.document_ai_teacher")}
          title={t("fcboard.ask_or_control_this_document")}
          onClick={() => {
            void classroomCommands.execute({ name: "assistant.open" });
          }}
        >
          {MagicIcon}
          <span>{t("fcboard.assistant")}</span>
        </button>
        {onTools && (
          <button
            aria-label={t("fcboard.document_teaching_tools")}
            title={t("fcboard.teaching_tools")}
            onClick={onTools}
          >
            {gridIcon}
            <span>{t("fcboard.teaching_widgets")}</span>
          </button>
        )}
      </footer>
    </section>
  );
};
