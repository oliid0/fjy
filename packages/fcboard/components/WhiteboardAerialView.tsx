import React from "react";
import ClickAwayListener from "@mui/material/ClickAwayListener";
import Popper from "@mui/material/Popper";
import Paper from "@mui/material/Paper";

import { getCommonBounds, newFrameElement } from "@fcboard/element";
import { exportToCanvas } from "@fcboard/utils/export";

import { t } from "../i18n";

import { useFcboardContainer } from "./App";
import { FactoryIcon } from "./FactoryIcon";
import { ToolButton } from "./ToolButton";

import type { AppClassProperties } from "../types";

/** x.apk MapLocationView: a real scene snapshot, draggable viewport and return. */
const AerialMap = ({ app }: { app: AppClassProperties }) => {
  const [initial] = React.useState(() => ({ ...app.state }));
  const [view, setView] = React.useState(() => ({ ...app.state }));
  const [image, setImage] = React.useState("");
  const [error, setError] = React.useState("");
  const [bounds] = React.useState(() => {
    const elements = app.scene.getNonDeletedElements();
    const content = elements.length ? getCommonBounds(elements) : undefined;
    const x = -initial.scrollX;
    const y = -initial.scrollY;
    const width = Math.max(1, initial.width) / initial.zoom.value;
    const height = Math.max(1, initial.height) / initial.zoom.value;
    // Preserve the screen aspect ratio while including every offscreen mark.
    const left = Math.min(x, content?.[0] ?? x);
    const top = Math.min(y, content?.[1] ?? y);
    const scale = Math.max(
      1,
      (Math.max(x + width, content?.[2] ?? x + width) - left) / width,
      (Math.max(y + height, content?.[3] ?? y + height) - top) / height,
    );
    return { x: left, y: top, width: width * scale, height: height * scale };
  });
  const drag = React.useRef<
    | {
        pointer: number;
        x: number;
        y: number;
        scrollX: number;
        scrollY: number;
      }
    | undefined
  >(undefined);
  React.useEffect(() => {
    let live = true;
    const elements = app.scene.getNonDeletedElements();
    const frame = newFrameElement(bounds);
    void exportToCanvas({
      elements,
      files: app.files,
      appState: {
        ...initial,
        exportBackground: true,
        exportWithDarkMode: false,
      },
      exportingFrame: frame,
      exportPadding: 0,
      maxWidthOrHeight: 600,
    })
      .then((canvas) => {
        if (live) {
          setImage(canvas.toDataURL("image/png"));
        }
      })
      .catch((failure) => {
        if (live) {
          setError(String(failure));
        }
      });
    const stop = app.api.onChange(() => setView({ ...app.state }));
    return () => {
      live = false;
      stop();
    };
  }, [app, bounds, initial]);
  const move = (scrollX: number, scrollY: number) => {
    app.api.updateScene({ appState: { scrollX, scrollY } });
  };
  const viewport = {
    x: ((-view.scrollX - bounds.x) / bounds.width) * 300,
    y: ((-view.scrollY - bounds.y) / bounds.width) * 300,
    width: (view.width / view.zoom.value / bounds.width) * 300,
    height: (view.height / view.zoom.value / bounds.width) * 300,
  };
  return (
    <>
      {error ? (
        <p role="alert">{error}</p>
      ) : !image ? (
        <p role="status">{t("labels.loadingScene")}</p>
      ) : null}
      <svg
        className="fc-aerial-map"
        viewBox={`0 0 300 ${(300 * bounds.height) / bounds.width}`}
        role="application"
        aria-label={t("fcboard.aerial_view")}
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          if (!rect.width || !rect.height) {
            return;
          }
          const x =
            bounds.x +
            ((event.clientX - rect.left) / rect.width) * bounds.width;
          const y =
            bounds.y +
            ((event.clientY - rect.top) / rect.height) * bounds.height;
          let scrollX = app.state.scrollX;
          let scrollY = app.state.scrollY;
          const width = app.state.width / app.state.zoom.value;
          const height = app.state.height / app.state.zoom.value;
          if (
            x < -scrollX ||
            x > -scrollX + width ||
            y < -scrollY ||
            y > -scrollY + height
          ) {
            scrollX = width / 2 - x;
            scrollY = height / 2 - y;
            move(scrollX, scrollY);
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            pointer: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            scrollX,
            scrollY,
          };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start || start.pointer !== event.pointerId) {
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          if (!rect.width || !rect.height) {
            return;
          }
          move(
            start.scrollX -
              ((event.clientX - start.x) / rect.width) * bounds.width,
            start.scrollY -
              ((event.clientY - start.y) / rect.height) * bounds.height,
          );
        }}
        onPointerUp={() => {
          drag.current = undefined;
        }}
        onPointerCancel={() => {
          drag.current = undefined;
        }}
        onKeyDown={(event) => {
          const direction = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
          }[event.key];
          if (direction) {
            event.preventDefault();
            move(
              view.scrollX - (direction[0] * view.width) / view.zoom.value / 10,
              view.scrollY -
                (direction[1] * view.height) / view.zoom.value / 10,
            );
          }
        }}
      >
        {image && (
          <image
            href={image}
            width="300"
            height={(300 * bounds.height) / bounds.width}
          />
        )}
        <path
          fill="#010101"
          fillOpacity="0.176"
          fillRule="evenodd"
          d={`M0,0H300V${(300 * bounds.height) / bounds.width}H0Z M${
            viewport.x
          },${viewport.y}h${viewport.width}v${
            viewport.height
          }h${-viewport.width}Z`}
        />
        <rect
          {...viewport}
          fill="none"
          stroke="#0368ff"
          strokeWidth="2"
          rx="8"
        />
      </svg>
      <button
        type="button"
        className="fc-aerial-return"
        onClick={() => move(initial.scrollX, initial.scrollY)}
      >
        <FactoryIcon name="backTo" />
        <span>{t("fcboard.aerial_return")}</span>
      </button>
    </>
  );
};

