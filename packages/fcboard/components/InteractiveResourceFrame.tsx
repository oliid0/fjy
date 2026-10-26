import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

import { interactiveHtml } from "../interactiveHtml";
import { t } from "../i18n";
import { attachResourceControls } from "../interactiveResourceControls";

import type { InteractiveResource } from "../interactiveHtml";
import type { Ref } from "react";
import type { ResourceSurface } from "../interactiveResourceControls";

export const InteractiveResourceFrame = ({
  resource,
  iframeRef,
  objectId,
  surface,
}: {
  resource: InteractiveResource;
  objectId: string;
  surface: ResourceSurface;
  iframeRef?: Ref<HTMLIFrameElement>;
}) => {
  const controls = useRef<ReturnType<typeof attachResourceControls> | null>(
    null,
  );
  const frame = useRef<HTMLIFrameElement | null>(null);
  const ref = useCallback(
    (node: HTMLIFrameElement | null) => {
      frame.current = node;
      controls.current?.dispose();
      controls.current = node
        ? attachResourceControls(
            { surface, id: objectId, html: resource.html },
            node,
          )
        : null;
    },
    [surface, objectId, resource.html],
  );
  useLayoutEffect(() => {
    if (typeof iframeRef === "function") {
      iframeRef(frame.current);
    } else if (iframeRef) {
      iframeRef.current = frame.current;
    }
    return () => {
      if (typeof iframeRef === "function") {
        iframeRef(null);
      } else if (iframeRef) {
        iframeRef.current = null;
      }
    };
  }, [iframeRef, resource.html]);
  const html = useMemo(() => {
    try {
      return interactiveHtml(resource.html);
    } catch {
      return undefined;
    }
  }, [resource.html]);
  if (!html) {
    return (
      <p role="alert">
        {t("fcboard.the_generated_teaching_resource_is_invalid")}
      </p>
    );
  }
  return (
    <iframe
      ref={ref}
      onLoad={() => controls.current?.loaded()}
      className="excalidraw__embeddable"
      title={resource.title}
      srcDoc={html}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
      style={{ width: "100%", height: "100%", border: 0, display: "block" }}
    />
  );
};
