import { t, useI18n } from "@excalidraw/excalidraw/i18n";
import { useEffect, useRef, useState } from "react";
import { ToolbarExtras, exportToBlob } from "@excalidraw/excalidraw";
import {
  TrashIcon,
  save,
  CloseIcon,
} from "@excalidraw/excalidraw/components/icons";
import { FactoryIcon } from "@excalidraw/excalidraw/components/FactoryIcon";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { TransientMessage } from "./TransientMessage";

import { MaterialPanel } from "./MaterialPanel";

import { BoardBook } from "./boards";
import { useAnchoredPanel } from "./floating";

import { classroomCommands } from "./commands";

import type { Board } from "./boards";

const BoardThumbnail = ({ board }: { board: Board }) => {
  const [source, setSource] = useState("");
  useEffect(() => {
    let active = true;
    let url = "";
    if (board.elements.length) {
      void exportToBlob({
        elements: board.elements,
        files: board.files,
        appState: {
          ...board.view,
          exportBackground: true,
          exportWithDarkMode: false,
        },
        mimeType: "image/png",
        maxWidthOrHeight: 280,
      })
        .then((blob) => {
          url = URL.createObjectURL(blob);
          if (active) {
            setSource(url);
          } else {
            URL.revokeObjectURL(url);
          }
        })
        .catch(() => {});
    }
    return () => {
      active = false;
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [board.elements, board.files, board.view, board.updated]);
  return source ? (
    <img
      className="fc-board-thumbnail"
      src={source}
      alt={t("fcboard.{{name}}预览", { name: board.name })}
    />
  ) : null;
};

export const BoardSwitcher = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  useI18n();
  const leavePresentation = async () => {
    if (
      (
        classroomCommands.read("network") as
          | { collaborating?: boolean }
          | undefined
      )?.collaborating
    ) {
      await classroomCommands.execute({ name: "collaboration.stop" });
    }
    if (classroomCommands.has("document.close")) {
      await classroomCommands.execute({
        name: "document.close",
        args: { next: false },
      });
    }
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
      void controller
        .initialize()
        .catch((failure) =>
          setError(
            t("fcboard.白板保存不可用：{{error}}", { error: String(failure) }),
          ),
        );
    };
    const unsubscribe = controller.subscribe(() => {
      classroomCommands.changed("boards");
      if (!cancelled) {
        setValue({ ...controller.value });
      }
    });
    const stopWatch = api.onChange((_elements, state) => {
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
          await leavePresentation();
          await controller.create(
            typeof args.name === "string" ? args.name : undefined,
          );
        },
      ),
      classroomCommands.register(
        "board.switch",
        "切换白板，args.id 或 args.name，或从1开始的 args.index",
        async (args) => {
          const board = controller.value.boards.find(
            (item, index) =>
              item.id === args.id ||
              item.name === args.name ||
              index + 1 === args.index,
          );
          if (!board) {
            throw new Error(t("fcboard.找不到这块白板"));
          }
          await leavePresentation();
          await controller.switch(board.id);
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
          const id = String(args.id || controller.value.active);
          if (id === controller.value.active) {
            await leavePresentation();
          }
          await controller.discard(id);
        },
      ),
      classroomCommands.register("board.save", "保存当前白板到本机", () =>
        controller.flush(),
      ),
      classroomCommands.register("board.pages", "@internal", async () => {
        await controller.flush();
        return controller.value;
      }),
      classroomCommands.context("boards", () => ({
        active: controller.value.active,
        boards: controller.value.boards.map(({ id, name }) => ({ id, name })),
      })),
    ];
    const persist = () => {
      void controller.flush().catch(() => {});
    };
    window.addEventListener("pagehide", persist);
    return () => {
      cancelled = true;
      stopWatch();
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
  const run = async (operation: () => Promise<void>) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await operation();
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
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify({
            type: "excalidraw",
            version: 2,
            source: "Fcboard",
            elements: board.elements,
            files: board.files,
            appState: board.view,
          }),
        ],
        { type: "application/json" },
      ),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${board.name}.excalidraw`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <>
      <ToolbarExtras placement="navigation">
        <div className="fc-toolbar-extras fc-board-controls">
          <button
            aria-label={t("fcboard.上一块白板")}
            disabled={
              busy ||
              value.boards.findIndex((board) => board.id === value.active) <= 0
            }
            onClick={() =>
              void run(async () => {
                const index = book.current!.value.boards.findIndex(
                  (board) => board.id === book.current!.value.active,
                );
                await leavePresentation();
                await book.current!.switch(
                  book.current!.value.boards[index - 1].id,
                );
              })
            }
          >
            <FactoryIcon name="previous" />
          </button>

          <button
            data-board-switcher
            aria-label={t("fcboard.切换白板")}
            title={t("fcboard.切换白板")}
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
            aria-label={t("fcboard.下一块白板")}
            disabled={
              busy ||
              !value.active ||
              value.boards.findIndex((board) => board.id === value.active) >=
                value.boards.length - 1
            }
            onClick={() =>
              void run(async () => {
                const index = book.current!.value.boards.findIndex(
                  (board) => board.id === book.current!.value.active,
                );
                await leavePresentation();
                await book.current!.switch(
                  book.current!.value.boards[index + 1].id,
                );
              })
            }
          >
            <FactoryIcon name="next" />
          </button>
          <button
            aria-label={t("fcboard.新建白板")}
            title={t("fcboard.新建白板")}
            disabled={busy || !value.active}
            onClick={() => {
              void run(async () => {
                await leavePresentation();
                await book.current!.create();
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
          className="fc-board-picker fc-surface"
          style={panelStyle}
          role="dialog"
          aria-label={t("fcboard.我的白板")}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        >
          <header>
            <strong>{t("fcboard.白板")}</strong>
            <button
              aria-label={t("fcboard.关闭白板列表")}
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
                  aria-label={t("fcboard.切换到 {{name}}", {
                    name: board.name,
                  })}
                  aria-pressed={board.id === value.active}
                  onClick={() => {
                    void run(async () => {
                      await leavePresentation();
                      await book.current!.switch(board.id);
                      setOpen(false);
                    });
                  }}
                >
                  <small>{index + 1}</small>
                  <BoardThumbnail board={board} />
                  <span>
                    {board.elements
                      .filter((el) => el.type === "text")
                      .map((el) => (el.type === "text" ? el.text : ""))
                      .join(" · ")
                      .slice(0, 90) ||
                      (board.elements.length
                        ? t("fcboard.手写与图形")
                        : t("fcboard.空白"))}
                  </span>
                </button>
                <input
                  aria-label={t("fcboard.白板 {{page}} 名称", {
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
                  aria-label={t("fcboard.丢弃 {{name}}", { name: board.name })}
                  title={t("fcboard.丢弃")}
                  disabled={busy}
                  onClick={() => {
                    void run(() => book.current!.discard(board.id));
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
              <span>{t("fcboard.保存副本")}</span>
            </button>
          </footer>
        </MaterialPanel>
      )}
    </>
  );
};
