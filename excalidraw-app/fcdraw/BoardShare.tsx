import { Capacitor } from "@capacitor/core";
import { exportToBlob } from "@excalidraw/excalidraw";
import { getDataURL } from "@excalidraw/excalidraw/data/blob";
import { useEffect, useRef, useState } from "react";

import { QRCode } from "../share/QRCode";

import { classroomCommands } from "./commands";
import { useAnchoredPanel } from "./floating";
import { Classroom } from "./native";

import type { Board, Workspace } from "./boards";

/** The existing menu shares chosen pages; collaboration is a separate operation. */
export const BoardShare = () => {
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState<Board[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const panel = useRef<HTMLElement>(null);
  const generation = useRef(0);
  const style = useAnchoredPanel(
    panel,
    "[data-testid='main-menu-trigger']",
    open,
  );
  const native = Capacitor.isNativePlatform();
  useEffect(
    () =>
      classroomCommands.register(
        "board.share",
        "选择白板页面以导出图片或扫码分享",
        async () => {
          setOpen(true);
          setBusy(true);
          setError("");
          try {
            const workspace = (await classroomCommands.execute({
              name: "board.pages",
            })) as Workspace;
            setPages(workspace.boards);
            setSelected([workspace.active]);
          } catch (failure) {
            setError(String(failure));
          } finally {
            setBusy(false);
          }
        },
      ),
    [],
  );
  useEffect(
    () => () => {
      generation.current++;
      if (native) {
        void Classroom.stopShare().catch(() => {});
      }
    },
    [native],
  );
  useEffect(() => {
    if (!urls.length) {
      return;
    }
    const timer = setTimeout(() => {
      setUrls([]);
      setStatus("分享已到期，可重新生成二维码");
    }, 600000);
    return () => clearTimeout(timer);
  }, [urls]);
  const close = async () => {
    generation.current++;
    try {
      if (native) {
        await Classroom.stopShare();
      }
      setUrls([]);
      setOpen(false);
      document
        .querySelector<HTMLButtonElement>("[data-testid='main-menu-trigger']")
        ?.focus();
    } catch (failure) {
      setError(String(failure));
    }
  };
  const share = async (qr: boolean) => {
    const current = ++generation.current;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      if (!selected.length || selected.length > 20) {
        throw new Error("请选择 1 至 20 页");
      }
      const images: string[] = [];
      for (const board of pages.filter((page) => selected.includes(page.id))) {
        const blob = await exportToBlob({
          elements: board.elements.filter((el) => !el.isDeleted),
          files: board.files,
          appState: {
            ...board.view,
            exportBackground: true,
            exportWithDarkMode: false,
          },
          mimeType: "image/png",
          maxWidthOrHeight: 2000,
        });
        if (current !== generation.current) {
          return;
        }
        if (qr) {
          images.push(await getDataURL(blob));
        } else {
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `Fcboard-${pages.indexOf(board) + 1}.png`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }
      if (qr) {
        const result = await Classroom.startShare({ pages: images });
        if (current !== generation.current) {
          return;
        }
        setUrls(result.urls);
        setStatus("扫码下载所选页面，十分钟后失效；关闭窗口即结束分享");
      } else {
        setStatus("所选页面已导出为 PNG");
      }
    } catch (failure) {
      if (current === generation.current) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      if (current === generation.current) {
        setBusy(false);
      }
    }
  };
  if (!open) {
    return null;
  }
  return (
    <section
      ref={panel}
      className="fc-board-picker fc-surface"
      style={style}
      role="dialog"
      aria-label="分享白板"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          void close();
        }
      }}
    >
      <header>
        <strong>分享白板</strong>
        <button aria-label="关闭分享" onClick={() => void close()}>
          关闭
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy}>
        <legend>选择页面</legend>
        {pages.map((page, index) => (
          <label key={page.id} className="fc-share-page">
            <input
              type="checkbox"
              checked={selected.includes(page.id)}
              onChange={(event) =>
                setSelected((previous) =>
                  event.target.checked
                    ? [...previous, page.id]
                    : previous.filter((id) => id !== page.id),
                )
              }
            />
            第 {index + 1} 页 · {page.name}
          </label>
        ))}
      </fieldset>
      {busy && <p role="status">正在准备页面…</p>}
      {status && <p role="status">{status}</p>}
      {urls.map((url) => (
        <div key={url} className="fc-share-code">
          <QRCode value={url} />
          <a href={url} target="_blank" rel="noreferrer">
            {url}
          </a>
        </div>
      ))}
      <footer>
        {native && (
          <button
            disabled={busy || !selected.length}
            onClick={() => void share(true)}
          >
            生成分享二维码
          </button>
        )}
        <button
          disabled={busy || !selected.length}
          onClick={() => void share(false)}
        >
          下载选中页面
        </button>
      </footer>
      {!native && (
        <p>Android 大屏支持同一局域网扫码下载；此处可直接导出页面。</p>
      )}
    </section>
  );
};
