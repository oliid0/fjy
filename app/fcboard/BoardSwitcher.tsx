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
              setOpen(!open);
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
            {value.boards.map((board, index) => (
              <div
                key={board.id}
                className={`fc-board-card ${
                  board.id === value.active ? "is-active" : ""
                }`}
              >
                <button
                  className="fc-board-select"
                  disabled={busy}
                  aria-label={t("fcboard.switch_to_name", {
                    name: board.name,
                  })}
                  aria-pressed={board.id === value.active}
                  onClick={() => {
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
                  aria-label={t("fcboard.discard_name", { name: board.name })}
                  title={t("fcboard.discard")}
                  disabled={busy}
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
          <footer>
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
