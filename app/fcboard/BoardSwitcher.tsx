import { t, useI18n } from "@fcboard/fcboard/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { ToolbarExtras } from "@fcboard/fcboard";
import { UndoIcon } from "@fcboard/fcboard/components/icons";
import { FactoryIcon } from "@fcboard/fcboard/components/FactoryIcon";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { TransientMessage } from "./TransientMessage";

import { MaterialPanel } from "./MaterialPanel";

import { BoardBook } from "./boards";
import { useAnchoredPanel } from "./floating";

import { classroomCommands, executeBoardCommand } from "./commands";

import { BoardThumbnail } from "./BoardThumbnail";
import { saveBoardFile, openBoardFile, pickBoardFile } from "./boardFile";
import { boardCanvasSize } from "./boardExport";
import { PageNavigation } from "./PageNavigation";
import { BoardOpen } from "./BoardOpen";
import { readCloudBzd } from "./cloudTransfers";
import { loadCloudShare } from "./cloudShare";

import "./BoardSwitcher.scss";

import type { PointerEvent as ReactPointerEvent } from "react";

const boardIcon = (name: string) =>
  new URL(`./factory-board-icons/${name}.svg`, import.meta.url).href;

export const BoardSwitcher = ({ api }: { api: FcboardImperativeAPI }) => {
  useI18n();
  const leavePresentation = async (source?: AbortSignal) => {
    source?.throwIfAborted();
    if (classroomCommands.has("mindmap.dismiss")) {
      await executeBoardCommand({ name: "mindmap.dismiss" }, source);
    }
    const session = classroomCommands.read("network") as
      | { collaborating?: boolean; hosting?: boolean }
      | undefined;
    if (session?.collaborating && !session.hosting) {
      await executeBoardCommand({ name: "collaboration.stop" }, source);
    }
    if (classroomCommands.has("document.close")) {
      await executeBoardCommand(
        {
          name: "document.close",
          args: { next: false },
        },
        source,
      );
    }
    source?.throwIfAborted();
  };
  const book = useRef<BoardBook | undefined>(undefined);
  const [value, setValue] = useState<BoardBook["value"]>({
    active: "",
    boards: [],
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [dragging, setDragging] = useState<string>();
  const drag = useRef<
    | {
        id: string;
        pointer: number;
        before: string[];
        order: string[];
        x: number;
        y: number;
      }
    | undefined
  >(undefined);
  const list = useRef<HTMLDivElement>(null);
  const dragFrame = useRef<number | undefined>(undefined);
  const operation = useRef<AbortController | undefined>(undefined);
  const running = useRef(false);
  const panel = useRef<HTMLElement>(null);
  const panelStyle = useAnchoredPanel(
    panel,
    "[data-board-switcher], [data-testid='main-menu-trigger']",
    open,
  );
  useEffect(() => {
    const controller = new BoardBook(api, (failure) =>
      setError(String(failure)),
    );
    book.current = controller;
    let cancelled = false;
    let started = false;
    const boot = () => {
      if (api.getAppState().isLoading || started || cancelled) {
        return;
      }
      started = true;
      void controller.initialize().catch((failure) =>
        setError(
          t("fcboard.board_saving_unavailable_error", {
            error: String(failure),
          }),
        ),
      );
    };
    const unsubscribe = controller.subscribe(() => {
      classroomCommands.changed("boards");
      if (!cancelled) {
        setValue({ ...controller.value });
      }
    });
    let canvasSize = boardCanvasSize(api.getAppState());
    const updateCanvasSize = (state = api.getAppState()) => {
      const nextSize = boardCanvasSize(state);
      if (
        nextSize.width !== canvasSize.width ||
        nextSize.height !== canvasSize.height ||
        nextSize.pixelRatio !== canvasSize.pixelRatio
      ) {
        canvasSize = nextSize;
        classroomCommands.changed("boards");
        if (!cancelled) {
          setValue({ ...controller.value });
        }
      }
    };
    const resized = () => updateCanvasSize();
    const stopWatch = api.onChange((_elements, state) => {
      updateCanvasSize(state);
      if (state.toolbarHidden) {
        setOpen(false);
      }
      boot();
    });
    boot();
    const registrations = [
      classroomCommands.register("board.list", "打开白板列表", () => {
        api.updateScene({ appState: { toolbarHidden: false } });
        setValue({ ...controller.value });
        setOpen(true);
      }),
      classroomCommands.register(
        "board.new",
        "新建并切换白板，args.name 可选；原板自动保存",
        async (args) => {
          const source =
            args.signal instanceof AbortSignal
              ? args.signal
              : classroomCommands.interactionSource;
          await leavePresentation(source);
          await controller.create(
            typeof args.name === "string" ? args.name : undefined,
            source,
          );
        },
      ),
      classroomCommands.register(
        "board.switch",
        "切换白板，args.id 或 args.name，或从1开始的 args.index",
        async (args) => {
          const source =
            args.signal instanceof AbortSignal
              ? args.signal
              : classroomCommands.interactionSource;
          const board = controller.value.boards.find(
            (item, index) =>
              item.id === args.id ||
              item.name === args.name ||
              index + 1 === args.index,
          );
          if (!board) {
            throw new Error(t("fcboard.board_not_found"));
          }
          await leavePresentation(source);
          await controller.switch(board.id, source);
        },
      ),
      classroomCommands.register(
        "board.rename",
        "重命名当前白板，args.name 必填",
        async (args) =>
          controller.rename(controller.value.active, String(args.name || "")),
      ),
      classroomCommands.register(
        "board.discard",
        "丢弃白板，仅在用户明确要求丢弃时调用，args.id 省略为当前板",
        async (args) => {
          const source =
            args.signal instanceof AbortSignal
              ? args.signal
              : classroomCommands.interactionSource;
          const id = String(args.id || controller.value.active);
          if (id === controller.value.active) {
            await leavePresentation(source);
          }
          await controller.discard(id, source);
        },
      ),
      classroomCommands.register("board.save", "保存当前白板到本机", () =>
        controller.flush(),
      ),
      classroomCommands.register(
        "board.reorder",
        "按args.ids完整白板ID列表调整顺序，保留当前白板与笔迹",
        (args) => {
          if (
            !Array.isArray(args.ids) ||
            args.ids.some((id) => typeof id !== "string")
          ) {
            throw new Error(t("fcboard.board_reorder_invalid"));
          }
          return controller.reorder(
            args.ids,
            args.signal instanceof AbortSignal
              ? args.signal
              : classroomCommands.interactionSource,
          );
        },
      ),
      classroomCommands.register(
        "board.export",
        "将全部白板保存为原厂 BZD 文件。显示实际文件保存位置选择；返回 saved=false 表示取消，不能声称成功。",
        async (args) => {
          await controller.flush();
          const source =
            args.signal instanceof AbortSignal
              ? args.signal
              : classroomCommands.interactionSource;
          const saved = await saveBoardFile(
            controller.value.boards,
            controller.value.boards.find(
              (page) => page.id === controller.value.active,
            )?.name || "Fcboard",
            source,
          );
          return { saved };
        },
      ),
      classroomCommands.register(
        "board.open",
        "打开原厂 BZD 白板文件，保留已有页面并导入全部页。args.code 为四位云端提取码，args.endpoint 可选；省略则打开本地文件窗。",
        async (args) => {
          const source =
            args.signal instanceof AbortSignal
              ? args.signal
              : classroomCommands.interactionSource;
          source?.throwIfAborted();
          let xml: string;
          if (typeof args.code === "string") {
            xml = await readCloudBzd(
              typeof args.endpoint === "string"
                ? args.endpoint
                : loadCloudShare().endpoint,
              args.code,
              source,
            );
          } else {
            const file = await pickBoardFile(source);
            if (!file) {
              return { cancelled: true };
            }
            xml = await file.text();
          }
          const pages = await openBoardFile(xml);
          source?.throwIfAborted();
          await leavePresentation(source);
          await controller.importPages(pages, source);
          return { pages: pages.length, active: controller.value.active };
        },
      ),
      classroomCommands.register("board.pages", "@internal", async () => {
        await controller.flush();
        return {
          ...controller.value,
          canvasSize: boardCanvasSize(api.getAppState()),
        };
      }),
      classroomCommands.context("boards", () => ({
        active: controller.visibleActive,
        canvasSize: boardCanvasSize(api.getAppState()),
        boards: controller.value.boards.map(({ id, name }) => ({ id, name })),
      })),
    ];
    const persist = () => {
      try {
        controller.checkpoint();
      } catch (failure) {
        setError(String(failure));
      }
      void controller.flush().catch(() => {});
    };
    window.addEventListener("pagehide", persist);
    window.addEventListener("resize", resized);
    return () => {
      cancelled = true;
      stopWatch();
      window.removeEventListener("resize", resized);
      unsubscribe();
      registrations.forEach((stop) => stop());
      window.removeEventListener("pagehide", persist);
      controller.dispose();
    };
  }, [api]);
  const stopDrag = useCallback((restore = false) => {
    if (dragFrame.current !== undefined) {
      cancelAnimationFrame(dragFrame.current);
      dragFrame.current = undefined;
    }
    if (restore && drag.current) {
      setOrder(drag.current.before);
    }
    drag.current = undefined;
    setDragging(undefined);
  }, []);
  const close = useCallback(() => {
    operation.current?.abort();
    stopDrag(true);
    setOpen(false);
    setError("");
  }, [stopDrag]);
  useEffect(() => {
    if (!open) {
      return;
    }
    setEditing(false);
    setOrder([]);
    setChosen([]);
    panel.current
      ?.querySelector<HTMLButtonElement>(
        ".fc-board-select[aria-pressed='true']",
      )
      ?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !(event.target as Element).closest?.("[data-board-switcher]")
      ) {
        close();
      }
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [open, close]);
  useEffect(() => {
    const action = (event: Event) => {
      if (
        !(event as CustomEvent<HTMLElement>).detail.closest(
          "[data-board-switcher]",
        )
      ) {
        close();
      }
    };
    window.addEventListener("fcboard:toolbar-action", action);
    return () => {
      window.removeEventListener("fcboard:toolbar-action", action);
      operation.current?.abort();
      if (dragFrame.current !== undefined) {
        cancelAnimationFrame(dragFrame.current);
      }
    };
  }, [close]);
  const run = async (task: (source: AbortSignal) => Promise<void>) => {
    if (running.current) {
      return;
    }
    running.current = true;
    const request = new AbortController();
    const release = classroomCommands.registerOwner(
      request.signal,
      classroomCommands.interactionSource,
    );
    operation.current = request;
    setBusy(true);
    setError("");
    try {
      request.signal.throwIfAborted();
      await task(request.signal);
    } catch (failure) {
      if (!request.signal.aborted) {
        setError(String(failure));
      }
    } finally {
      release();
      if (operation.current === request) {
        operation.current = undefined;
      }
      running.current = false;
      setBusy(false);
    }
  };
  const beginEdit = () => {
    stopDrag(true);
    setChosen(value.boards.map((board) => board.id));
    setEditing(true);
  };
  const toggleChosen = (id: string) =>
    setChosen((previous) =>
      previous.includes(id)
        ? previous.filter((selected) => selected !== id)
        : [...previous, id],
    );
  const move = (id: string, target: string) => {
    const current = drag.current;
    if (!current) {
      return;
    }
    const next = [...current.order];
    const from = next.indexOf(id);
    const to = next.indexOf(target);
    if (from < 0 || to < 0 || from === to) {
      return;
    }
    next.splice(from, 1);
    next.splice(to, 0, id);
    current.order = next;
    setOrder(next);
  };
  const updateDrag = () => {
    const current = drag.current;
    if (!current) {
      return;
    }
    const card = document
      .elementFromPoint(current.x, current.y)
      ?.closest<HTMLElement>("[data-board-id]");
    if (card?.dataset.boardId && list.current?.contains(card)) {
      move(current.id, card.dataset.boardId);
    }
  };
  const scrollDrag = () => {
    const current = drag.current;
    const container = list.current;
    if (!current || !container) {
      return;
    }
    const bounds = container.getBoundingClientRect();
    if (current.y < bounds.top + 40) {
      container.scrollTop -= Math.max(
        2,
        Math.min(12, (bounds.top + 40 - current.y) / 4),
      );
    } else if (current.y > bounds.bottom - 40) {
      container.scrollTop += Math.max(
        2,
        Math.min(12, (current.y - bounds.bottom + 40) / 4),
      );
    }
    updateDrag();
    dragFrame.current = requestAnimationFrame(scrollDrag);
  };
  const dragMove = (event: ReactPointerEvent) => {
    if (drag.current?.pointer !== event.pointerId) {
      return;
    }
    drag.current.x = event.clientX;
    drag.current.y = event.clientY;
    updateDrag();
  };
  const finishDrag = () => {
    const current = drag.current;
    stopDrag();
    if (
      !current ||
      current.order.every((id, index) => id === current.before[index])
    ) {
      setOrder([]);
      return;
    }
    void run(async (source) => {
      try {
        await book.current!.reorder(current.order, source);
      } finally {
        setOrder([]);
      }
    });
  };
  const removePages = (ids: string[]) =>
    void run(async (source) => {
      if (ids.includes(book.current!.value.active)) {
        await leavePresentation(source);
      }
      await book.current!.discardMany(ids, source);
      setChosen([]);
      setEditing(false);
    });
  const sharePages = (command: "board.share" | "board.saveFile") =>
    void run(async (source) => {
      await executeBoardCommand(
        {
          name: command,
          args: {
            ids: value.boards
              .filter((board) => chosen.includes(board.id))
              .map((board) => board.id),
            signal: source,
          },
        },
        source,
      );
      if (!source.aborted) {
        setOpen(false);
      }
    });
  const visibleBoards = order.length
    ? order
        .map((id) => value.boards.find((board) => board.id === id))
        .filter((board): board is NonNullable<typeof board> => !!board)
    : value.boards;
  const allChosen =
    value.boards.length > 0 &&
    value.boards.every((board) => chosen.includes(board.id));
  const validExportSelection = chosen.length > 0 && chosen.length <= 20;
  return (
    <>
      <PageNavigation />
      <BoardOpen />
      <ToolbarExtras placement="navigation">
        <div className="fc-toolbar-extras fc-board-controls">
          <button
            aria-label={t("fcboard.previous_board")}
            disabled={
              busy ||
              value.boards.findIndex((board) => board.id === value.active) <= 0
            }
            onClick={() =>
              void run(async (source) => {
                const index = book.current!.value.boards.findIndex(
                  (board) => board.id === book.current!.value.active,
                );
                await leavePresentation(source);
                await book.current!.switch(
                  book.current!.value.boards[index - 1].id,
                  source,
                );
              })
            }
          >
            <FactoryIcon name="previous" />
          </button>
          <button
            data-board-switcher
            data-menu-toggle
            aria-label={t("fcboard.switch_board")}
            title={t("fcboard.switch_board")}
            aria-expanded={open}
            onClick={() => {
              if (open) {
                close();
              } else {
                if (book.current) {
                  setValue({ ...book.current.value });
                }
                setOpen(true);
              }
            }}
          >
            <span className="fc-board-count">
              {value.boards.findIndex((board) => board.id === value.active) +
                1 || 1}{" "}
              / {value.boards.length || 1}
            </span>
          </button>
          <button
            aria-label={t("fcboard.next_board")}
            disabled={
              busy ||
              !value.active ||
              value.boards.findIndex((board) => board.id === value.active) >=
                value.boards.length - 1
            }
            onClick={() =>
              void run(async (source) => {
                const index = book.current!.value.boards.findIndex(
                  (board) => board.id === book.current!.value.active,
                );
                await leavePresentation(source);
                await book.current!.switch(
                  book.current!.value.boards[index + 1].id,
                  source,
                );
              })
            }
          >
            <FactoryIcon name="next" />
          </button>
          <button
            aria-label={t("fcboard.new_board")}
            title={t("fcboard.new_board")}
            disabled={busy || !value.active}
            onClick={() =>
              void run(async (source) => {
                await leavePresentation(source);
                await book.current!.create(undefined, source);
              })
            }
          >
            <FactoryIcon name="add" />
          </button>
        </div>
      </ToolbarExtras>
      {(open || error) && (
        <MaterialPanel
          ref={panel}
          className="fc-board-picker fc-board-preview-list fc-board-panel fc-surface"
          style={panelStyle}
          role="dialog"
          aria-label={t("fcboard.my_boards")}
          aria-busy={busy}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              if (drag.current) {
                stopDrag(true);
                setOrder([]);
              } else if (editing) {
                setEditing(false);
                setChosen([]);
              } else {
                close();
              }
            }
          }}
        >
          <TransientMessage message={error} role="alert" />
          <div
            ref={list}
            className="fc-board-list"
            role="list"
            aria-label={t("fcboard.my_boards")}
          >
            {visibleBoards.map((board, index) => (
              <div
                key={board.id}
                data-board-id={board.id}
                role="listitem"
                className={`fc-board-card ${
                  board.id === value.active ? "is-active" : ""
                } ${dragging === board.id ? "is-dragging" : ""}`}
              >
                {!editing && (
                  <button
                    type="button"
                    className="fc-board-drag"
                    disabled={busy}
                    aria-label={t("fcboard.board_drag_page", {
                      page: index + 1,
                    })}
                    aria-pressed={dragging === board.id}
                    onPointerDown={(event) => {
                      if (event.button !== 0 || busy) {
                        return;
                      }
                      event.preventDefault();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      const before = value.boards.map((page) => page.id);
                      drag.current = {
                        id: board.id,
                        pointer: event.pointerId,
                        before,
                        order: [...before],
                        x: event.clientX,
                        y: event.clientY,
                      };
                      setOrder(before);
                      setDragging(board.id);
                      dragFrame.current = requestAnimationFrame(scrollDrag);
                    }}
                    onPointerMove={dragMove}
                    onPointerUp={finishDrag}
                    onPointerCancel={() => {
                      stopDrag(true);
                      setOrder([]);
                    }}
                    onLostPointerCapture={() => {
                      if (drag.current) {
                        stopDrag(true);
                        setOrder([]);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (["ArrowUp", "ArrowDown"].includes(event.key)) {
                        event.preventDefault();
                        const next = index + (event.key === "ArrowUp" ? -1 : 1);
                        if (next < 0 || next >= value.boards.length) {
                          return;
                        }
                        const ids = value.boards.map((page) => page.id);
                        ids.splice(index, 1);
                        ids.splice(next, 0, board.id);
                        void run((source) =>
                          book.current!.reorder(ids, source),
                        );
                      }
                    }}
                  >
                    <img src={boardIcon("drag")} alt="" draggable={false} />
                  </button>
                )}
                <div className="fc-board-preview">
                  <button
                    type="button"
                    className="fc-board-select"
                    disabled={busy}
                    aria-label={t(
                      editing
                        ? "fcboard.board_select_page"
                        : "fcboard.switch_to_name",
                      editing ? { page: index + 1 } : { name: board.name },
                    )}
                    aria-pressed={
                      editing
                        ? chosen.includes(board.id)
                        : board.id === value.active
                    }
                    onClick={() => {
                      if (editing) {
                        toggleChosen(board.id);
                      } else if (board.id !== value.active) {
                        void run(async (source) => {
                          await leavePresentation(source);
                          await book.current!.switch(board.id, source);
                        });
                      }
                    }}
                  >
                    <BoardThumbnail
                      board={board}
                      canvasSize={boardCanvasSize(api.getAppState())}
                    />
                    <small>{String(index + 1).padStart(2, "0")}</small>
                  </button>
                  {editing ? (
                    <input
                      className="fc-board-check"
                      type="checkbox"
                      aria-label={t("fcboard.board_select_page", {
                        page: index + 1,
                      })}
                      checked={chosen.includes(board.id)}
                      disabled={busy}
                      onChange={() => toggleChosen(board.id)}
                      style={{
                        backgroundImage: `url("${boardIcon(
                          chosen.includes(board.id) ? "checked" : "unchecked",
                        )}")`,
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="fc-board-delete"
                      aria-label={t("fcboard.discard_name", {
                        name: board.name,
                      })}
                      title={t("fcboard.discard")}
                      disabled={busy}
                      onClick={() => removePages([board.id])}
                    >
                      <img src={boardIcon("remove")} alt="" draggable={false} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <footer>
            {editing ? (
              <div className="fc-board-edit-actions">
                <button
                  type="button"
                  aria-label={t("labels.selectAll")}
                  title={t("labels.selectAll")}
                  aria-pressed={allChosen}
                  disabled={busy}
                  onClick={() =>
                    setChosen(
                      allChosen ? [] : value.boards.map((board) => board.id),
                    )
                  }
                >
                  <img
                    src={boardIcon(allChosen ? "all-active" : "all")}
                    alt=""
                  />
                </button>
                <button
                  type="button"
                  aria-label={t("fcboard.save_selected")}
                  title={
                    validExportSelection
                      ? t("fcboard.save_selected")
                      : t("fcboard.select_1_to_20_pages")
                  }
                  disabled={busy || !validExportSelection}
                  onClick={() => sharePages("board.saveFile")}
                >
                  <img src={boardIcon("save")} alt="" />
                </button>
                <button
                  type="button"
                  aria-label={t("fcboard.share_selected")}
                  title={
                    validExportSelection
                      ? t("fcboard.share_selected")
                      : t("fcboard.select_1_to_20_pages")
                  }
                  disabled={busy || !validExportSelection}
                  onClick={() => sharePages("board.share")}
                >
                  <img src={boardIcon("share")} alt="" />
                </button>
                {chosen.length > 0 && (
                  <button
                    type="button"
                    aria-label={t("labels.delete")}
                    title={t("labels.delete")}
                    disabled={busy}
                    onClick={() => removePages(chosen)}
                  >
                    <img src={boardIcon("delete")} alt="" />
                  </button>
                )}
                <button
                  type="button"
                  aria-label={t("buttons.cancel")}
                  title={t("buttons.cancel")}
                  disabled={busy}
                  onClick={() => {
                    setEditing(false);
                    setChosen([]);
                  }}
                >
                  <img src={boardIcon("cancel")} alt="" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="fc-board-edit"
                disabled={busy}
                onClick={beginEdit}
              >
                <img src={boardIcon("edit")} alt="" />
                <span>{t("fcboard.board_edit")}</span>
              </button>
            )}
            {book.current?.canRestoreDiscarded && (
              <button
                type="button"
                className="fc-board-restore"
                disabled={busy}
                aria-label={t("buttons.undo")}
                onClick={() =>
                  void run((source) => book.current!.restoreDiscarded(source))
                }
              >
                {UndoIcon}
                <span>{t("buttons.undo")}</span>
              </button>
            )}
          </footer>
        </MaterialPanel>
      )}
    </>
  );
};
