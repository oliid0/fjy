import { t, useI18n } from "@fcboard/fcboard/i18n";
import { useEffect, useRef, useState } from "react";
import Paper from "@mui/material/Paper";
import ButtonBase from "@mui/material/ButtonBase";

import {
  getCommonBounds,
  newElementWith,
  CaptureUpdateAction,
} from "@fcboard/element";

import type { FcboardElement } from "@fcboard/element/types";

import type { DataURL } from "@fcboard/fcboard/types";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { SelectionImageCrop } from "./SelectionImageCrop";

import { TransientMessage } from "./TransientMessage";

import { boardContext, chat, visualMessage, cropImage, selectedBoardElements } from "./ai";
import { classroomCommands } from "./commands";
import {
  selectionPathBounds,
  selectionSignature,
  selectionToolbarPosition,
} from "./selection";
import { handwritingText } from "./handwriting";
import { recognizeHandwriting } from "./ocr";
import { currentSettings, SETTINGS_CHANGED } from "./settings";
import { documentStrokeBounds, documentSourceSignature } from "./documents";
import { SelectionAI } from "./SelectionAI";
import { SelectionIcon, SelectionProperties } from "./SelectionProperties";
import {
  boardSelectionProperties,
  documentSelectionProperties,
} from "./selectionCapabilities";

import { creativeImagePrompt } from "./selectionImagePrompt";
import { insertText } from "./board";
import { generateImage, insertImageResult } from "./imageGeneration";
import { readWidgets, solidWidgetKinds } from "./widgets";
import { SolidActions } from "./SolidActions";
import { boardInk, clipInk } from "./digitalInk";
import { updateQuestionAnswer } from "./questionAnswer";
import { readInsertions } from "./insertObjects";
import { TableActions } from "./TableActions";
import { functionSelection, mergeFunctions } from "./functionMerge";

import type { CropFrame } from "./imageCropGeometry";

import type { SelectionPropertiesState } from "./selectionCapabilities";

import type { InkStroke } from "./documents";
import type { Widget } from "./widgets";
import type { InsertObject } from "./insertObjects";

const selectionActions = ["question", "creative", "quiz", "search"] as const;
type Action = typeof selectionActions[number];
type Region = { left: number; top: number; right: number; bottom: number };
type Target = {
  source: readonly FcboardElement[];
  signature: string;
  canSearch: boolean;
  canAI: boolean;
  canStudy: boolean;
  studyRegion?: Region;
  canMerge: boolean;
  properties: SelectionPropertiesState;
  left: number;
  top: number;
  width: number;
  region?: Region;
  document?: {
    crop: Region;
    hasObjects: boolean;
    ids: string[];
    bounds: Region;
    signature: string;
    page: number;
  };
  solid?: Widget;
  table?: InsertObject;
  answer?: { anchor: string; collapsed: boolean };
};
type DocumentContext = {
  selectionInProgress?: boolean;
  name: string;
  page: number;
  ink: InkStroke[];
  selection: string[];
  region: [number, number][];
  selectionRegion?: Region;
  viewport: {
    left: number;
    top: number;
    width: number;
    height: number;
    scroll: number;
  };
};

