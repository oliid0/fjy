import { t, useI18n } from "@fcboard/fcboard/i18n";
import { useEffect, useRef, useState } from "react";
import { ToolbarExtras } from "@fcboard/fcboard";
import { TrashIcon, save, CloseIcon } from "@fcboard/fcboard/components/icons";
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

import type { PointerEvent as ReactPointerEvent } from "react";

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
    { id: string; pointer: number; before: string[] } | undefined
  >(undefined);
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
  useEffect(() => {
    if (!open) {
      return;
    }
    setEditing(false);
    setOrder(book.current?.value.boards.map((board) => board.id) || []);
    setChosen(book.current?.value.active ? [book.current.value.active] : []);
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
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [open]);
  useEffect(() => {
    const action = (event: Event) => {
      if (
        !(event as CustomEvent<HTMLElement>).detail.closest(
          "[data-board-switcher]",
        )
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("fcboard:toolbar-action", action);
    return () => window.removeEventListener("fcboard:toolbar-action", action);
  }, []);
  const run = async (operation: (source?: AbortSignal) => Promise<void>) => {
    const source = classroomCommands.interactionSource;
    if (busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      source?.throwIfAborted();
      await operation(source);
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  };
  const download = async () => {
    await book.current!.flush();
    const board = book.current!.value.boards.find(
      (item) => item.id === value.active,
    )!;
    await saveBoardFile([board], board.name);
  };
  const beginEdit = () => {
    setOrder(value.boards.map((board) => board.id));
    setChosen([value.active]);
    setEditing(true);
  };
  const move = (id: string, target: string) => {
    setOrder((previous) => {
      const next = [...previous];
      const from = next.indexOf(id);
      const to = next.indexOf(target);
      if (from < 0 || to < 0 || from === to) {
        return previous;
      }
      next.splice(from, 1);
      next.splice(to, 0, id);
      return next;
    });
  };
  const dragMove = (event: ReactPointerEvent) => {
    if (drag.current?.pointer !== event.pointerId) {
      return;
    }
    const card = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-board-id]");
    if (card?.dataset.boardId) {
      move(drag.current.id, card.dataset.boardId);
    }
    // Keep long lists reachable while a contact is captured by the handle.
    const list = panel.current;
    const bounds = list?.getBoundingClientRect();
    if (list && bounds) {
      if (event.clientY < bounds.top + 48) {
        list.scrollTop -= 16;
      }
      if (event.clientY > bounds.bottom - 72) {
        list.scrollTop += 16;
      }
    }
  };
  const sharePages = (command: "board.share" | "board.saveFile") =>
    void run(async () => {
      await classroomCommands.execute({
        name: command,
        args: { ids: editing ? chosen : [value.active] },
      });
      setOpen(false);
    });
  const visibleBoards = editing
    ? order
        .map((id) => value.boards.find((board) => board.id === id))
        .filter((board): board is NonNullable<typeof board> => !!board)
    : value.boards;
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
            aria-label={t("fcboard.switch_board")}
            title={t("fcboard.switch_board")}
            aria-expanded={open}
            onClick={() => {
              if (book.current) {
                setValue({ ...book.current.value });
              }
              setOpen(true);
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
            onClick={() => {
              void run(async (source) => {
                await leavePresentation(source);
                await book.current!.create(undefined, source);
              });
            }}
          >
            <FactoryIcon name="add" />
          </button>
        </div>
      </ToolbarExtras>
      {(open || error) && (
        <MaterialPanel
          ref={panel}
          className="fc-board-picker fc-board-preview-list fc-surface"
          style={panelStyle}
          role="dialog"
          aria-label={t("fcboard.my_boards")}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        >
          <header>
            <strong>{t("fcboard.board")}</strong>
            <button
              aria-label={t("fcboard.close_board_list")}
              onClick={() => {
                setOpen(false);
                setError("");
              }}
            >
              {CloseIcon}
            </button>
          </header>
          <TransientMessage message={error} role="alert" />
          <div className="fc-board-list">
            {visibleBoards.map((board, index) => (
              <div
                key={board.id}
                data-board-id={board.id}
                className={`fc-board-card ${
                  board.id === value.active ? "is-active" : ""
                }`}
              >
                <button
                  type="button"
                  className="fc-board-drag"
                  disabled={busy}
                  aria-label={t("fcboard.board_drag_page", { page: index + 1 })}
                  aria-pressed={dragging === board.id}
                  onPointerDown={(event) => {
                    if (event.button !== 0) {
                      return;
                    }
                    if (!editing) {
                      beginEdit();
                    }
                    event.currentTarget.setPointerCapture(event.pointerId);
                    drag.current = {
                      id: board.id,
                      pointer: event.pointerId,
                      before: editing
                        ? [...order]
                        : value.boards.map((page) => page.id),
                    };
                    setDragging(board.id);
                  }}
                  onPointerMove={dragMove}
                  onPointerUp={() => {
                    drag.current = undefined;
                    setDragging(undefined);
                  }}
                  onPointerCancel={() => {
                    if (drag.current) {
                      setOrder(drag.current.before);
                    }
                    drag.current = undefined;
                    setDragging(undefined);
                  }}
                  onKeyDown={(event) => {
                    if (["ArrowUp", "ArrowDown"].includes(event.key)) {
                      event.preventDefault();
                      if (!editing) {
                        beginEdit();
                      }
                      const next =
                        visibleBoards[
                          index + (event.key === "ArrowUp" ? -1 : 1)
                        ];
                      if (next) {
                        move(board.id, next.id);
                      }
                    }
                  }}
                >
                  ⠿
                </button>
                {editing && (
                  <input
                    className="fc-board-check"
                    type="checkbox"
                    aria-label={t("fcboard.board_select_page", {
                      page: index + 1,
                    })}
                    checked={chosen.includes(board.id)}
                    disabled={
                      busy ||
                      (!chosen.includes(board.id) && chosen.length >= 20)
                    }
                    onChange={(event) =>
                      setChosen((previous) =>
                        event.target.checked
                          ? [...previous, board.id]
                          : previous.filter((id) => id !== board.id),
                      )
                    }
                  />
                )}
                <button
                  className="fc-board-select"
                  disabled={busy}
                  aria-label={t("fcboard.switch_to_name", {
                    name: board.name,
                  })}
                  aria-pressed={board.id === value.active}
                  onClick={() => {
                    if (editing) {
                      setChosen((previous) =>
                        previous.includes(board.id)
                          ? previous.filter((id) => id !== board.id)
                          : previous.length < 20
                          ? [...previous, board.id]
                          : previous,
                      );
                      return;
                    }
                    void run(async (source) => {
                      await leavePresentation(source);
                      await book.current!.switch(board.id, source);
                      setOpen(false);
                    });
                  }}
                >
                  <small>{index + 1}</small>
                  <BoardThumbnail
                    board={board}
                    canvasSize={boardCanvasSize(api.getAppState())}
                  />
                  <span>
                    {board.elements
                      .filter((el) => el.type === "text")
                      .map((el) => (el.type === "text" ? el.text : ""))
                      .join(" · ")
                      .slice(0, 90) ||
                      (board.elements.length
                        ? t("fcboard.ink_and_shapes")
                        : t("fcboard.empty"))}
                  </span>
                </button>
                <input
                  aria-label={t("fcboard.board_page_name", {
                    page: index + 1,
                  })}
                  defaultValue={board.name}
                  disabled={busy || editing}
                  key={`${board.id}:${board.name}`}
                  onBlur={(event) => {
                    if (event.target.value !== board.name) {
                      void run(() =>
                        book.current!.rename(board.id, event.target.value),
                      );
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                />
                <button
                  className="fc-board-delete"
                  aria-label={t("fcboard.discard_name", { name: board.name })}
                  title={t("fcboard.discard")}
                  disabled={busy || editing}
                  onClick={() => {
                    void run((source) =>
                      book.current!.discard(board.id, source),
                    );
                  }}
                >
                  {TrashIcon}
                </button>
              </div>
            ))}
          </div>
          {editing && <p>{t("fcboard.board_sort_hint")}</p>}
          <footer>
            <button
              type="button"
              disabled={busy || (editing ? !chosen.length : !value.active)}
              onClick={() => sharePages("board.share")}
            >
              <FactoryIcon name="qr" />
              <span>{t("fcboard.share_selected")}</span>
            </button>
            <button
              type="button"
              disabled={busy || (editing ? !chosen.length : !value.active)}
              onClick={() => sharePages("board.saveFile")}
            >
              <FactoryIcon name="save" />
              <span>{t("fcboard.save_selected")}</span>
            </button>
            {editing ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setEditing(false);
                    setDragging(undefined);
                    drag.current = undefined;
                  }}
                >
                  {t("buttons.cancel")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async (source) => {
                      await book.current!.reorder(order, source);
                      setEditing(false);
                    })
                  }
                >
                  {t("buttons.confirm")}
                </button>
              </>
            ) : (
              <button type="button" disabled={busy} onClick={beginEdit}>
                {t("fcboard.board_edit")}
              </button>
            )}
            <button
              disabled={busy || !value.active}
              onClick={() => {
                void run(download);
              }}
            >
              {save}
              <span>{t("fcboard.save_a_copy")}</span>
            </button>
          </footer>
        </MaterialPanel>
      )}
    </>
  );
};
