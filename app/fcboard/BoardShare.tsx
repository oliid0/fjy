import { t, useI18n } from "@fcboard/fcboard/i18n";
import { Capacitor } from "@capacitor/core";
import { exportToBlob } from "@fcboard/fcboard";
import { getDataURL } from "@fcboard/fcboard/data/blob";
import { useEffect, useRef, useState } from "react";
import { CloseIcon } from "@fcboard/fcboard/components/icons";

import { TransientMessage } from "./TransientMessage";

import { classroomCommands } from "./commands";
import { Classroom } from "./native";
import { MaterialPanel } from "./MaterialPanel";
import { BoardThumbnail } from "./BoardThumbnail";
import documentIcon from "./factory-share-icons/document.svg?url";
import imageIcon from "./factory-share-icons/jpg.svg?url";
import pdfIcon from "./factory-share-icons/pdf.svg?url";

import { saveBoardFile, savePageFiles } from "./boardFile";
import { MailComposer } from "./MailComposer";
import { ShareQRCode, useShareProtection } from "./ShareQRCode";
import { boardPageExportOptions, boardCanvasSize } from "./boardExport";
import { ShareServerChooser } from "./ShareServerChooser";
import { BzdCodeDialog } from "./BzdCodeDialog";
import { CloudPageShare, uploadCloudBzd } from "./cloudTransfers";
import { serializeBzd } from "./bzd";

import type { CloudShareConfig } from "./cloudShare";
import type { Board } from "./boards";
import type { BoardPages, BoardCanvasSize } from "./boardExport";