/** Selection changes only position controls. Recognition is exclusively a button action. */
export const SelectionActions = ({ api }: { api: FcboardImperativeAPI }) => {
  useI18n();
  const [target, setTarget] = useState<Target>();
  const [pending, setPending] = useState(false);
  const [cropping, setCropping] = useState<{
    targetSignature: string;
    sourceSignature: string;
    id: string;
    image: DataURL;
    frame: CropFrame;
    viewport: { left: number; top: number; width: number; height: number };
    page?: number;
  }>();
  useEffect(() => {
    if (cropping && cropping.targetSignature !== target?.signature) {
      setCropping(undefined);
    }
  }, [cropping, target?.signature]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const controller = useRef<AbortController | undefined>(undefined);
  const cache = useRef<{ signature: string; text: string } | undefined>(
    undefined,
  );
  useEffect(() => {
    let previous = "";
    const refresh = () => {
      const state = api.getAppState();
      const selection = state.whiteboardSelection;
      let region =
        ["selection", "lasso"].includes(state.activeTool.type) &&
        selection?.elementIds.length ===
          Object.keys(state.selectedElementIds).length &&
        selection.elementIds.every((id) => state.selectedElementIds[id])
          ? selection.bounds
          : undefined;
      const doc = classroomCommands.read("document") as
        | DocumentContext
        | undefined;
      if (doc) {
        const selected = doc.ink.filter((stroke) =>
          doc.selection.includes(stroke.id),
        );
        const tableIds = new Set(
          selected
            .filter(
              (stroke) =>
                stroke.insertion?.kind === "table" &&
                stroke.insertion.inkCell === undefined,
            )
            .map((stroke) => stroke.insertion!.id),
        );
        const table =
          tableIds.size === 1 &&
          selected.every(
            (stroke) => stroke.insertion && tableIds.has(stroke.insertion.id),
          )
            ? readInsertions(api).find(
                (item) => item.kind === "table" && tableIds.has(item.id),
              )
            : undefined;
        const answerAnchor = selected.find(
          (stroke) =>
            stroke.questionAnswer?.ids.length &&
            stroke.questionAnswer.owner === stroke.id,
        );
        const owner = selected[0]?.widget;
        const solid =
          owner &&
          solidWidgetKinds.has(owner.kind) &&
          selected.every((stroke) => stroke.widget?.id === owner.id)
            ? readWidgets(api).find((widget) => widget.id === owner.id)
            : undefined;
        const boxes = solid
          ? doc.ink
              .filter((stroke) => stroke.widget?.id === solid.id)
              .map(documentStrokeBounds)
          : [];
        const points = boxes.length
          ? [
              [
                Math.min(...boxes.map((box) => box.left)),
                Math.min(...boxes.map((box) => box.top)),
              ],
              [
                Math.max(...boxes.map((box) => box.right)),
                Math.max(...boxes.map((box) => box.bottom)),
              ],
            ]
          : doc.region || [];
        if (
          doc.selectionInProgress ||
          points.length < 2 ||
          !doc.viewport?.width
        ) {
          controller.current?.abort();
          previous = "";
          setTarget(undefined);
          setPending(false);
          return;
        }
        const canSearch =
          !table &&
          (!selected.length ||
            selected.some(
              (stroke) =>
                stroke.text ||
                (!stroke.image &&
                  !stroke.widget &&
                  !stroke.plot &&
                  !stroke.insertion &&
                  (!stroke.shapeType || stroke.shapeType === "freedraw")),
            ));
        const canAI = !table && !solid;
        const canStudy =
          selected.length > 0 &&
          selected.every(
            (stroke) =>
              stroke.fcInk?.assist === "language" || !!stroke.language,
          );
        const canMerge = !!functionSelection(api);
        const properties = documentSelectionProperties(selected);
        if (solid) {
          properties.border = true;
          properties.fill = false;
        }
        const propertyCount =
          Number(properties.color) +
          Number(properties.border) +
          Number(properties.opacity) +
          Number(properties.layers) +
          3 * Number(properties.text) +
          Number(properties.image);
        const signature = JSON.stringify([
          doc.name,
          doc.page,
          points,
          selected,
          doc.viewport,
        ]);
        if (signature !== previous) {
          previous = signature;
          controller.current?.abort();
          setPending(false);
          setMessage("");
          setError("");
        }
        const box = {
          left: Math.min(...points.map((p) => p[0])),
          top: Math.min(...points.map((p) => p[1])),
          right: Math.max(...points.map((p) => p[0])),
          bottom: Math.max(...points.map((p) => p[1])),
        };
        const viewport = doc.viewport;
        const captureBounds = doc.selectionRegion || box;
        const crop = {
          left: captureBounds.left / 1000,
          right: captureBounds.right / 1000,
          top:
            ((captureBounds.top - viewport.scroll) * viewport.width) /
            1000 /
            viewport.height,
          bottom:
            ((captureBounds.bottom - viewport.scroll) * viewport.width) /
            1000 /
            viewport.height,
        };
        setTarget((old) =>
          old?.signature === signature && old.canAI === canAI
            ? old
            : {
                source: [],
                signature,
                canSearch,
                canAI,
                canStudy,
                studyRegion: doc.selectionRegion,
                canMerge,
                properties,
                solid,
                table,
                answer: answerAnchor
                  ? {
                      anchor: answerAnchor.id,
                      collapsed: !!answerAnchor.questionAnswer?.folded,
                    }
                  : undefined,
                ...selectionToolbarPosition(
                  {
                    left: viewport.left + (box.left * viewport.width) / 1000,
                    right: viewport.left + (box.right * viewport.width) / 1000,
                    top:
                      viewport.top +
                      ((box.top - viewport.scroll) * viewport.width) / 1000,
                    bottom:
                      viewport.top +
                      ((box.bottom - viewport.scroll) * viewport.width) / 1000,
                  },
                  {
                    left: Math.max(0, viewport.left),
                    right: Math.min(innerWidth, viewport.left + viewport.width),
                    top: Math.max(0, viewport.top),
                    bottom: Math.min(
                      innerHeight,
                      viewport.top + viewport.height,
                    ),
                  },
                  0.67,
                  propertyCount +
                    2 +
                    Number(canAI) +
                    Number(canStudy) +
                    Number(canSearch) +
                    Number(canMerge) +
                    (solid && ["cube", "cylinder"].includes(solid.kind)
                      ? 3
                      : 0) +
                    (table ? 4 : 0) +
                    (answerAnchor ? 1 : 0),
                ),
                document: {
                  crop,
                  hasObjects: !!selected.length,
                  ids: selected.map((stroke) => stroke.id),
                  bounds: box,
                  signature: documentSourceSignature(selected),
                  page: doc.page,
                },
              },
        );
        return;
      }
      let source = selectedBoardElements(api);
      const tableIds = new Set(
        source
          .filter(
            (item) =>
              item.customData?.fcInsertion?.kind === "table" &&
              item.customData.fcInsertion.inkCell === undefined,
          )
          .map((item) => item.customData!.fcInsertion.id),
      );
      const table =
        tableIds.size === 1 &&
        source.every(
          (element) =>
            element.customData?.fcInsertion &&
            tableIds.has(element.customData.fcInsertion.id),
        )
          ? readInsertions(api).find(
              (item) => item.kind === "table" && tableIds.has(item.id),
            )
          : undefined;
      const owner = source[0]?.customData?.fcWidget;
      const solid =
        owner &&
        solidWidgetKinds.has(owner.kind) &&
        source.every((element) => element.customData?.fcWidget?.id === owner.id)
          ? readWidgets(api).find((widget) => widget.id === owner.id)
          : undefined;
      if (solid) {
        source = api
          .getSceneElements()
          .filter((element) => element.customData?.fcWidget?.id === solid.id);
        region = undefined;
      }
      const signature =
        !classroomCommands.read("document") &&
        !state.toolbarHidden &&
        !state.editingTextElement &&
        state.cursorButton !== "down" &&
        !state.isResizing &&
        !state.isRotating &&
        source.length
          ? selectionSignature(source) +
            (region ? `|${JSON.stringify([region, selection?.path])}` : "")
          : "";
      if (signature !== previous) {
        previous = signature;
        controller.current?.abort();
        setPending(false);
        setMessage("");
        setError("");
      }
      if (!signature) {
        setTarget(undefined);
        return;
      }
      const [left, top, right, bottom] = region
        ? [region.left, region.top, region.right, region.bottom]
        : getCommonBounds(source);
      const unit = 0.67; // x50=33.5dp in the original resources.
      const canMerge = !!functionSelection(api);
      const properties = boardSelectionProperties(source);
      if (solid) {
        properties.border = true;
        properties.fill = false;
      }
      const propertyCount =
        Number(properties.color) +
        Number(properties.border) +
        Number(properties.opacity) +
        Number(properties.layers) +
        3 * Number(properties.text) +
        Number(properties.image);
      const canSearch =
        !table &&
        source.some(
          (element) => element.type === "text" || element.type === "freedraw",
        );
      const canAI = !table && !solid;
      const canStudy = source.every(
        (element) =>
          element.customData?.fcInk?.assist === "language" ||
          !!element.customData?.fcLanguage,
      );
      const offsetLeft = state.offsetLeft || 0;
      const offsetTop = state.offsetTop || 0;
      const answerAnchor = source.find(
        (element) =>
          element.customData?.fcQuestionAnswer?.ids.length &&
          element.customData.fcQuestionAnswer.owner === element.id,
      );
      const position = selectionToolbarPosition(
        {
          left: (left + state.scrollX) * state.zoom.value + offsetLeft,
          right: (right + state.scrollX) * state.zoom.value + offsetLeft,
          top: (top + state.scrollY) * state.zoom.value + offsetTop,
          bottom: (bottom + state.scrollY) * state.zoom.value + offsetTop,
        },
        {
          left: offsetLeft,
          right: offsetLeft + state.width,
          top: offsetTop,
          bottom: offsetTop + state.height - 68 * unit,
        },
        unit,
        propertyCount +
          2 +
          Number(canAI) +
          Number(canStudy) +
          Number(canSearch) +
          Number(canMerge) +
          (solid && ["cube", "cylinder"].includes(solid.kind) ? 3 : 0) +
          (table ? 4 : 0) +
          (answerAnchor ? 1 : 0),
      );
      setTarget((old) =>
        old?.signature === signature &&
        old.canAI === canAI &&
        old.left === position.left &&
        old.top === position.top &&
        old.width === position.width
          ? old
          : {
              source,
              signature,
              canSearch,
              canAI,
              canStudy,
              studyRegion:
                region && selection?.path
                  ? selectionPathBounds(selection.path)
                  : undefined,
              canMerge,
              properties,
              ...position,
              region,
              solid,
              table,
              answer: answerAnchor
                ? {
                    anchor: answerAnchor.id,
                    collapsed:
                      !!answerAnchor.customData?.fcQuestionAnswer.folded,
                  }
                : undefined,
            },
      );
    };
    const stop = api.onChange(refresh);
    const documentChanged = classroomCommands.watch("document", refresh);
    const invalidate = classroomCommands.onInvalidate(() => {
      controller.current?.abort();
      cache.current = undefined;
      setTarget(undefined);
      setPending(false);
    });
    window.addEventListener(SETTINGS_CHANGED, refresh);
    refresh();
    return () => {
      window.removeEventListener(SETTINGS_CHANGED, refresh);
      controller.current?.abort();
      stop();
      documentChanged();
      invalidate();
    };
  }, [api]);

  const act = async (action: Action, caller?: { signal?: AbortSignal }) => {
    caller?.signal?.throwIfAborted();
    if (
      !target ||
      pending ||
      !(action === "search" ? target.canSearch : target.canAI)
    ) {
      if (caller) {
        throw new Error(t("fcboard.the_selection_has_no_recognizable_content"));
      }
      return;
    }
    const snapshot = target;
    const request = new AbortController();
    controller.current?.abort();
    controller.current = request;
    const abort = () => request.abort(caller?.signal?.reason);
    caller?.signal?.addEventListener("abort", abort, { once: true });
    const { signal } = request;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const documentSourceNow = () =>
        classroomCommands.read("document") as DocumentContext | undefined;
      const documentSource = snapshot.document
        ? documentSourceNow()
        : undefined;
      const selectedDocumentText = documentSource?.ink
        .filter((stroke) => snapshot.document?.ids.includes(stroke.id))
        .map((stroke) => stroke.originalText || stroke.text)
        .filter(Boolean)
        .join("\n");
      let text =
        cache.current?.signature === snapshot.signature
          ? cache.current.text
          : "";
      let context: Awaited<ReturnType<typeof boardContext>> | undefined;
      const capture = async () => {
        if (!context) {
          setMessage(t("fcboard.capturing_selection"));
          if (snapshot.document) {
            const page = (await classroomCommands.execute({
              name: "document.snapshot",
            })) as { image: string };
            context = {
              elements: [],
              text: selectedDocumentText || "",
              image: await cropImage(
                page.image,
                snapshot.document.crop,
                signal,
              ),
            };
          } else {
            context = await boardContext(
              api,
              false,
              snapshot.source,
              snapshot.studyRegion || snapshot.region,
            );
          }
        }
        signal.throwIfAborted();
        if (!context.image) {
          throw new Error(
            t("fcboard.the_selection_has_no_recognizable_content"),
          );
        }
        return context.image;
      };
      if (action !== "search") {
        const image = await capture();
        if (action === "quiz") {
          const quiz = await classroomCommands.execute({
            name: "quiz.generate",
            args: {
              prompt:
                "截图中的文本是本次出题要求，务必遵循；结合选区图示和文本直接出题。仅使用可编程科学图示，禁止照片、AI生图和看图数物题。",
              context: { image },
              signal,
            },
          });
          setMessage("");
          return { action, quiz };
        }
        if (action === "question") {
          const settings = currentSettings();
          const answer = await chat(
            [
              {
                role: "system",
                content:
                  "Read the question and all relevant evidence directly from the selected screenshot. Answer it accurately and concisely in plain text and Unicode mathematical notation, ready to write on the board. Return the actual answer only, with no OCR transcript, preface, Markdown, JSON, HTML or image. The app presents the answer using the selected handwriting style.",
              },
              visualMessage(
                "Answer the question inside this exact selected region.",
                image,
              ),
            ],
            signal,
            settings,
            { useVisionModel: true, quickVision: true, maxTokens: 1536 },
          );
          signal.throwIfAborted();
          const written = snapshot.document
            ? await classroomCommands.execute({
                name: "canvas.text",
                args: {
                  text: answer,
                  presentation: settings.answerStyle,
                  placement: "below",
                  sourceIds: snapshot.document.ids,
                  sourceSignature: snapshot.document.signature,
                  signal,
                },
              })
            : insertText(
                api,
                answer,
                undefined,
                { fcSelectionSource: snapshot.signature },
                snapshot.source,
                settings.answerStyle,
                {
                  textOnly: true,
                  mode: "below",
                  bounds: snapshot.studyRegion || snapshot.region,
                },
              );
          setMessage("");
          return {
            action,
            answer,
            ids: Array.isArray(written)
              ? written
              : (written as { ids?: string[] } | undefined)?.ids,
          };
        }
        const generated = await generateImage(creativeImagePrompt(), signal, {
          referenceImage: image,
        });
        signal.throwIfAborted();
        const [left, top, right, bottom] = snapshot.source.length
          ? getCommonBounds(snapshot.source)
          : [0, 0, 0, 0];
        const sourceBounds = snapshot.document?.bounds ||
          snapshot.region || { left, top, right, bottom };
        const ids = await insertImageResult(api, generated, signal, {
          bounds: sourceBounds,
          replaceIds:
            snapshot.document?.ids ||
            snapshot.source.map((element) => element.id),
          sourceSignature:
            snapshot.document?.signature || selectionSignature(snapshot.source),
          sourcePage: snapshot.document?.page,
        });
        setMessage("");
        return { action, ids };
      }

      if (!text) {
        const written = handwritingText(snapshot.source);
        const document = snapshot.document
          ? (classroomCommands.read("document") as DocumentContext | undefined)
          : undefined;
        const documentSelection =
          document?.ink.filter((stroke) =>
            document.selection.includes(stroke.id),
          ) || [];
        const editable = snapshot.document
          ? documentSelection
              .filter((stroke) => stroke.text)
              .map((stroke) => stroke.originalText || stroke.text || "")
          : snapshot.source
              .filter((element) => element.type === "text")
              .map((element) =>
                element.type === "text"
                  ? element.originalText || element.text
                  : "",
              );
        const groups = new Set(
          snapshot.source
            .filter((element) => element.type === "freedraw")
            .map((element) => element.customData?.fcWrittenGroup),
        );
        const known = [...editable, ...written].join("\n").trim();
        const [left, top, right, bottom] = snapshot.source.length
          ? getCommonBounds(snapshot.source)
          : [0, 0, 0, 0];
        const completeSource =
          !snapshot.region ||
          (left >= snapshot.region.left &&
            top >= snapshot.region.top &&
            right <= snapshot.region.right &&
            bottom <= snapshot.region.bottom);
        const hasUnknownInk =
          (action === "search" &&
            documentSelection.some((stroke) => !stroke.text)) ||
          written.length !== groups.size ||
          snapshot.source.some(
            (el) =>
              el.type === "image" ||
              (el.type === "freedraw" && !el.customData?.fcWrittenGroup),
          );
        if (known && completeSource && !hasUnknownInk) {
          text = known;
        } else {
          const strokes = snapshot.document
            ? (() => {
                const doc = classroomCommands.read("document") as
                  | DocumentContext
                  | undefined;
                if (!doc) {
                  return [];
                }
                const points = doc.region;
                const chosen = doc.ink.filter((stroke) =>
                  doc.selection.includes(stroke.id),
                );
                return clipInk(
                  chosen
                    .filter(
                      (stroke) =>
                        doc.selection.includes(stroke.id) &&
                        !stroke.text &&
                        !stroke.image &&
                        !stroke.widget &&
                        !stroke.plot &&
                        !stroke.resource &&
                        !stroke.insertion,
                    )
                    .map((stroke) => stroke.points),
                  points.length
                    ? {
                        left: Math.min(...points.map(([x]) => x)),
                        right: Math.max(...points.map(([x]) => x)),
                        top: Math.min(...points.map(([, y]) => y)),
                        bottom: Math.max(...points.map(([, y]) => y)),
                      }
                    : undefined,
                );
              })()
            : boardInk(
                snapshot.source.filter(
                  (element) =>
                    element.type === "freedraw" &&
                    !element.customData?.fcWrittenGroup,
                ),
                snapshot.region,
              );
          let rasterRead = false;
          text = await recognizeHandwriting(
            () => {
              rasterRead = true;
              return capture();
            },
            signal,
            setMessage,
            "text",
            undefined,
            strokes,
          );
          if (known && strokes.length && !rasterRead) {
            // SelectCacheLayer.searchOperation appends editable text to local ink recognition.
            // Raster fallback already saw both, so it must never append the text twice.
            text += [...editable, ...written].join("");
          }
        }
        signal.throwIfAborted();
        if (!text.trim() || text.trim() === "NONE") {
          throw new Error(
            t("fcboard.no_content_recognized_select_the_area_again"),
          );
        }
        cache.current = { signature: snapshot.signature, text };
      }
      signal.throwIfAborted();
      await classroomCommands.execute({
        name: "search.open",
        args: { keyword: text.trim() },
      });
      signal.throwIfAborted();
      setMessage("");
      return { action };
    } catch (failure) {
      if (!signal.aborted) {
        setMessage("");
        setError(failure instanceof Error ? failure.message : String(failure));
      }
      if (caller) {
        throw failure;
      }
    } finally {
      caller?.signal?.removeEventListener("abort", abort);
      if (controller.current === request) {
        setPending(false);
      }
    }
  };
  const actionRef = useRef(act);
  actionRef.current = act;
  useEffect(
    () =>
      classroomCommands.register(
        "selection.action",
        "Apply the selection menu operation to the actual current selection. args.action=question|creative|quiz|search. Use canvas.select with observed IDs first when necessary. Waits for the selected operation and returns its result.",
        async (args) => {
          const action = selectionActions.find(
            (action) => action === args.action,
          );
          if (!action) {
            throw new Error(t("fcboard.invalid_style_parameters"));
          }
          // Canvas selection is immediate, while the selection toolbar updates through React.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          return actionRef.current(action, {
            signal:
              args.signal instanceof AbortSignal ? args.signal : undefined,
          });
        },
        {
          parameters: {
            type: "object",
            properties: {
              action: { type: "string", enum: [...selectionActions] },
            },
            required: ["action"],
          },
        },
      ),
    [],
  );
  if (!target) {
    return null;
  }
  const openCrop = () => {
    const context = classroomCommands.read("document") as
      | DocumentContext
      | undefined;
    if (target.document && context) {
      const stroke = context.ink.find((stroke) =>
        target.document!.ids.includes(stroke.id),
      );
      if (!stroke?.image || target.document.ids.length !== 1) {
        return;
      }
      const frame: CropFrame = {
        x: stroke.points[0][0],
        y: stroke.points[0][1],
        width: stroke.imageWidth || 120,
        height: stroke.imageHeight || 40,
        angle: 0,
        scale: [1, 1],
        crop: stroke.imageCrop || null,
      };
      setCropping({
        targetSignature: target.signature,
        sourceSignature: documentSourceSignature([stroke]),
        id: stroke.id,
        image: stroke.image as DataURL,
        frame,
        page: context.page,
        viewport: {
          left:
            context.viewport.left + (frame.x * context.viewport.width) / 1000,
          top:
            context.viewport.top +
            ((frame.y - context.viewport.scroll) * context.viewport.width) /
              1000,
          width: (frame.width * context.viewport.width) / 1000,
          height: (frame.height * context.viewport.width) / 1000,
        },
      });
    } else {
      const element = target.source[0];
      if (element?.type !== "image") {
        return;
      }
      const image = element.fileId && api.getFiles()[element.fileId]?.dataURL;
      if (!image) {
        setError(t("fcboard.could_not_read_document_image"));
        return;
      }
      const state = api.getAppState();
      setCropping({
        targetSignature: target.signature,
        sourceSignature: selectionSignature([element]),
        id: element.id,
        image,
        frame: {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          angle: element.angle,
          scale: element.scale,
          crop: element.crop,
        },
        viewport: {
          left:
            (element.x + state.scrollX) * state.zoom.value + state.offsetLeft,
          top: (element.y + state.scrollY) * state.zoom.value + state.offsetTop,
          width: element.width * state.zoom.value,
          height: element.height * state.zoom.value,
        },
      });
    }
  };
  if (cropping && cropping.targetSignature === target.signature) {
    return (
      <SelectionImageCrop
        image={cropping.image}
        frame={cropping.frame}
        viewport={cropping.viewport}
        toolbar={{
          left: target.left + (target.width - (2 * 56 + 12) * 0.67) / 2,
          top: target.top,
        }}
        onCancel={() => setCropping(undefined)}
        onApply={(updates) => {
          if (cropping.page !== undefined) {
            void classroomCommands
              .execute({
                name: "document.cropImage",
                args: {
                  ...updates,
                  id: cropping.id,
                  page: cropping.page,
                  sourceSignature: cropping.sourceSignature,
                },
              })
              .catch((failure) => setError(String(failure)));
          } else {
            const current = api
              .getSceneElements()
              .find((element) => element.id === cropping.id);
            if (
              current?.type === "image" &&
              !current.locked &&
              selectionSignature([current]) === cropping.sourceSignature
            ) {
              api.updateScene({
                elements: api
                  .getSceneElements()
                  .map((element) =>
                    element.id === current.id
                      ? newElementWith(current, updates)
                      : element,
                  ),
                captureUpdate: CaptureUpdateAction.IMMEDIATELY,
              });
            }
          }
          setCropping(undefined);
        }}
      />
    );
  }
  const propertyControls = (section: "style" | "alpha" | "layers") => (
    <SelectionProperties
      key={`${target.document ? `document:${target.document.page}` : "board"}:${
        target.properties.key
      }:${section}`}
      section={section}
      state={target.properties}
      disabled={pending}
      onEdit={() => {
        setError("");
        void classroomCommands
          .execute({ name: "canvas.editText" })
          .catch((failure) => setError(String(failure)));
      }}
      onStyle={(args) => {
        setError("");
        void classroomCommands
          .execute(
            target.solid
              ? {
                  name: "tools.configure",
                  args: {
                    id: target.solid.id,
                    ...(typeof args.color === "string"
                      ? { solid: { stroke: args.color } }
                      : {}),
                    ...(typeof args.width === "number"
                      ? { strokeWidth: args.width }
                      : {}),
                    ...(typeof args.opacity === "number"
                      ? { opacity: args.opacity }
                      : {}),
                    ...(args.strokeStyle
                      ? { strokeStyle: args.strokeStyle }
                      : {}),
                  },
                }
              : { name: "canvas.style", args },
          )
          .catch((failure) => setError(String(failure)));
      }}
      onAction={(action) => {
        setError("");
        void classroomCommands
          .execute({ name: "canvas.action", args: { action } })
          .catch((failure) => setError(String(failure)));
      }}
    />
  );
  return (
    <div
      className="fc-selection-actions"
      style={{ left: target.left, top: target.top, width: target.width }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Paper
        component="div"
        role="toolbar"
        aria-label={t("fcboard.selection_actions")}
        elevation={0}
      >
        {target.canAI && (
          <SelectionAI
            key={target.signature}
            owner={api.id}
            pending={pending}
            onCancel={() => {
              controller.current?.abort();
              setPending(false);
              setMessage("");
            }}
            onAction={(action) => void act(action)}
          />
        )}
        {target.canStudy && (
          <ButtonBase
            aria-label={t("fcboard.learning_card")}
            disabled={pending}
            onClick={() => {
              setError("");
              controller.current?.abort();
              const request = new AbortController();
              controller.current = request;
              void classroomCommands
                .execute({
                  name: "language.card",
                  args: {
                    sourceIds:
                      target.document?.ids ||
                      target.source.map((element) => element.id),
                    region: target.studyRegion,
                    signal: request.signal,
                  },
                })
                .catch((failure) => {
                  if (
                    !request.signal.aborted &&
                    (failure as Error).name !== "AbortError"
                  ) {
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : String(failure),
                    );
                  }
                });
            }}
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            >
              <path d="M12 6a8 8 0 0 0-8-2v14a9 9 0 0 1 8 2 9 9 0 0 1 8-2V4a8 8 0 0 0-8 2v14" />
            </svg>
            <span>{t("fcboard.learning_card")}</span>
          </ButtonBase>
        )}
        {target.canMerge && (
          <ButtonBase
            aria-label={t("fcboard.functionGraph.merge")}
            disabled={pending || target.properties.locked}
            onClick={() => {
              controller.current?.abort();
              const request = new AbortController();
              controller.current = request;
              setPending(true);
              setError("");
              void mergeFunctions(api, request.signal)
                .catch((failure) => {
                  if (
                    !request.signal.aborted &&
                    (failure as Error)?.name !== "AbortError"
                  ) {
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : String(failure),
                    );
                  }
                })
                .finally(() => {
                  if (controller.current === request) {
                    setPending(false);
                  }
                });
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M4 4v6c0 3 8 1 8 5v5m8-16v6c0 3-8 1-8 5m-3 2 3 3 3-3" />
            </svg>
            <span>{t("fcboard.functionGraph.merge")}</span>
          </ButtonBase>
        )}
        {propertyControls("style")}
        {target.solid && (
          <SolidActions
            key={target.solid.id}
            widget={target.solid}
            disabled={pending || target.properties.locked}
            onError={setError}
          />
        )}
        {target.answer && (
          <ButtonBase
            aria-label={t(
              target.answer.collapsed
                ? "fcboard.expand_answer"
                : "fcboard.collapse_answer",
            )}
            onClick={() =>
              void updateQuestionAnswer(api, target.answer!.anchor).catch(
                (failure) => setError(String(failure)),
              )
            }
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path
                d={target.answer.collapsed ? "M9 5l7 7-7 7" : "M5 9l7 7 7-7"}
              />
            </svg>
          </ButtonBase>
        )}
        {target.canSearch && (
          <ButtonBase
            aria-label={t("fcboard.search")}
            disabled={pending}
            onClick={() => void act("search")}
          >
            <SelectionIcon name="search" />
            <span>{t("fcboard.search")}</span>
          </ButtonBase>
        )}
        {target.properties.image && (
          <ButtonBase
            aria-label={t("helpDialog.cropStart")}
            disabled={pending || target.properties.locked}
            onClick={openCrop}
          >
            <SelectionIcon name="crop" />
            <span>{t("fcboard.selection_crop")}</span>
          </ButtonBase>
        )}
        {propertyControls("alpha")}
        <ButtonBase
          aria-label={t("labels.copy")}
          disabled={pending || target.document?.hasObjects === false}
          onClick={() => {
            controller.current?.abort();
            void classroomCommands
              .execute({
                name: target.solid ? "tools.duplicate" : "canvas.action",
                args: target.solid
                  ? { id: target.solid.id }
                  : { action: "duplicateSelection" },
              })
              .catch((failure) => setError(String(failure)));
          }}
        >
          <SelectionIcon name="copy" />
          <span>{t("labels.copy")}</span>
        </ButtonBase>
        {propertyControls("layers")}
        <ButtonBase
          aria-label={t("labels.delete")}
          disabled={
            target.document?.hasObjects === false || target.properties.locked
          }
          onClick={() => {
            controller.current?.abort();
            void classroomCommands
              .execute(
                target.solid
                  ? { name: "tools.delete", args: { id: target.solid.id } }
                  : { name: "canvas.erase" },
              )
              .catch((failure) => setError(String(failure)));
          }}
        >
          <SelectionIcon name="delete" />
          <span>{t("labels.delete")}</span>
        </ButtonBase>
        {target.table && (
          <TableActions
            table={target.table}
            disabled={pending}
            onError={setError}
          />
        )}
      </Paper>
      <TransientMessage
        message={error || (pending ? "" : message)}
        role={error ? "alert" : "status"}
        className={error ? "fc-error" : ""}
      />
    </div>
  );
};
