import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { interactiveHtml } from "../interactiveHtml";
import { t } from "../i18n";
import { attachResourceControls } from "../interactiveResourceControls";

import { ResourceWindow } from "./ResourceWindow";

import type { InteractiveResource } from "../interactiveHtml";
import type { Ref } from "react";
import type { ResourceSurface } from "../interactiveResourceControls";
import type { ComponentProps } from "react";

export type ResourceLiveUpdate = {
  key: string;
  message: Record<string, unknown>;
};

export const InteractiveResourceFrame = ({
  resource,
  iframeRef,
  objectId,
  surface,
  window,
  live,
}: {
  resource: InteractiveResource;
  objectId: string;
  surface: ResourceSurface;
  iframeRef?: Ref<HTMLIFrameElement>;
  live?: ResourceLiveUpdate;
  window?: Omit<
    ComponentProps<typeof ResourceWindow>,
    "title" | "children" | "onReload"
  >;
}) => {
  const [revision, setRevision] = useState(0);
  const identity = live ? `${resource.id}:${live.key}` : resource;
  const [documentSnapshot, setDocumentSnapshot] = useState({
    identity,
    resource,
  });
  const loaded = useRef(false);
  if (documentSnapshot.identity !== identity) {
    loaded.current = false;
    setDocumentSnapshot({ identity, resource });
  }
  const documentResource =
    documentSnapshot.identity === identity
      ? documentSnapshot.resource
      : resource;
  const liveMessage = useRef(live?.message);
  liveMessage.current = live?.message;
  const liveSignature = JSON.stringify(live?.message);

  const [visualizationDocument, setVisualizationDocument] = useState<{
    source: InteractiveResource;
    html?: string;
    error?: string;
  }>();
  useEffect(() => {
    if (!documentResource.visualization) {
      return;
    }
    let active = true;
    void import("../visualizationHtml")
      .then(({ visualizationHtml }) => visualizationHtml(documentResource))
      .then(
        (html) => {
          if (active) {
            setVisualizationDocument({ source: documentResource, html });
          }
        },
        (error) => {
          if (active) {
            setVisualizationDocument({
              source: documentResource,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        },
      );
    return () => {
      active = false;
    };
  }, [documentResource, revision]);
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
      if (node && loaded.current) {
        controls.current?.loaded();
      }
    },
    [surface, objectId, resource.html],
  );
  const sendLive = useCallback(() => {
    if (liveMessage.current) {
      frame.current?.contentWindow?.postMessage(liveMessage.current, "*");
    }
  }, []);
  useEffect(sendLive, [sendLive, liveSignature, revision]);
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
  }, [iframeRef, resource.html, revision, visualizationDocument]);
  const html = useMemo(() => {
    try {
      return interactiveHtml(documentResource.html);
    } catch {
      return undefined;
    }
  }, [documentResource.html]);
  const visual =
    visualizationDocument?.source === documentResource
      ? visualizationDocument
      : undefined;
  const error =
    visual?.error ||
    (!html
      ? t("fcboard.the_generated_teaching_resource_is_invalid")
      : undefined);
  const content = error ? (
    <p role="alert">{error}</p>
  ) : (
    <iframe
      key={revision}
      ref={ref}
      onLoad={() => {
        loaded.current = true;
        controls.current?.loaded();
        sendLive();
      }}
      className="fcboard__embeddable"
      title={resource.title}
      data-resource-object-id={objectId}
      srcDoc={visual?.html || html}
      aria-busy={!!resource.visualization && !visual?.html}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
      style={{ width: "100%", height: "100%", border: 0, display: "block" }}
    />
  );
  return window ? (
    <ResourceWindow
      {...window}
      title={resource.title}
      embeddedHeader={resource.id === "builtin-calculator"}
      onReload={() => {
        loaded.current = false;
        setRevision((value) => value + 1);
      }}
    >
      {content}
    </ResourceWindow>
  ) : (
    content
  );
};
