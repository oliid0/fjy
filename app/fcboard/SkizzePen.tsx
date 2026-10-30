import { Capacitor } from "@capacitor/core";
import { useEffect, useRef, useState } from "react";
import { exportToCanvas } from "@fcboard/fcboard";
import { t } from "@fcboard/fcboard/i18n";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { SkizzePen as nativePen } from "./skizze";
import { classroomCommands } from "./commands";
import { boardCanvasSize, boardPageExportOptions } from "./boardExport";
import { TransientMessage } from "./TransientMessage";
import pointerArrow from "./factory-skizze-icons/pointer-arrow.png";
import white from "./factory-skizze-icons/ffffff.svg?url";
import red from "./factory-skizze-icons/ff0000.svg?url";
import green from "./factory-skizze-icons/00ff00.svg?url";
import yellow from "./factory-skizze-icons/ffff00.svg?url";
import black from "./factory-skizze-icons/000000.svg?url";

import "./SkizzePen.scss";

import type { SkizzeInput } from "./skizze";
import type { CSSProperties } from "react";

const modes = ["laser", "mouse", "spotlight", "magnifier"] as const;
type Mode = typeof modes[number];
const colors = ["#ffffff", "#ff0000", "#00ff00", "#ffff00", "#000000"];
const icons = [white, red, green, yellow, black];

