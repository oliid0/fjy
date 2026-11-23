import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  calculatorResourceId,
  mediaResourceId,
  interactiveHtml,
  resourceNeedsRuntime,
} from "../interactiveHtml";
import { t } from "../i18n";
import { attachResourceControls } from "../interactiveResourceControls";

import { CalculatorPanel } from "./CalculatorPanel";
import { ResourceWindow } from "./ResourceWindow";

import type { InteractiveResource } from "../interactiveHtml";
import type { ComponentType, Ref } from "react";
import type { ResourceSurface } from "../interactiveResourceControls";
import type { ComponentProps } from "react";

export type InteractiveResourceFrameProps = {
  resource: InteractiveResource;
  objectId: string;
  surface: ResourceSurface;
  iframeRef?: Ref<HTMLIFrameElement>;
  live?: ResourceLiveUpdate;
  dark?: boolean;
  window?: Omit<
    ComponentProps<typeof ResourceWindow>,
    "title" | "children" | "onReload"
  >;
};

export type ResourceLiveUpdate = {
  key: string;
  message: Record<string, unknown>;
};

export const MediaRendererContext =
  createContext<ComponentType<InteractiveResourceFrameProps> | null>(null);

export const InteractiveResourceFrame = (
  props: InteractiveResourceFrameProps,
) => {
  const MediaRenderer = useContext(MediaRendererContext);
  if (props.resource.id === mediaResourceId) {
    return MediaRenderer && props.resource.media?.key ? (
      <MediaRenderer {...props} />
    ) : (
      <span>{props.resource.title}</span>
    );
  }
  return props.resource.id === calculatorResourceId ? (
    <CalculatorPanel
      target={{
        id: props.objectId,
        surface: props.surface,
        html: props.resource.html,
      }}
      dark={props.dark ?? false}
      window={props.window}
    />
  ) : (
    <SandboxedResourceFrame {...props} />
  );
};

const SandboxedResourceFrame = ({
  resource,
  iframeRef,
  objectId,
  surface,
  window,
  live,
}: InteractiveResourceFrameProps) => {
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

  const [preparedDocument, setPreparedDocument] = useState<{
    source: InteractiveResource;
    html?: string;
    error?: string;
  }>();
  useEffect(() => {
    if (!resourceNeedsRuntime(documentResource)) {
      return;
    }
    let active = true;
    void import("../resourceHtml")
      .then(({ resourceHtml }) => resourceHtml(documentResource))
      .then(
        (html) => {
          if (active) {
            setPreparedDocument({ source: documentResource, html });
          }
        },
        (error) => {
          if (active) {
            setPreparedDocument({
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
  }, [iframeRef, resource.html, revision, preparedDocument]);
  const html = useMemo(() => {
    try {
      const html = interactiveHtml(
        documentResource.html,
        documentResource.libraries,
      );
      if (!resourceNeedsRuntime(documentResource)) {
        return html;
      }
      const preview = new DOMParser().parseFromString(html, "text/html");
      preview.querySelectorAll("script").forEach((script) => script.remove());
      for (const element of preview.querySelectorAll("*")) {
        for (const attribute of [...element.attributes]) {
          if (/^on/i.test(attribute.name)) {
            element.removeAttribute(attribute.name);
          }
        }
      }
      preview.body.style.pointerEvents = "none";
      const status = preview.createElement("p");
      status.setAttribute("role", "status");
      status.style.cssText =
        "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);padding:12px 18px;background:#fff;color:#17243c;border-radius:12px";
      status.textContent = t("fcboard.resource_loading");
      preview.body.append(status);
      return `<!doctype html>${preview.documentElement.outerHTML}`;
    } catch {
      return undefined;
    }
  }, [documentResource]);
  const visual =
    preparedDocument?.source === documentResource
      ? preparedDocument
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
        if (resourceNeedsRuntime(documentResource) && !visual?.html) {
          return;
        }
        loaded.current = true;
        controls.current?.loaded();
        sendLive();
      }}
      className="fcboard__embeddable"
      title={resource.title}
      data-resource-object-id={objectId}
      data-resource-id={resource.id}
      srcDoc={visual?.html || html}
      aria-busy={resourceNeedsRuntime(documentResource) && !visual?.html}
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
      embeddedHeader={!!resource.visualization}
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
