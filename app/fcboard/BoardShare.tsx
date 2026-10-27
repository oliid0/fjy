import { t, useI18n } from "@excalidraw/excalidraw/i18n";
import { Capacitor } from "@capacitor/core";
import { exportToBlob } from "@excalidraw/excalidraw";
import { getDataURL } from "@excalidraw/excalidraw/data/blob";
import { useEffect, useRef, useState } from "react";
import { CloseIcon } from "@excalidraw/excalidraw/components/icons";

import { QRCode } from "../share/QRCode";

import { TransientMessage } from "./TransientMessage";

import { classroomCommands } from "./commands";
import { Classroom } from "./native";
import { MaterialPanel } from "./MaterialPanel";
import { BoardThumbnail } from "./BoardThumbnail";
import documentIcon from "./factory-share-icons/document.svg?url";
import imageIcon from "./factory-share-icons/jpg.svg?url";
import pdfIcon from "./factory-share-icons/pdf.svg?url";

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
  const [choosing, setChoosing] = useState(true);
  const panel = useRef<HTMLElement>(null);
  const generation = useRef(0);
  const native = Capacitor.isNativePlatform();
  useEffect(() => {
    const openPages = async (email: boolean) => {
      const current = ++generation.current;
      setMail(email);
      setChoosing(true);
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
        setSelected(workspace.boards.map((board) => board.id).slice(0, 20));
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
      setStatus(t("fcboard.sharing_expired_generate_a_new_qr_code"));
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
  const exportEditable = () => {
    for (const board of pages.filter((page) => selected.includes(page.id))) {
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
      const link = document.createElement("a");
      link.href = url;
      link.download = `${board.name}.excalidraw`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };
  const share = async (method: "qr" | "download" | "mail" | "pdf") => {
    const current = ++generation.current;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      if (!selected.length || selected.length > 20) {
        throw new Error(t("fcboard.select_1_to_20_pages"));
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
          mimeType: method === "download" ? "image/jpeg" : "image/png",
          maxWidthOrHeight: 2000,
        });
        if (current !== generation.current) {
          return;
        }
        if (
          method === "qr" ||
          method === "pdf" ||
          (method === "mail" && native)
        ) {
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
          link.download = `Fcboard-${pages.indexOf(board) + 1}.jpg`;
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
          t(
            "fcboard.scan_to_download_the_selected_pages_expires_in_ten_minutes_or_when_this_window_closes",
          ),
        );
      } else if (method === "mail" || method === "pdf") {
        if (native) {
          await Classroom.sharePages({
            pages: images,
            ...(method === "pdf" ? { format: "pdf" as const } : {}),
          });
        } else if (navigator.canShare?.({ files })) {
          await navigator.share({
            files,
            title: t("fcboard.fcboard_whiteboard"),
          });
        } else {
          throw new Error(
            t(
              "fcboard.this_browser_cannot_share_attachments_download_the_pages_and_attach_them_to_your_email",
            ),
          );
        }
        if (current !== generation.current) {
          return;
        }
        setStatus(
          t(
            "fcboard.choose_an_app_in_the_system_share_window_and_confirm_sending",
          ),
        );
      } else {
        setStatus(t("fcboard.selected_pages_exported_as_images"));
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
    <MaterialPanel
      centered
      onDismiss={() => void close()}
      ref={panel}
      className={`fc-share-dialog fc-surface${
        !choosing && !mail ? " fc-share-dialog--formats" : ""
      }`}
      role="dialog"
      aria-label={t("fcboard.share_board")}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          void close();
        }
      }}
    >
      <header>
        <strong>
          {choosing
            ? t("fcboard.select_pages")
            : mail
            ? t("fcboard.mail_sent")
            : t("fcboard.share_board")}
        </strong>
        <button
          aria-label={t("fcboard.close_sharing")}
          onClick={() => void close()}
        >
          {CloseIcon}
        </button>
      </header>
      <TransientMessage message={error} role="alert" />
      {choosing ? (
        <fieldset disabled={busy}>
          <legend>{t("fcboard.select_pages")}</legend>
          <div className="fc-share-selection">
            <button
              type="button"
              onClick={() =>
                setSelected(pages.map((page) => page.id).slice(0, 20))
              }
            >
              {t("labels.selectAll")}
            </button>
            <button type="button" onClick={() => setSelected([])}>
              {t("fcboard.select_none")}
            </button>
          </div>
          <div className="fc-share-pages">
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
                <BoardThumbnail board={page} />
                <span>{t("fcboard.page_page", { page: index + 1 })}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {!choosing && !mail && (
        <div className="fc-share-formats">
          <button
            type="button"
            disabled={busy || !selected.length}
            onClick={exportEditable}
          >
            <img src={documentIcon} alt="" />
            <span>{t("fcboard.save_a_copy")} (.excalidraw)</span>
          </button>
          <button
            type="button"
            disabled={busy || !selected.length}
            onClick={() => void share("download")}
          >
            <img src={imageIcon} alt="" />
            <span>{t("fcboard.download_selected_pages")}</span>
          </button>
          {native && (
            <button
              type="button"
              disabled={busy || !selected.length}
              onClick={() => void share("pdf")}
            >
              <img src={pdfIcon} alt="" />
              <span>PDF</span>
            </button>
          )}
        </div>
      )}
      {busy && <p role="status">{t("fcboard.preparing_pages")}</p>}
      <TransientMessage message={status} />
      {urls.map((url) => (
        <div key={url} className="fc-share-code">
          <QRCode value={url} />
          <a href={url} target="_blank" rel="noreferrer">
            {url}
          </a>
        </div>
      ))}
      <footer>
        {choosing ? (
          <>
            <button type="button" onClick={() => void close()}>
              {t("buttons.cancel")}
            </button>
            <button
              type="button"
              disabled={busy || !selected.length}
              onClick={() => setChoosing(false)}
            >
              {t("buttons.confirm")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setChoosing(true)}
            >
              {t("fcboard.select_pages")}
            </button>
            {mail && (
              <button
                disabled={busy || !selected.length}
                onClick={() => void share("mail")}
              >
                {t("fcboard.open_email_share_window")}
              </button>
            )}
            {native && !mail && (
              <button
                disabled={busy || !selected.length}
                onClick={() => void share("qr")}
              >
                {t("fcboard.generate_sharing_qr_code")}
              </button>
            )}
            {mail && (
              <button
                disabled={busy || !selected.length}
                onClick={() => void share("download")}
              >
                {t("fcboard.download_selected_pages")}
              </button>
            )}
          </>
        )}
      </footer>
      {!native && !choosing && (
        <p>
          {t(
            "fcboard.android_displays_support_qr_downloads_on_the_same_network_you_can_export_pages_here",
          )}
        </p>
      )}
    </MaterialPanel>
  );
};
