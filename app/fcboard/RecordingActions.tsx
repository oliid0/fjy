import { useEffect, useRef, useState } from "react";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { Capacitor } from "@capacitor/core";
import { t } from "@fcboard/fcboard/i18n";

import { QRCode } from "../share/QRCode";

import { MaterialPanel } from "./MaterialPanel";
import { TransientMessage } from "./TransientMessage";
import {
  prepareRecordingPackage,
  recordingFiles,
  saveRecordingFiles,
} from "./recordingExport";

import type { Recording } from "./recording";

export const RecordingActions = ({ recording }: { recording: Recording }) => {
  const native = Capacitor.isNativePlatform();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [urls, setUrls] = useState<string[]>([]);
  const [downloadMenu, setDownloadMenu] = useState<HTMLElement | null>(null);
  const [downloads, setDownloads] = useState<{ name: string; url: string }[]>(
    [],
  );
  const pending = useRef<AbortController | undefined>(undefined);
  const prepared = useRef<
    Awaited<ReturnType<typeof prepareRecordingPackage>> | undefined
  >(undefined);
  useEffect(() => {
    setUrls([]);
    setDownloadMenu(null);
    const files = native
      ? []
      : recordingFiles(recording).map((file) => ({
          name: file.name,
          url: URL.createObjectURL(file),
        }));
    setDownloads(files);
    return () => {
      pending.current?.abort();
      const current = prepared.current;
      prepared.current = undefined;
      void current?.close().catch(() => {});
      files.forEach((file) => URL.revokeObjectURL(file.url));
    };
  }, [recording, native]);
  const closeShare = () => {
    setUrls([]);
    const current = prepared.current;
    prepared.current = undefined;
    void current?.close().catch(() => {});
  };
  useEffect(() => {
    if (!urls.length) {
      return;
    }
    const timer = setTimeout(closeShare, 600000);
    return () => clearTimeout(timer);
  }, [urls]);
  const run = async (share: boolean) => {
    if (pending.current) {
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      if (!native) {
        await saveRecordingFiles(recording);
        return;
      }
      const resource =
        prepared.current ||
        (await prepareRecordingPackage(recording, controller.signal));
      if (controller.signal.aborted) {
        await resource.close();
        controller.signal.throwIfAborted();
      }
      prepared.current = resource;
      if (share) {
        const result = await prepared.current.share();
        controller.signal.throwIfAborted();
        setUrls(result.urls);
      } else {
        await prepared.current.save();
      }
    } catch (failure) {
      if (
        !controller.signal.aborted &&
        (failure as Error).name !== "AbortError"
      ) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      if (pending.current === controller) {
        pending.current = undefined;
        setBusy(false);
      }
    }
  };
  const ready = !!recording.blob.size;
  return (
    <>
      <div className="fc-actions">
        <Button disabled={busy || !ready} onClick={() => void run(false)}>
          {t("buttons.saveAs")}
        </Button>
        {native && (
          <Button disabled={busy || !ready} onClick={() => void run(true)}>
            {t("fcboard.qr_share")}
          </Button>
        )}
        {busy && (
          <Button onClick={() => pending.current?.abort()}>
            {t("buttons.cancel")}
          </Button>
        )}
        {!!downloads.length && (
          <Button
            aria-haspopup="menu"
            aria-expanded={!!downloadMenu}
            onClick={(event) => setDownloadMenu(event.currentTarget)}
          >
            {t("buttons.export")}
          </Button>
        )}
      </div>
      <Menu
        anchorEl={downloadMenu}
        open={!!downloadMenu}
        onClose={() => setDownloadMenu(null)}
        disablePortal
        slotProps={{ paper: { sx: { maxWidth: "calc(100vw - 32px)" } } }}
      >
        {downloads.map((file) => (
          <MenuItem
            key={file.name}
            component="a"
            href={file.url}
            download={file.name}
            sx={{ whiteSpace: "normal", overflowWrap: "anywhere" }}
            onClick={() => setDownloadMenu(null)}
          >
            {file.name}
          </MenuItem>
        ))}
      </Menu>
      <TransientMessage message={error} role="alert" />
      {!!urls.length && (
        <MaterialPanel
          centered
          role="dialog"
          aria-label={t("fcboard.qr_share")}
          className="fc-recording-share fc-surface"
          onDismiss={closeShare}
        >
          <header>
            <strong>{t("fcboard.qr_share")}</strong>
            <Button onClick={closeShare}>{t("buttons.close")}</Button>
          </header>
          <div className="fc-recording-share-links">
            {urls.map((url) => (
              <div key={url}>
                <QRCode value={url} />
                <a href={url} target="_blank" rel="noreferrer">
                  {url}
                </a>
              </div>
            ))}
          </div>
        </MaterialPanel>
      )}
    </>
  );
};