/** SkizzePenLayer / ColorView / View. Pointer movement redraws canvas, not the React tree. */
export const SkizzePen = ({ api }: { api: FcboardImperativeAPI }) => {
  const native = Capacitor.isNativePlatform();
  const overlay = useRef<HTMLCanvasElement>(null);
  const [palette, setPalette] = useState<number>();
  const [unit, setUnit] = useState(1);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!native) {
      return;
    }
    let active = true;
    let connected = false;
    let battery: number | undefined;
    let mode: Mode = "laser";
    let modeIndex = 0;
    let colorIndex = 0;
    let visible = false;
    let point = [innerWidth / 2, innerHeight / 2];
    const radii = { laser: 20, spotlight: 170, magnifier: 130 };
    let hideTimer: ReturnType<typeof setTimeout>;
    let paletteTimer: ReturnType<typeof setTimeout>;
    let animation: number | undefined;
    let generation = 0;
    let receivedState = false;
    let captureFailed = false;
    let image:
      | {
          canvas: HTMLCanvasElement;
          x: number;
          y: number;
          width: number;
          height: number;
        }
      | undefined;
    const mouse = new Image();
    mouse.src = pointerArrow;
    const changed = () => classroomCommands.changed("skizze");
    const fail = (failure: unknown) => {
      if (active) {
        setError(`${t("fcboard.smart_pen_error")}: ${String(failure)}`);
      }
    };
    const draw = () => {
      animation = undefined;
      const canvas = overlay.current;
      if (!canvas || !active) {
        return;
      }
      if (!connected) {
        canvas.width = 0;
        canvas.height = 0;
        return;
      }
      const ratio = devicePixelRatio || 1;
      const width = Math.round(innerWidth * ratio);
      const height = Math.round(innerHeight * ratio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }
      ctx.clearRect(0, 0, width, height);
      if (!visible) {
        return;
      }
      const [x, y] = point.map((value) => value * ratio);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#000000";
      const circle = (radius: number) => {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
      };
      if (mode === "mouse") {
        if (mouse.complete && mouse.naturalWidth) {
          ctx.drawImage(mouse, x, y);
        }
      } else if (mode === "spotlight") {
        ctx.fillStyle = `rgba(0,0,0,${144 / 255})`;
        ctx.fillRect(0, 0, width, height);
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        circle(radii.spotlight);
        ctx.fill();
        ctx.restore();
      } else if (mode === "magnifier") {
        if (image) {
          const snapshot = image;
          const paint = () =>
            ctx.drawImage(
              snapshot.canvas,
              snapshot.x * ratio,
              snapshot.y * ratio,
              snapshot.width * ratio,
              snapshot.height * ratio,
            );
          paint();
          circle(radii.magnifier + 2);
          ctx.stroke();
          ctx.save();
          circle(radii.magnifier);
          ctx.clip();
          ctx.translate(x, y);
          ctx.scale(2, 2);
          ctx.translate(-x, -y);
          paint();
          ctx.restore();
        }
      } else {
        circle(radii.laser);
        ctx.fillStyle = "#ff0000";
        ctx.fill();
        ctx.stroke();
      }
    };
    const redraw = () => {
      if (active && animation === undefined) {
        animation = requestAnimationFrame(draw);
      }
    };
    mouse.onload = redraw;
    const hide = () => {
      clearTimeout(hideTimer);
      generation++;
      image = undefined;
      if (visible) {
        visible = false;
        changed();
      }
      redraw();
    };
    const capture = async () => {
      const current = ++generation;
      const state = api.getAppState();
      const size = boardCanvasSize(state);
      try {
        const canvas = await exportToCanvas(
          boardPageExportOptions(
            {
              elements: api.getSceneElements(),
              files: api.getFiles(),
              view: state,
            },
            size,
          ),
        );
        if (
          !active ||
          !connected ||
          !visible ||
          mode !== "magnifier" ||
          generation !== current
        ) {
          return;
        }
        image = {
          canvas,
          x: state.offsetLeft,
          y: state.offsetTop,
          width: size.width,
          height: size.height,
        };
        redraw();
      } catch (failure) {
        if (current === generation && active) {
          captureFailed = true;
          hide();
          fail(failure);
        }
      }
    };
    const show = (duration: number) => {
      if (mode === "magnifier" && captureFailed) {
        return;
      }
      clearTimeout(hideTimer);
      const fresh = !visible;
      visible = true;
      if (fresh) {
        changed();
        if (mode === "magnifier") {
          void capture();
        }
      }
      hideTimer = setTimeout(hide, duration);
      redraw();
    };
    const setMode = (next: Mode) => {
      generation++;
      captureFailed = false;
      image = undefined;
      mode = next;
      if (visible && next === "magnifier") {
        void capture();
      }
      show(3000);
      changed();
    };
    const resize = (key: "PageUp" | "PageDown") => {
      if (!connected || !visible) {
        return false;
      }
      const direction = key === "PageUp" ? 1 : -1;
      if (mode === "laser") {
        radii.laser = Math.max(20, Math.min(60, radii.laser + 10 * direction));
      }
      if (mode === "spotlight") {
        radii.spotlight = Math.max(
          260,
          Math.min(420, radii.spotlight + 40 * direction),
        );
      }
      if (mode === "magnifier" && image) {
        radii.magnifier = Math.max(
          180,
          Math.min(340, radii.magnifier + 40 * direction),
        );
      }
      show(2000);
      changed();
      return true;
    };
    const reset = () => {
      hide();
      clearTimeout(paletteTimer);
      setPalette(undefined);
      mode = "laser";
      captureFailed = false;
      modeIndex = 0;
      colorIndex = 0;
      radii.laser = 20;
      radii.spotlight = 170;
      radii.magnifier = 130;
      point = [innerWidth / 2, innerHeight / 2];
    };
    const input = (event: SkizzeInput) => {
      if (!active) {
        return;
      }
      if (event.kind === "state") {
        receivedState = true;
        if (connected !== event.connected) {
          reset();
        }
        connected = event.connected;
        battery = event.battery;
        if (event.error) {
          fail(event.error);
        }
        changed();
        redraw();
      } else if (connected) {
        if (event.kind === "color") {
          const selected = colorIndex;
          colorIndex = (colorIndex + 1) % colors.length;
          // Hardware palette changes the next pen color, never recolors selected objects.
          api.updateScene({
            appState: { currentItemStrokeColor: colors[selected] },
          });
          setPalette(selected);
          clearTimeout(paletteTimer);
          paletteTimer = setTimeout(() => setPalette(undefined), 3000);
          changed();
        } else if (event.kind === "mode") {
          setMode(modes[modeIndex]);
          modeIndex = (modeIndex + 1) % modes.length;
        } else {
          const key = event.kind === "next" ? "PageDown" : "PageUp";
          const target =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : window;
          target.dispatchEvent(
            new KeyboardEvent("keydown", {
              key,
              bubbles: true,
              cancelable: true,
            }),
          );
        }
      }
    };
    const hover = (event: PointerEvent) => {
      if (
        connected &&
        event.buttons === 0 &&
        ["pen", "mouse"].includes(event.pointerType)
      ) {
        point = [event.clientX, event.clientY];
        show(200);
      }
    };
    const resized = () => {
      setUnit(
        Math.min(
          1 / (devicePixelRatio || 1),
          Math.max(1, innerWidth - 24) / 740,
        ),
      );
      hide();
    };
    const hidden = () => {
      if (document.hidden) {
        hide();
      }
    };
    const stops = [
      classroomCommands.context("skizze", () => ({
        connected,
        battery,
        mode,
        visible,
        color: api.getAppState().currentItemStrokeColor,
        radii: { ...radii },
      })),
      classroomCommands.register("skizze.resize", "@internal", (args) => {
        if (args.key !== "PageUp" && args.key !== "PageDown") {
          throw new Error(t("fcboard.smart_pen_error"));
        }
        return resize(args.key);
      }),
      classroomCommands.register(
        "skizze.mode",
        "设置已连接智能笔悬浮层，args.mode=laser|mouse|spotlight|magnifier，args.visible=false 收起",
        (args) => {
          if (!connected) {
            throw new Error(t("fcboard.smart_pen_error"));
          }
          if (args.visible === false) {
            hide();
            return;
          }
          const next = modes.find((value) => value === args.mode);
          if (!next) {
            throw new Error(t("fcboard.smart_pen_error"));
          }
          setMode(next);
        },
      ),
    ];
    resized();
    window.addEventListener("pointermove", hover, true);
    window.addEventListener("pointerdown", hide, true);
    window.addEventListener("resize", resized);
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", hidden);
    const listener = nativePen.addListener("input", input);
    void listener
      .then(async () => {
        if (!active) {
          return;
        }
        const state = await nativePen.connect();
        if (!receivedState) {
          input(state);
        }
      })
      .catch(fail);
    return () => {
      active = false;
      generation++;
      clearTimeout(hideTimer);
      clearTimeout(paletteTimer);
      if (animation !== undefined) {
        cancelAnimationFrame(animation);
      }
      mouse.onload = null;
      image = undefined;
      window.removeEventListener("pointermove", hover, true);
      window.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("resize", resized);
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", hidden);
      stops.forEach((stop) => stop());
      void listener.then((handle) => handle.remove()).catch(() => {});
    };
  }, [api, native]);
  if (!native) {
    return null;
  }
  return (
    <>
      <canvas ref={overlay} className="fc-skizze-overlay" aria-hidden="true" />
      {palette !== undefined && (
        <div
          className="fc-skizze-colors"
          aria-hidden="true"
          style={{ "--skizze-pixel": `${unit}px` } as CSSProperties}
        >
          {icons.map((icon, index) => (
            <img
              key={icon}
              src={icon}
              alt=""
              className={index === palette ? "selected" : undefined}
            />
          ))}
        </div>
      )}
      {error && (
        <TransientMessage
          message={error}
          role="alert"
          className="fc-notice fc-error"
        />
      )}
    </>
  );
};
