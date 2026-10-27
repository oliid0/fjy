import { useCallback, useEffect, useRef, useState } from "react";
import ButtonBase from "@mui/material/ButtonBase";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { t, useI18n } from "@excalidraw/excalidraw/i18n";
import { isPalmContact } from "@excalidraw/excalidraw/eraser/stroke";

import type {
  ExcalidrawImperativeAPI,
  UIOptions,
} from "@excalidraw/excalidraw/types";

import { classroomCommands } from "./commands";
import { changeMindMapNode } from "./mindMap";
import { readInsertions, renderInsertion, mindMapNodes } from "./insertObjects";
import {
  boardWritingParts,
  documentWritingParts,
  insertionWritingTargets,
  insertionWritingAt,
} from "./insertionWriting";
import { TransientMessage } from "./TransientMessage";
import deleteIcon from "./mindmap-assets/g_delete_note.png?url";
import moveIcon from "./mindmap-assets/note_move.png?url";
import addIcon from "./mindmap-assets/note_add.png?url";
import clearIcon from "./mindmap-assets/note_clear_text.png?url";

import type { InsertObject } from "./insertObjects";
import type { InkStroke } from "./documents";

type DocumentSurface = {
  id?: string;
  name: string;
  page: number;
  ink: InkStroke[];
  tool?: string;
  viewport: { left: number; top: number; width: number; scroll: number };
};
type SelectedNode = { id: string; index: number; surface: string };
type NodeView = SelectedNode & {
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
  angle: number;
  canAdd: boolean;
};
type Drag = {
  selected: SelectedNode;
  original: InsertObject;
  latest: InsertObject;
  before?: InkStroke[];
  pointerId: number;
  x: number;
  y: number;
  node: { x: number; y: number };
  scale: number;
  moved: boolean;
};