/** The existing menu shares chosen pages; collaboration is a separate operation. */
export const BoardShare = () => {
  useI18n();
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState<Board[]>([]);
  const [canvasSize, setCanvasSize] = useState(boardCanvasSize);
  const [selected, setSelected] = useState<string[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [mailResult, setMailResult] = useState<{
    id: string;
    message: string;
  }>();
  useEffect(() => {
    if (open) {
      setMailResult(undefined);
    }
  }, [open]);
  const [mail, setMail] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [choosing, setChoosing] = useState(true);
  const [transfer, setTransfer] = useState<"qr" | "bzd">();
  const [code, setCode] = useState("");
  const cloud = useRef<CloudPageShare | undefined>(undefined);
  const panel = useRef<HTMLElement>(null);
  const generation = useRef(0);
  const exportRequest = useRef<AbortController | undefined>(undefined);
  const native = Capacitor.isNativePlatform();
  const protection = useShareProtection((password) =>
    cloud.current
      ? cloud.current.setPassword(password)
      : Classroom.setSharePassword({ password }),
  );
  useEffect(
    () =>
      classroomCommands.watch("boards", () => {
        const size = (
          classroomCommands.read("boards") as
            | { canvasSize?: BoardCanvasSize }
            | undefined
        )?.canvasSize;
        if (size) {
          setCanvasSize((previous) =>
            previous.width === size.width &&
            previous.height === size.height &&
            previous.pixelRatio === size.pixelRatio
              ? previous
              : size,
          );
        }
      }),
    [],
  );
  useEffect(() => {
    const openPages = async (email: boolean, saveFile = false) => {
      exportRequest.current?.abort();
      const current = ++generation.current;
      setMail(email);
      setSavingFile(saveFile);
      setChoosing(true);
      setTransfer(undefined);
      setCode("");
      setOpen(true);
      setBusy(true);
      setError("");
      setStatus("");
      setUrls([]);
      try {
        if (cloud.current) {
          await cloud.current.end();
          cloud.current = undefined;
        }
        if (native) {
          await Classroom.stopShare();
        }
        const workspace = (await classroomCommands.execute({
          name: "board.pages",
        })) as BoardPages;
        if (current !== generation.current) {
          return;
        }
        setPages(workspace.boards);
        setCanvasSize(workspace.canvasSize ?? boardCanvasSize());
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
    const stopSave = classroomCommands.register(
      "board.saveFile",
      "选择白板页面并保存原厂 BZD / JPG / PDF 文件",
      () => openPages(false, true),
    );
    const stopMail = classroomCommands.register(
      "board.mail",
      "选择白板页面并打开邮件；Android 使用原版账户 / 提供方 / 写信 / SMTP 配置层级，可由 mail.action 和 mail.configure 操作，发送选中页面 PDF；浏览器打开系统分享",
      () => openPages(true),
    );
    return () => {
      stopShare();
      stopMail();
      stopSave();
    };
  }, [native]);
  useEffect(
    () => () => {
      generation.current++;
      exportRequest.current?.abort();
      if (cloud.current) {
        void cloud.current.end().catch(() => {});
      }
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
    exportRequest.current?.abort();
    generation.current++;
    try {
      if (cloud.current) {
        await cloud.current.end();
        cloud.current = undefined;
      }
      if (native) {
        await Classroom.stopShare();
      }
      setUrls([]);
      setOpen(false);
      document
        .querySelector<HTMLButtonElement>("[data-testid='main-menu-trigger']")
        ?.focus();
    } catch (failure) {
      setTransfer(undefined);
      setError(String(failure));
    }
  };
  const exportEditable = async (
    config?: CloudShareConfig,
    signal?: AbortSignal,
  ) => {
    const controller = new AbortController();
    exportRequest.current?.abort();
    exportRequest.current = controller;
    const abort = () => controller.abort(signal?.reason);
    signal?.throwIfAborted();
    signal?.addEventListener("abort", abort, { once: true });
    const current = ++generation.current;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const chosen = pages.filter((page) => selected.includes(page.id));
      if (config) {
        const result = await uploadCloudBzd(
          config,
          serializeBzd(chosen),
          controller.signal,
        );
        if (current === generation.current && !controller.signal.aborted) {
          setCode(result.code);
          setTransfer(undefined);
        }
        return;
      }
      const saved = await saveBoardFile(
        chosen,
        chosen[0]?.name || "Fcboard",
        controller.signal,
      );
      if (saved && current === generation.current) {
        setStatus(t("fcboard.file_saved"));
        setTransfer(undefined);
      }
    } catch (failure) {
      if (signal) {
        throw failure;
      }
      if (current === generation.current && !controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      signal?.removeEventListener("abort", abort);
      if (current === generation.current) {
        setBusy(false);
      }
    }
  };
  const share = async (
    method: "qr" | "download" | "mail" | "pdf",
    config?: CloudShareConfig,
    signal?: AbortSignal,
  ) => {
    const current = ++generation.current;
    const controller = new AbortController();
    exportRequest.current?.abort();
    exportRequest.current = controller;
    const abort = () => controller.abort(signal?.reason);
    signal?.throwIfAborted();
    signal?.addEventListener("abort", abort, { once: true });
    setBusy(true);
    setError("");
    setStatus("");
    try {
      if (!selected.length || selected.length > 20) {
        throw new Error(t("fcboard.select_1_to_20_pages"));
      }
      const images: string[] = [];
      const files: File[] = [];
      const rasterPages: { page: number; blob: Blob }[] = [];
      for (const board of pages.filter((page) => selected.includes(page.id))) {
        const options =
          method === "qr"
            ? {
                elements: board.elements.filter((el) => !el.isDeleted),
                files: board.files,
                appState: {
                  ...board.view,
                  exportBackground: true,
                  exportWithDarkMode: false,
                },
                maxWidthOrHeight: 2000,
              }
            : boardPageExportOptions(board, canvasSize);
        const blob = await exportToBlob({
          ...options,
          mimeType:
            method === "download" || method === "pdf"
              ? "image/jpeg"
              : "image/png",
          ...(method === "download" || method === "pdf" ? { quality: 1 } : {}),
        });
        if (current !== generation.current) {
          return;
        }
        controller.signal.throwIfAborted();
        if (method === "qr" || (method === "mail" && native)) {
          images.push(await getDataURL(blob));
        } else if (method === "mail") {
          files.push(
            new File([blob], `Fcboard-${pages.indexOf(board) + 1}.png`, {
              type: "image/png",
            }),
          );
        } else {
          rasterPages.push({ page: pages.indexOf(board) + 1, blob });
        }
      }
      if (method === "qr") {
        controller.signal.throwIfAborted();
        let result: { urls: string[] };
        if (config) {
          const session = await CloudPageShare.start(
            config,
            images,
            controller.signal,
          );
          if (current !== generation.current || controller.signal.aborted) {
            await session.end();
            return;
          }
          cloud.current = session;
          result = { urls: [session.url] };
        } else {
          result = await Classroom.startShare({ pages: images });
          if (current !== generation.current || controller.signal.aborted) {
            await Classroom.stopShare();
            return;
          }
        }
        protection.reset();
        setUrls(result.urls);
        setTransfer(undefined);
        setStatus(
          t(
            "fcboard.scan_to_download_the_selected_pages_expires_in_ten_minutes_or_when_this_window_closes",
          ),
        );
      } else if (method === "mail") {
        if (native) {
          await Classroom.sharePages({
            pages: images,
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
        const saved = await savePageFiles(
          rasterPages,
          "Fcboard",
          method === "pdf" ? "pdf" : "jpg",
          controller.signal,
        );
        if (saved && current === generation.current) {
          setStatus(t("fcboard.file_saved"));
        }
      }
    } catch (failure) {
      if (signal) {
        throw failure;
      }
      if (current === generation.current) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      signal?.removeEventListener("abort", abort);
      if (current === generation.current) {
        setBusy(false);
      }
    }
  };
  if (!open) {
    return mailResult ? (
      <TransientMessage
        key={mailResult.id}
        className="fc-share-result"
        message={mailResult.message}
      />
    ) : null;
  }
  if (code) {
    return <BzdCodeDialog code={code} onClose={() => void close()} />;
  }
  if (transfer) {
    return (
      <ShareServerChooser
        title={transfer === "qr" ? t("fcboard.qr_share") : "BZD"}
        onClose={() => void close()}
        localDisabled={
          transfer === "qr" && !native
            ? t(
                "fcboard.android_displays_support_qr_downloads_on_the_same_network_you_can_export_pages_here",
              )
            : undefined
        }
        onLocal={(signal) =>
          transfer === "qr"
            ? share("qr", undefined, signal)
            : exportEditable(undefined, signal)
        }
        onCloud={(config, signal) =>
          transfer === "qr"
            ? share("qr", config, signal)
            : exportEditable(config, signal)
        }
      />
    );
  }
  const qr = urls[0];
  return (
    <MaterialPanel
      centered
      onDismiss={() => void close()}
      ref={panel}
      className={`fc-share-dialog fc-surface${
        qr
          ? " fc-share-qr-dialog"
          : !choosing && mail && native
          ? " fc-share-mail-dialog"
          : !choosing && !mail
          ? " fc-share-dialog--formats"
          : ""
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
      {!(mail && !choosing && native) && (
        <header>
          <strong>
            {qr
              ? t("fcboard.qr_share")
              : choosing
              ? t("fcboard.select_pages")
              : mail
              ? t("fcboard.mail_sent")
              : savingFile
              ? t("buttons.save")
              : t("fcboard.share_board")}
          </strong>
          <button
            aria-label={t("fcboard.close_sharing")}
            onClick={() => void close()}
          >
            {CloseIcon}
          </button>
        </header>
      )}
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
                <BoardThumbnail board={page} canvasSize={canvasSize} />
                <span>{t("fcboard.page_page", { page: index + 1 })}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {!choosing && mail && native && (
        <MailComposer
          onClose={() => void close()}
          onSent={(warning) => {
            void close().then(() =>
              setMailResult({
                id: crypto.randomUUID(),
                message: warning
                  ? t("fcboard.mailbox.sent_copy_failed", { error: warning })
                  : t("fcboard.mailbox.sent"),
              }),
            );
          }}
          preparePages={async (signal) => {
            const images: string[] = [];
            for (const board of pages.filter((page) =>
              selected.includes(page.id),
            )) {
              signal.throwIfAborted();
              const blob = await exportToBlob({
                ...boardPageExportOptions(board, canvasSize),
                mimeType: "image/png",
              });
              signal.throwIfAborted();
              images.push(await getDataURL(blob));
            }
            return images;
          }}
        />
      )}
      {!choosing && !mail && !qr && (
        <div className="fc-share-formats">
          <button
            type="button"
            disabled={busy || !selected.length}
            onClick={() => setTransfer("bzd")}
          >
            <img src={documentIcon} alt="" />
            <span>BZD</span>
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
      {!qr && <TransientMessage message={status} />}
      {qr && <ShareQRCode key={qr} url={qr} protection={protection} />}
      {!qr && (
        <footer>
          {choosing ? (
            <>
              <button type="button" onClick={() => void close()}>
                {t("buttons.cancel")}
              </button>
              <button
                type="button"
                disabled={busy || !selected.length}
                onClick={() => {
                  setChoosing(false);
                  if (!mail && !savingFile) {
                    setTransfer("qr");
                  }
                }}
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
              {mail && !native && (
                <button
                  disabled={busy || !selected.length}
                  onClick={() => void share("mail")}
                >
                  {t("fcboard.open_email_share_window")}
                </button>
              )}
              {!mail && (
                <button
                  disabled={busy || !selected.length}
                  onClick={() => setTransfer("qr")}
                >
                  {t("fcboard.generate_sharing_qr_code")}
                </button>
              )}
              {mail && !native && (
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
      )}
    </MaterialPanel>
  );
};
