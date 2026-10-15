import { useEffect, useRef, useState } from "react";
import { ToolbarExtras } from "@excalidraw/excalidraw";
import {
  PlusIcon,
  TrashIcon,
  save,
  file,
  CloseIcon,
} from "@excalidraw/excalidraw/components/icons";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { BoardBook } from "./boards";
import { classroomCommands } from "./commands";

export const BoardSwitcher = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  const leavePresentation = async () => {
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
        .catch((failure) => setError(`白板保存不可用：${String(failure)}`));
    };
    const unsubscribe = controller.subscribe(() => {
      if (!cancelled) {
        setValue({ ...controller.value });
      }
    });
    const stopWatch = api.onChange(boot);
    boot();
    const registrations = [
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
            throw new Error("找不到这块白板");
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
    panel.current?.querySelector<HTMLInputElement>("input")?.focus();
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
            source: "Fcdraw",
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
      <ToolbarExtras>
        <div className="fc-toolbar-extras fc-board-controls">
          <button
            data-board-switcher
            aria-label="切换白板"
            title="切换白板"
            aria-expanded={open}
            onClick={() => {
              if (book.current) {
                setValue({ ...book.current.value });
              }
              setOpen(!open);
            }}
          >
            {file}
            <span className="fc-board-count">
              {value.boards.findIndex((board) => board.id === value.active) +
                1 || 1}
            </span>
          </button>
          <button
            aria-label="新建白板"
            title="新建白板"
            disabled={busy || !value.active}
            onClick={() => {
              void run(async () => {
                await leavePresentation();
                await book.current!.create();
              });
            }}
          >
            {PlusIcon}
          </button>
        </div>
      </ToolbarExtras>
      {(open || error) && (
        <section
          ref={panel}
          className="fc-board-picker fc-surface"
          role="dialog"
          aria-label="我的白板"
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        >
          <header>
            <strong>白板</strong>
            <button
              aria-label="关闭白板列表"
              onClick={() => {
                setOpen(false);
                setError("");
              }}
            >
              {CloseIcon}
            </button>
          </header>
          {error && <p role="alert">{error}</p>}
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
                  aria-label={`切换到 ${board.name}`}
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
                  <span>
                    {board.elements
                      .filter((el) => el.type === "text")
                      .map((el) => (el.type === "text" ? el.text : ""))
                      .join(" · ")
                      .slice(0, 90) ||
                      (board.elements.length ? "手写与图形" : "空白")}
                  </span>
                </button>
                <input
                  aria-label={`白板 ${index + 1} 名称`}
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
                  aria-label={`丢弃 ${board.name}`}
                  title="丢弃"
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
              <span>保存副本</span>
            </button>
          </footer>
        </section>
      )}
    </>
  );
};