/** First contact selects a node; subsequent ordinary pen contacts enter its handwriting surface. */
export const MindMapControls = ({
  api,
  inkProfile,
}: {
  api: ExcalidrawImperativeAPI;
  inkProfile?: UIOptions["inkProfile"];
}) => {
  useI18n();
  const [view, setView] = useState<NodeView>();
  const [error, setError] = useState("");
  const selected = useRef<SelectedNode | undefined>(undefined);
  const drag = useRef<Drag | undefined>(undefined);
  const refreshRef = useRef(() => {});
  const surface = useCallback(() => {
    const document = classroomCommands.read("document") as
      | DocumentSurface
      | undefined;
    const board = classroomCommands.read("boards") as
      | { active?: string }
      | undefined;
    return {
      document,
      key: document
        ? `document:${document.id || document.name}:${document.page}`
        : `board:${api.id}:${board?.active || ""}`,
    };
  }, [api]);
  const fail = useCallback(
    (failure: unknown) =>
      setError(failure instanceof Error ? failure.message : String(failure)),
    [],
  );
  const cancelDrag = useCallback(async () => {
    const current = drag.current;
    drag.current = undefined;
    if (
      current?.moved &&
      surface().key === current.selected.surface &&
      readInsertions(api).some((object) => object.id === current.original.id)
    ) {
      await renderInsertion(api, current.original, false, {
        preview: true,
        select: false,
      });
    }
  }, [api, surface]);
  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      const choice = selected.current;
      const current = surface();
      const state = api.getAppState();
      if (
        !choice ||
        choice.surface !== current.key ||
        state.toolbarHidden ||
        !["freedraw", "lasso", "selection"].includes(
          current.document?.tool || state.activeTool.type,
        )
      ) {
        if (choice?.surface === current.key) {
          void cancelDrag().catch(fail);
        } else {
          drag.current = undefined;
        }
        selected.current = undefined;
        setView(undefined);
        return;
      }
      const parts = current.document
        ? documentWritingParts(
            current.document.ink.filter(
              (stroke) => stroke.insertion?.id === choice.id,
            ),
          )
        : boardWritingParts(
            api
              .getSceneElements()
              .filter(
                (element) => element.customData?.fcInsertion?.id === choice.id,
              ),
          );
      const target =
        choice?.surface === current.key && !state.toolbarHidden
          ? insertionWritingTargets(parts).find(
              (item) =>
                item.insertion.kind === "mindmap" &&
                item.insertion.id === choice.id &&
                item.index === choice.index,
            )
          : undefined;
      if (!target || !choice) {
        drag.current = undefined;
        selected.current = undefined;
        setView(undefined);
        return;
      }
      const viewport = current.document?.viewport;
      const scale = viewport ? viewport.width / 1000 : state.zoom.value;
      const next = {
        ...choice,
        left: viewport
          ? viewport.left + target.x * scale
          : (target.x + state.scrollX) * scale + (state.offsetLeft || 0),
        top: viewport
          ? viewport.top + (target.y - viewport.scroll) * scale
          : (target.y + state.scrollY) * scale + (state.offsetTop || 0),
        width: target.width * scale,
        height: target.height * scale,
        scale,
        angle: target.angle,
        canAdd: target.insertion.outline.split("\n").length < 40,
      };
      setView((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    refreshRef.current = refresh;
    const down = (event: PointerEvent) => {
      const element =
        event.target instanceof Element ? event.target : undefined;
      if (
        !element ||
        element.closest("[data-mindmap-controls], [data-insertion-candidates]")
      ) {
        return;
      }
      if (drag.current) {
        void cancelDrag().catch(fail);
      }
      const current = surface();
      const canvas = element.closest(
        current.document ? ".fc-document-ink" : "canvas.interactive",
      );
      if (!canvas || event.button !== 0 || event.isPrimary === false) {
        return;
      }
      const state = api.getAppState();
      const tool = current.document?.tool || state.activeTool.type;
      if (
        (event.pointerType === "pen" && !!(event.buttons & 34)) ||
        (state.palmEraser !== false &&
          isPalmContact(
            event,
            state.palmEraserThreshold ?? inkProfile?.palmThreshold ?? 36,
          ))
      ) {
        return;
      }
      if (!["freedraw", "lasso", "selection"].includes(tool)) {
        selected.current = undefined;
        refresh();
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const point = current.document
        ? [
            ((event.clientX - rect.left) * 1000) / rect.width,
            ((event.clientY - rect.top) * 1000) / rect.width +
              current.document.viewport.scroll,
          ]
        : [
            (event.clientX - (state.offsetLeft || 0)) / state.zoom.value -
              state.scrollX,
            (event.clientY - (state.offsetTop || 0)) / state.zoom.value -
              state.scrollY,
          ];
      const parts = current.document
        ? documentWritingParts(current.document.ink)
        : boardWritingParts(api.getSceneElements());
      const target = insertionWritingAt(
        insertionWritingTargets(parts).filter(
          (item) => item.insertion.kind === "mindmap",
        ),
        point,
      );
      if (!target) {
        selected.current = undefined;
        refresh();
        return;
      }
      const same =
        selected.current?.id === target.insertion.id &&
        selected.current.index === target.index &&
        selected.current.surface === current.key;
      selected.current = {
        id: target.insertion.id,
        index: target.index,
        surface: current.key,
      };
      if (!same || tool !== "freedraw") {
        event.preventDefault();
        event.stopPropagation();
        if (current.document) {
          void classroomCommands
            .execute({ name: "document.select", args: { ids: [] } })
            .catch(fail);
        } else {
          api.updateScene({
            appState: {
              selectedElementIds: {},
              selectedGroupIds: {},
              whiteboardSelection: undefined,
            },
          });
        }
      }
      refresh();
    };
    const move = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || event.pointerId !== current.pointerId) {
        return;
      }
      if (surface().key !== current.selected.surface) {
        drag.current = undefined;
        selected.current = undefined;
        refresh();
        return;
      }
      event.preventDefault();
      const dx = (event.clientX - current.x) / current.scale;
      const dy = (event.clientY - current.y) / current.scale;
      if (!dx && !dy) {
        return;
      }
      current.moved = true;
      const object = readInsertions(api).find(
        (item) => item.id === current.original.id,
      );
      if (
        !object ||
        object.outline.split("\n").length !==
          current.original.outline.split("\n").length
      ) {
        drag.current = undefined;
        selected.current = undefined;
        refresh();
        return;
      }
      current.latest = changeMindMapNode(
        object,
        current.selected.index,
        "move",
        { x: current.node.x + dx, y: current.node.y + dy },
      )!;
      void renderInsertion(api, current.latest, false, {
        preview: true,
        select: false,
      }).catch(fail);
    };
    const up = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || event.pointerId !== current.pointerId) {
        return;
      }
      move(event);
      drag.current = undefined;
      if (current.moved && surface().key === current.selected.surface) {
        void renderInsertion(api, current.latest, true, {
          before: current.before,
          select: false,
        }).catch(fail);
      }
    };
    const cancel = () => {
      void cancelDrag().catch(fail);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancel();
        selected.current = undefined;
        refresh();
      }
    };
    const stop = api.onChange(refresh);
    // FilePreview replaces its context during the same React commit. Observe
    // the settled page rather than mistaking that short gap for a closed file.
    const stopDocument = classroomCommands.watch("document", () =>
      queueMicrotask(() => {
        if (!disposed) {
          refresh();
        }
      }),
    );
    const stopBoards = classroomCommands.watch("boards", refresh);
    const stopInvalidation = classroomCommands.onInvalidate(() => {
      cancel();
      selected.current = undefined;
      refresh();
    });
    const dismiss = classroomCommands.register(
      "mindmap.dismiss",
      "@internal",
      async () => {
        await cancelDrag();
        selected.current = undefined;
        refresh();
      },
    );
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    window.addEventListener("keydown", key);
    return () => {
      disposed = true;
      void cancelDrag().catch(() => {});
      stop();
      stopDocument();
      stopBoards();
      stopInvalidation();
      dismiss();
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      window.removeEventListener("keydown", key);
    };
  }, [api, surface, cancelDrag, fail, inkProfile]);
  const act = async (action: "add" | "clear" | "delete") => {
    const choice = selected.current;
    if (!choice || surface().key !== choice.surface) {
      return;
    }
    const object = readInsertions(api).find((item) => item.id === choice.id);
    if (!object) {
      return;
    }
    const next = changeMindMapNode(object, choice.index, action);
    if (!next) {
      const document = surface().document;
      if (document) {
        await classroomCommands.execute({
          name: "document.erase",
          args: {
            ids: document.ink
              .filter((stroke) => stroke.insertion?.id === object.id)
              .map((stroke) => stroke.id),
          },
        });
      } else {
        api.updateScene({
          elements: api
            .getSceneElements()
            .filter(
              (element) => element.customData?.fcInsertion?.id !== object.id,
            ),
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      }
    } else {
      await renderInsertion(api, next, true, { select: false });
    }
    if (action === "delete") {
      selected.current = undefined;
    }
    refreshRef.current();
  };
  return (
    <>
      {view && (
        <div
          data-mindmap-controls
          style={{
            position: "fixed",
            zIndex: 1450,
            left: view.left - 5,
            top: view.top - 5,
            width: view.width + 10,
            height: view.height + 10,
            border: "2px solid #a9fb78",
            borderRadius: "10px",
            transform: `rotate(${view.angle}rad)`,
            pointerEvents: "none",
          }}
        >
          {(
            [
              ["delete", deleteIcon, "mindmap_delete_node", "50%", "0%"],
              ["add", addIcon, "mindmap_add_child", "100%", "50%"],
              ["clear", clearIcon, "mindmap_clear_node", "50%", "100%"],
              ["move", moveIcon, "mindmap_move_node", "0%", "50%"],
            ] as const
          ).map(([action, icon, label, left, top]) => (
            <ButtonBase
              key={action}
              aria-label={t(`fcboard.${label}`)}
              title={t(`fcboard.${label}`)}
              disabled={action === "add" && !view.canAdd}
              onClick={
                action === "move"
                  ? undefined
                  : () => {
                      setError("");
                      void act(action).catch(fail);
                    }
              }
              onPointerDown={
                action === "move"
                  ? (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const choice = selected.current;
                      const current = surface();
                      const object =
                        choice &&
                        readInsertions(api).find(
                          (item) => item.id === choice.id,
                        );
                      if (
                        !choice ||
                        !object ||
                        choice.surface !== current.key
                      ) {
                        return;
                      }
                      const node = mindMapNodes(object)[choice.index];
                      drag.current = {
                        selected: choice,
                        original: object,
                        latest: object,
                        before: current.document?.ink.filter(
                          (stroke) => stroke.insertion?.id === object.id,
                        ),
                        pointerId: event.pointerId,
                        x: event.clientX,
                        y: event.clientY,
                        node,
                        scale: view.scale,
                        moved: false,
                      };
                      event.currentTarget.setPointerCapture?.(event.pointerId);
                    }
                  : undefined
              }
              sx={{
                position: "absolute",
                left,
                top,
                width: 32,
                height: 32,
                borderRadius: "50%",
                transform: "translate(-50%,-50%)",
                pointerEvents: "auto",
                touchAction: "none",
                "&:disabled": { opacity: 0.4 },
              }}
            >
              <img
                src={icon}
                alt=""
                style={{ width: "100%", height: "100%" }}
              />
            </ButtonBase>
          ))}
        </div>
      )}
      <TransientMessage message={error} role="alert" className="fc-error" />
    </>
  );
};
