import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useFcboardAPI } from "@fcboard/fcboard";
import { ResourceWindow } from "@fcboard/fcboard/components/ResourceWindow";
import { CloseIcon } from "@fcboard/fcboard/components/icons";
import { t } from "@fcboard/fcboard/i18n";

import type { InteractiveResourceFrameProps } from "@fcboard/fcboard/components/InteractiveResourceFrame";

import { classroomCommands } from "./commands";

import {
  documentSource,
  documentWindowReady,
  focusDocument,
  focusedDocument,
  watchDocumentFocus,
} from "./documentWindows";

import type { DocumentInput } from "./documentInput";
import type { ReactNode } from "react";

const FilePreview = lazy(() =>
  import("./FilePreview").then((module) => ({ default: module.FilePreview })),
);

export const DocumentObject = ({
  resource,
  objectId,
  window,
}: InteractiveResourceFrameProps) => {
  const api = useFcboardAPI();
  const active = useSyncExternalStore(watchDocumentFocus, focusedDocument);
  const [file, setFile] = useState<DocumentInput>();
  const [error, setError] = useState("");
  const key = resource.document!.key;
  const root = useRef<HTMLDivElement>(null);
  const windowRef = useRef(window);
  windowRef.current = window;
  const close = useCallback(
    (advance = true, signal?: AbortSignal) => {
      if (focusedDocument() === objectId) {
        focusDocument();
      }
      documentWindowReady(key, t("fcboard.no_document_is_open"));
      windowRef.current?.onClose();
      if (classroomCommands.has("document.window.closed")) {
        void classroomCommands
          .execute({
            name: "document.window.closed",
            args: { id: objectId, advance, signal },
          })
          .catch(() => {});
      }
    },
    [key, objectId],
  );
  const report = useCallback(
    (failure?: string) => documentWindowReady(key, failure),
    [key],
  );
  useEffect(() => {
    let mounted = true;
    void documentSource(key)
      .then((source) => {
        if (!source) {
          throw new Error(t("fcboard.no_document_is_open"));
        }
        if (mounted) {
          setFile(source);
        }
      })
      .catch((failure: unknown) => {
        const message =
          failure instanceof Error ? failure.message : String(failure);
        if (mounted) {
          setError(message);
          documentWindowReady(key, message);
        }
      });
    return () => {
      mounted = false;
    };
  }, [key]);
  useEffect(() => {
    const node = root.current;
    return () => {
      queueMicrotask(() => {
        if (node && !node.isConnected && focusedDocument() === objectId) {
          focusDocument();
        }
      });
    };
  }, [objectId]);
  if (!api || !window) {
    return null;
  }
  const pending = (
    message: string,
    role: "alert" | "status",
    drag: ReactNode,
  ) => (
    <section className="fc-document-window-view">
      <div className="fc-document-object-status" role={role}>
        {message}
      </div>
      <footer className="fc-document-toolbar">
        <button
          type="button"
          aria-label={t("fcboard.close_document")}
          onClick={() => close()}
        >
          {CloseIcon}
        </button>
        {drag}
      </footer>
    </section>
  );
  return (
    <div
      ref={root}
      className="fc-document-object"
      onPointerDownCapture={() => focusDocument(objectId)}
      onFocus={() => focusDocument(objectId)}
    >
      <ResourceWindow
        {...window}
        title={resource.title}
        onClose={close}
        dragIcon={
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M12 3v18M3 12h18m-12-6 3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3" />
          </svg>
        }
      >
        {(drag) =>
          error ? (
            pending(error, "alert", drag)
          ) : file ? (
            <Suspense
              fallback={pending(t("fcboard.processing"), "status", drag)}
            >
              <FilePreview
                api={api}
                file={file}
                objectId={objectId}
                active={active === objectId}
                dragHandle={drag}
                onReady={report}
                onClose={close}
              />
            </Suspense>
          ) : (
            pending(t("fcboard.processing"), "status", drag)
          )
        }
      </ResourceWindow>
    </div>
  );
};
