import { t, useI18n } from "@excalidraw/excalidraw/i18n";
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
  useI18n();
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState<Board[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [mail, setMail] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const generation = useRef(0);
  const style = useAnchoredPanel(
    panel,
    "[data-testid='main-menu-trigger']",
    open,
  );
  const native = Capacitor.isNativePlatform();
  useEffect(() => {
    const openPages = async (email: boolean) => {
      const current = ++generation.current;
      setMail(email);
      setOpen(true);
      setBusy(true);
      setError("");
      setStatus("");
      setUrls([]);
      try {
        if (native) {
          await Classroom.stopShare();
        }
        const workspace = (await classroomCommands.execute({
          name: "board.pages",
        })) as Workspace;
        if (current !== generation.current) {
          return;
        }
        setPages(workspace.boards);
        setSelected([workspace.active]);
      } catch (failure) {
        if (current === generation.current) {
          setError(String(failure));
        }
      } finally {
        if (current === generation.current) {
          setBusy(false);
        }
      }
    };
    const stopShare = classroomCommands.register(
      "board.share",
      "选择白板页面以导出图片或扫码分享",
      () => openPages(false),
    );
    const stopMail = classroomCommands.register(
      "board.mail",
      "选择白板页面，以附件打开系统邮件 / 分享窗口，由用户确认发送",
      () => openPages(true),
    );
    return () => {
      stopShare();
      stopMail();
    };
  }, [native]);
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
      setStatus(t("fcboard.分享已到期，可重新生成二维码"));
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
  const share = async (method: "qr" | "download" | "mail") => {
    const current = ++generation.current;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      if (!selected.length || selected.length > 20) {
        throw new Error(t("fcboard.请选择 1 至 20 页"));
      }
      const images: string[] = [];
      const files: File[] = [];
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
        if (method === "qr" || (method === "mail" && native)) {
          images.push(await getDataURL(blob));
        } else if (method === "mail") {
          files.push(
            new File([blob], `Fcboard-${pages.indexOf(board) + 1}.png`, {
              type: "image/png",
            }),
          );
        } else {
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `Fcboard-${pages.indexOf(board) + 1}.png`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }
      if (method === "qr") {
        const result = await Classroom.startShare({ pages: images });
        if (current !== generation.current) {
          return;
        }
        setUrls(result.urls);
        setStatus(
          t("fcboard.扫码下载所选页面，十分钟后失效；关闭窗口即结束分享"),
        );
      } else if (method === "mail") {
        if (native) {
          await Classroom.sharePages({ pages: images });
        } else if (navigator.canShare?.({ files })) {
          await navigator.share({ files, title: t("fcboard.Fcboard 白板") });
        } else {
          throw new Error(
            t("fcboard.当前浏览器不支持附件分享，请下载页面后在邮件中添加附件"),
          );
        }
        if (current !== generation.current) {
          return;
        }
        setStatus(
          t("fcboard.已打开系统邮件 / 分享窗口，请选择收件应用并确认发送"),
        );
      } else {
        setStatus(t("fcboard.所选页面已导出为 PNG"));
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
      aria-label={t("fcboard.分享白板")}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          void close();
        }
      }}
    >
      <header>
        <strong>{mail ? t("fcboard.邮件发送") : t("fcboard.分享白板")}</strong>
        <button aria-label={t("fcboard.关闭分享")} onClick={() => void close()}>
          {t("fcboard.关闭")}
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy}>
        <legend>{t("fcboard.选择页面")}</legend>
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
            {t("fcboard.第 {{page}} 页", { page: index + 1 })} · {page.name}
          </label>
        ))}
      </fieldset>
      {busy && <p role="status">{t("fcboard.正在准备页面…")}</p>}
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
        {mail && (
          <button
            disabled={busy || !selected.length}
            onClick={() => void share("mail")}
          >
            {t("fcboard.打开邮件 / 分享窗口")}
          </button>
        )}
        {native && !mail && (
          <button
            disabled={busy || !selected.length}
            onClick={() => void share("qr")}
          >
            {t("fcboard.生成分享二维码")}
          </button>
        )}
        <button
          disabled={busy || !selected.length}
          onClick={() => void share("download")}
        >
          {t("fcboard.下载选中页面")}
        </button>
      </footer>
      {!native && (
        <p>
          {t(
            "fcboard.Android 大屏支持同一局域网扫码下载；此处可直接导出页面。",
          )}
        </p>
      )}
    </section>
  );
};
