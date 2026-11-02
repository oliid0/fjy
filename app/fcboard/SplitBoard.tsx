import { useEffect, useRef, useState } from "react";
import { Fcboard } from "@fcboard/fcboard";
import { getLanguage } from "@fcboard/fcboard/i18n";
import { CaptureUpdateAction } from "@fcboard/element";
import { FactoryIcon } from "@fcboard/fcboard/components/FactoryIcon";
import { createStore, get, set } from "idb-keyval";

import type { FcboardElement } from "@fcboard/element/types";
import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { classroomCommands } from "./commands";
import { MaterialPanel } from "./MaterialPanel";
import { savePageFiles } from "./boardFile";
import { insertText } from "./board";

import "./SplitBoard.scss";

// MultiScreen's SplitScreenPop / MainBarContainer / MultiBar: vertical 2/3/4
// writing regions, each with its own pen and eraser, rather than OS app tiling.
const backgrounds = ["#ffffff", "#5c7c62", "#cfaa29", "#312e2e"];
const storage = createStore("fcboard-split", "workspace");
type SplitWorkspace = {
  count: number;
  background: string;
  panes: (readonly FcboardElement[])[];
};

export const SplitBoard = () => {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState(2);
  const [background, setBackground] = useState(backgrounds[0]);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState([
    "#000000",
    "#000000",
    "#000000",
    "#000000",
  ]);
  const [busy, setBusy] = useState(false);
  const [exit, setExit] = useState(false);
  const panes = useRef<SplitWorkspace["panes"]>([]);
  const apis = useRef(new Map<number, FcboardImperativeAPI>());
  const root = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const current = useRef({ count, background });
  current.current = { count, background };
  const writing = useRef(Promise.resolve());
  const persist = () => {
    clearTimeout(saveTimer.current);
    const value = { ...current.current, panes: [...panes.current] };
    writing.current = writing.current
      .catch(() => {})
      .then(() => set("workspace", value, storage));
    void writing.current.catch((failure) =>
      setError(`分屏笔迹保存失败：${String(failure)}`),
    );
  };
  useEffect(() => {
    let alive = true;
    void get<SplitWorkspace>("workspace", storage)
      .then((saved) => {
        if (!alive) {
          return;
        }
        if (
          saved &&
          [2, 3, 4].includes(saved.count) &&
          backgrounds.includes(saved.background) &&
          Array.isArray(saved.panes)
        ) {
          panes.current = saved.panes.slice(0, 4);
          setCount(saved.count);
          setBackground(saved.background);
        }
      })
      .catch((failure) => {
        if (alive) {
          setError(`无法读取分屏笔迹：${String(failure)}`);
        }
      })
      .finally(() => {
        if (alive) {
          setReady(true);
        }
      });
    const release = classroomCommands.register(
      "tools.split",
      "打开内置2/3/4区分屏书写白板，各区独立黑/蓝/红笔和橡皮；无需外部APK或系统权限。",
      () => {
        setSettings(true);
        return { opened: true, kind: "writing-regions" };
      },
    );
    const write = classroomCommands.register(
      "split.write",
      "在已打开的分屏书写区写字：args.region=1..4，args.text为完整文字。各区独立，不会写到被覆盖的主白板。",
      async (args) => {
        const signal =
          args.signal instanceof AbortSignal
            ? args.signal
            : classroomCommands.interactionSource;
        signal?.throwIfAborted();
        if (
          typeof args.region !== "number" ||
          !Number.isInteger(args.region) ||
          args.region < 1 ||
          args.region > 4 ||
          typeof args.text !== "string" ||
          !args.text.trim() ||
          args.text.length > 4000
        ) {
          throw new Error("请选择已打开的分区和要写的文字");
        }
        const api = apis.current.get(args.region - 1);
        if (!api) {
          throw new Error("该分屏尚未打开");
        }
        return { ids: await insertText(api, args.text) };
      },
    );
    return () => {
      alive = false;
      release();
      write();
      clearTimeout(saveTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!open) {
      return;
    }
    const release = classroomCommands.context("split", () => ({
      count,
      background,
      open: true,
    }));
    return release;
  }, [open, count, background]);
  const close = () => {
    persist();
    setOpen(false);
    setExit(false);
    apis.current.clear();
  };
  const exportImage = async () => {
    setBusy(true);
    setError("");
    try {
      const source = root.current;
      if (!source) {
        throw new Error("分屏画布尚未就绪");
      }
      const views = [...source.querySelectorAll<HTMLElement>(".fc-split-pane")];
      const width = Math.min(
        3840,
        Math.round(source.clientWidth * Math.min(2, devicePixelRatio || 1)),
      );
      const height = Math.round(
        (width * (views[0].clientHeight - 68)) / source.clientWidth,
      );
      if (!width || !height) {
        throw new Error("分屏画布没有可保存的尺寸");
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("无法创建保存画布");
      }
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
      views.forEach((view, index) => {
        for (const layer of view.querySelectorAll<HTMLCanvasElement>(
          "canvas.fcboard__canvas.static, canvas.fcboard__canvas.new-element",
        )) {
          context.drawImage(
            layer,
            (index * width) / count,
            0,
            width / count,
            height,
          );
        }
      });
      context.setLineDash([10, 10]);
      context.strokeStyle = "#000000";
      context.lineWidth = 1.5;
      for (let index = 1; index < count; index++) {
        context.beginPath();
        context.moveTo((index * width) / count, 0);
        context.lineTo((index * width) / count, height);
        context.stroke();
      }
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value ? resolve(value) : reject(new Error("分屏图像生成失败")),
          "image/jpeg",
          0.95,
        ),
      );
      if (await savePageFiles([{ page: 1, blob }], "分屏书写", "jpg")) {
        close();
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  const tools = [
    ["黑笔", "#000000"],
    ["蓝笔", "#0041ff"],
    ["红笔", "#ff0000"],
    ["橡皮", "eraser"],
  ] as const;
  return (
    <>
      {open && (
        <div
          className="fc-split-board"
          ref={root}
          role="region"
          aria-label="分屏书写白板"
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              setExit(true);
            }
          }}
        >
          <div
            className="fc-split-panes"
            style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: count }, (_, index) => (
              <section
                className="fc-split-pane"
                key={index}
                aria-label={`第${index + 1}分屏`}
              >
                <Fcboard
                  langCode={getLanguage().code}
                  autoFocus={false}
                  handleKeyboardGlobally={false}
                  detectScroll={true}
                  UIOptions={{
                    unifiedToolbar: true,
                    library: false,
                    tools: { image: false },
                  }}
                  initialData={{
                    elements: panes.current[index] || [],
                    appState: {
                      viewBackgroundColor: background,
                      currentItemStrokeColor: "#000000",
                      currentItemStrokeWidth: 3,
                      currentItemPenMode: "hard",
                      toolbarHidden: true,
                      multiStroke: true,
                      activeTool: {
                        type: "freedraw",
                        customType: null,
                        locked: true,
                        fromSelection: false,
                        lastActiveTool: null,
                      },
                    },
                  }}
                  onMount={({ excalidrawAPI }) => {
                    apis.current.set(index, excalidrawAPI);
                  }}
                  onChange={(elements) => {
                    panes.current[index] = elements;
                    clearTimeout(saveTimer.current);
                    saveTimer.current = setTimeout(persist, 400);
                  }}
                />
                <div
                  className="fc-split-toolbar"
                  role="toolbar"
                  aria-label={`第${index + 1}区工具`}
                >
                  {tools.map(([label, value]) => (
                    <button
                      key={value}
                      aria-label={`第${index + 1}区${label}`}
                      aria-pressed={chosen[index] === value}
                      style={{ color: value === "eraser" ? undefined : value }}
                      onClick={() => {
                        setChosen((previous) =>
                          previous.map((item, pane) =>
                            pane === index ? value : item,
                          ),
                        );
                        const api = apis.current.get(index);
                        if (!api) {
                          return;
                        }
                        api.updateScene({
                          appState: {
                            currentItemStrokeColor:
                              value === "eraser"
                                ? api.getAppState().currentItemStrokeColor
                                : value,
                            eraserMode: "stroke",
                            eraserSize: 40,
                          },
                        });
                        api.setActiveTool({
                          type: value === "eraser" ? "eraser" : "freedraw",
                          locked: true,
                        });
                      }}
                    >
                      <FactoryIcon
                        name={value === "eraser" ? "eraser" : "pen"}
                      />
                      {label}
                    </button>
                  ))}
                  <button
                    aria-label={`清空第${index + 1}区`}
                    onClick={() =>
                      apis.current.get(index)?.updateScene({
                        elements: [],
                        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
                      })
                    }
                  >
                    清空
                  </button>
                </div>
              </section>
            ))}
          </div>
          <button className="fc-split-close" onClick={() => setExit(true)}>
            退出分屏
          </button>
        </div>
      )}
      {settings && (
        <MaterialPanel
          centered
          role="dialog"
          aria-label="分屏设置"
          className="fc-split-settings fc-surface"
          onDismiss={() => setSettings(false)}
        >
          <h3>分屏设置</h3>
          <p>设置分屏</p>
          <div>
            {[2, 3, 4].map((value) => (
              <button
                key={value}
                aria-pressed={count === value}
                disabled={open || !ready}
                onClick={() => setCount(value)}
              >
                {value}分屏
              </button>
            ))}
          </div>
          <p>设置背景</p>
          <div>
            {backgrounds.map((value, index) => (
              <button
                key={value}
                aria-label={`背景${index + 1}`}
                aria-pressed={background === value}
                style={{ backgroundColor: value }}
                disabled={!ready}
                onClick={() => setBackground(value)}
              >
                　
              </button>
            ))}
          </div>
          {!ready && <p role="status">正在读取分屏笔迹…</p>}
          {error && <p role="alert">{error}</p>}
          <button
            disabled={!ready}
            onClick={() => {
              setChosen(["#000000", "#000000", "#000000", "#000000"]);
              setSettings(false);
              setOpen(true);
            }}
          >
            确定
          </button>
          <button onClick={() => setSettings(false)}>取消</button>
        </MaterialPanel>
      )}
      {exit && (
        <MaterialPanel
          centered
          role="dialog"
          aria-label="退出分屏"
          className="fc-split-settings fc-surface"
          onDismiss={() => setExit(false)}
        >
          <p>是否保存分屏书写图像？笔迹会自动保留。</p>
          <button disabled={busy} onClick={() => void exportImage()}>
            {busy ? "正在保存…" : "保存并退出"}
          </button>
          <button disabled={busy} onClick={close}>
            退出
          </button>
          <button disabled={busy} onClick={() => setExit(false)}>
            取消
          </button>
          {error && <p role="alert">{error}</p>}
        </MaterialPanel>
      )}
    </>
  );
};