export const WhiteboardAerialView = ({ app }: { app: AppClassProperties }) => {
  const { container } = useFcboardContainer();
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [revision, setRevision] = React.useState(0);
  React.useEffect(() => {
    const close = () => setOpen(false);
    const stop = app.onPointerDownEmitter.on(close);
    const action = (event: Event) => {
      if (
        !(event as CustomEvent<HTMLElement>).detail.closest(
          '[data-toolbar-item="aerial"]',
        )
      ) {
        close();
      }
    };
    window.addEventListener("fcboard:toolbar-action", action);
    return () => {
      stop();
      window.removeEventListener("fcboard:toolbar-action", action);
    };
  }, [app]);
  return (
    <>
      <ToolButton
        type="button"
        data-menu-toggle
        icon={<FactoryIcon name="aerial" />}
        aria-label={t("fcboard.aerial_view")}
        showAriaLabel
        selected={open}
        onClick={(event) => {
          setAnchor(event.currentTarget as HTMLElement);
          setRevision((value) => value + 1);
          setOpen((visible) => !visible);
        }}
      />
      {open && (
        <ClickAwayListener
          onClickAway={(event) => {
            if (!anchor?.contains(event.target as Node)) {
              setOpen(false);
            }
          }}
        >
          <Popper
            open
            anchorEl={anchor}
            container={container}
            placement="top"
            sx={{ zIndex: 1300 }}
            modifiers={[
              { name: "offset", options: { offset: [0, 6.7] } },
              { name: "preventOverflow", options: { padding: 12 } },
            ]}
          >
            <Paper
              className="fc-aerial-view"
              role="dialog"
              aria-label={t("fcboard.aerial_view")}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setOpen(false);
                }
              }}
            >
              <AerialMap key={revision} app={app} />
            </Paper>
          </Popper>
        </ClickAwayListener>
      )}
    </>
  );
};
