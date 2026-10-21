import { t, setLanguage, languages } from "@excalidraw/excalidraw/i18n";
import { TinyH264Decoder } from "@yume-chan/scrcpy-decoder-tinyh264";
import {
  ScrcpyOptions3_3_1,
  ScrcpyControlMessageWriter,
  AndroidKeyEventAction,
  AndroidKeyEventMeta,
  AndroidKeyCode,
  AndroidMotionEventAction,
} from "@yume-chan/scrcpy";
import { Consumable, ReadableStream } from "@yume-chan/stream-extra";

import type { TranslationKeys } from "@excalidraw/excalidraw/i18n";

import { getPreferredLanguage } from "../app-language/language-detector";

import { screenPoint } from "./remoteControl";
import "./remote.scss";

const applyLanguage = async () => {
  const language = languages.find(
    (item) => item.code === getPreferredLanguage(true),
  );
  if (language) {
    await setLanguage(language);
  }
  for (const node of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n as TranslationKeys);
  }
  for (const attribute of ["aria-label", "placeholder"]) {
    for (const node of document.querySelectorAll<HTMLElement>(
      `[data-i18n-${attribute}]`,
    )) {
      node.setAttribute(
        attribute,
        t(node.getAttribute(`data-i18n-${attribute}`) as TranslationKeys),
      );
    }
  }
};
void applyLanguage();
window.addEventListener("languagechange", () => {
  void applyLanguage();
});

const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const status = element("status");
const authorize = element<HTMLFormElement>("authorize");
const setup = element("setup");
const adb = element<HTMLFormElement>("adb");
const screen = element("screen");
const controls = element("controls");
const text = element<HTMLFormElement>("text");
const canvas = document.querySelector("canvas")!;
let token = sessionStorage.getItem("fcboard-device-session") || "";
let decoder: TinyH264Decoder | undefined;
let controller: ScrcpyControlMessageWriter | undefined;
let cleanup: (() => void) | undefined;
let ready = false;
const pointers = new Set<number>();
const pressedKeys = new Map<string, AndroidKeyCode>();
const report = (error: unknown) => {
  status.textContent = error instanceof Error ? error.message : String(error);
  status.setAttribute("role", "alert");
};
const api = async (path: string, body = {}) => {
  const response = await fetch(`/remote-api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Fcboard-Session": token },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (response.status === 403 && path !== "auth") {
    token = "";
    sessionStorage.removeItem("fcboard-device-session");
    authorized();
  }
  if (!response.ok || result.error) {
    throw new Error(result.error || t("fcboard.连接失败"));
  }
  return result;
};
const authorized = () => {
  authorize.hidden = !!token;
  adb.hidden = !token;
};
authorized();
const run = async (form: HTMLFormElement, operation: () => Promise<void>) => {
  const button = form.querySelector<HTMLButtonElement>("button")!;
  button.disabled = true;
  status.setAttribute("role", "status");
  try {
    await operation();
  } catch (error) {
    report(error);
  } finally {
    button.disabled = false;
  }
};
authorize.onsubmit = (event) => {
  event.preventDefault();
  void run(authorize, async () => {
    const result = await api("auth", {
      pin: new FormData(authorize).get("pin"),
    });
    token = result.token;
    sessionStorage.setItem("fcboard-device-session", token);
    authorize.reset();
    authorized();
    status.textContent = t("fcboard.已配对，请连接大屏无线调试");
  });
};
const connectVideo = () => {
  cleanup?.();
  const options = new ScrcpyOptions3_3_1({
    audio: false,
    sendDeviceMeta: false,
    sendDummyByte: false,
    clipboardAutosync: true,
  });
  decoder = new TinyH264Decoder({ canvas });
  const currentDecoder = decoder;
  const transport = new WebSocket(
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${
      location.host
    }/control/${token}`,
  );
  transport.binaryType = "arraybuffer";
  let disposed = false;
  let input: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      input = value;
    },
  });
  const writer = new Consumable.WritableStream<Uint8Array>({
    write(bytes) {
      if (transport.readyState !== WebSocket.OPEN) {
        throw new Error(t("fcboard.设备已断开"));
      }
      transport.send(new Uint8Array(bytes));
    },
  }).getWriter();
  controller = new ScrcpyControlMessageWriter(writer, options);
  const heartbeat = setInterval(() => {
    if (transport.readyState === WebSocket.OPEN) {
      transport.send("ping");
    }
  }, 10000);
  const waiting = setTimeout(() => {
    if (!ready && !disposed) {
      report(
        t("fcboard.没有收到可解码画面，请检查无线调试连接与大屏的屏幕捕获支持"),
      );
      cleanup?.();
    }
  }, 20000);
  transport.onmessage = (event) => {
    if (typeof event.data === "string") {
      if (event.data === "pong") {
        return;
      }
      try {
        const value = JSON.parse(event.data);
        if (value.error) {
          report(value.error);
        }
      } catch {
        report(t("fcboard.设备消息无效"));
      }
      return;
    }
    const bytes = new Uint8Array(event.data);
    if (bytes[0] === 0 && !disposed) {
      input.enqueue(bytes.subarray(1));
    }
  };
  transport.onclose = (event) => {
    if (!disposed) {
      cleanup?.();
      status.textContent = t("fcboard.连接已断开，可重新连接");
      if (event.reason === "设备控制已结束") {
        token = "";
        sessionStorage.removeItem("fcboard-device-session");
        authorized();
        status.textContent = t("fcboard.大屏已结束会话，请重新配对");
      }
    }
  };
  transport.onerror = () =>
    report(t("fcboard.无法连接设备，请检查局域网与大屏会话"));
  setup.hidden = true;
  screen.hidden = false;
  controls.hidden = false;
  status.textContent = t("fcboard.正在接收画面…");
  let frame = 0;
  const observeFrame = () => {
    if (disposed) {
      return;
    }
    if (currentDecoder.framesRendered > 0) {
      ready = true;
      clearTimeout(waiting);
      status.textContent = t("fcboard.已连接");
      canvas.focus();
    } else {
      frame = requestAnimationFrame(observeFrame);
    }
  };
  frame = requestAnimationFrame(observeFrame);
  void (async () => {
    const video = await options.parseVideoStreamMetadata(stream);
    await video.stream
      .pipeThrough(options.createMediaStreamTransformer())
      .pipeTo(currentDecoder.writable);
  })().catch((error) => {
    if (!disposed) {
      report(error);
      cleanup?.();
    }
  });
  cleanup = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    ready = false;
    pointers.clear();
    clearInterval(heartbeat);
    clearTimeout(waiting);
    cancelAnimationFrame(frame);
    try {
      input.close();
    } catch {
      /* The decoder may already have cancelled the stream. */
    }
    transport.close();
    currentDecoder.dispose();
    controller = undefined;
    setup.hidden = false;
    screen.hidden = true;
    controls.hidden = true;
    text.hidden = true;
  };
};
adb.onsubmit = (event) => {
  event.preventDefault();
  void run(adb, async () => {
    status.textContent = t("fcboard.正在连接无线调试…");
    const data = new FormData(adb);
    await api("connect", {
      port: Number(data.get("port")),
      pairPort: Number(data.get("pairPort")),
      code: String(data.get("code") || ""),
    });
    (adb.elements.namedItem("code") as HTMLInputElement).value = "";
    connectVideo();
  });
};
const attempt = (operation: Promise<unknown> | undefined) => {
  void operation?.catch(report);
};
const position = (event: PointerEvent | WheelEvent) =>
  screenPoint(
    event.clientX,
    event.clientY,
    canvas.getBoundingClientRect(),
    decoder!.width,
    decoder!.height,
  );
const touch = (
  event: PointerEvent,
  action: typeof AndroidMotionEventAction[keyof typeof AndroidMotionEventAction],
) => {
  if (!ready || !controller || !decoder?.width || !decoder?.height) {
    return;
  }
  event.preventDefault();
  attempt(
    controller.injectTouch({
      ...position(event),
      action,
      pointerId: event.pointerType === "mouse" ? -1n : BigInt(event.pointerId),
      pressure:
        action === AndroidMotionEventAction.Up ? 0 : event.pressure || 0.5,
      actionButton: 0,
      buttons: action === AndroidMotionEventAction.Up ? 0 : 1,
    }),
  );
};
canvas.onpointerdown = (event) => {
  if (!ready) {
    return;
  }
  pointers.add(event.pointerId);
  canvas.setPointerCapture(event.pointerId);
  canvas.focus();
  touch(event, AndroidMotionEventAction.Down);
};
canvas.onpointermove = (event) => {
  if (pointers.has(event.pointerId)) {
    touch(event, AndroidMotionEventAction.Move);
  }
};
canvas.onpointerup = (event) => {
  if (pointers.delete(event.pointerId)) {
    touch(event, AndroidMotionEventAction.Up);
  }
};
canvas.onpointercancel = canvas.onpointerup;
canvas.oncontextmenu = (event) => event.preventDefault();
canvas.addEventListener(
  "wheel",
  (event) => {
    if (!ready || !controller) {
      return;
    }
    event.preventDefault();
    attempt(
      controller.injectScroll({
        ...position(event),
        scrollX: Math.max(-1, Math.min(1, -event.deltaX / 100)),
        scrollY: Math.max(-1, Math.min(1, -event.deltaY / 100)),
        buttons: 0,
      }),
    );
  },
  { passive: false },
);
const key = async (keyCode: AndroidKeyCode) => {
  if (!ready || !controller) {
    return;
  }
  await controller.injectKeyCode({
    action: AndroidKeyEventAction.Down,
    keyCode,
    repeat: 0,
    metaState: 0,
  });
  await controller.injectKeyCode({
    action: AndroidKeyEventAction.Up,
    keyCode,
    repeat: 0,
    metaState: 0,
  });
};
document.querySelectorAll<HTMLButtonElement>("[data-key]").forEach((button) => {
  button.onclick = () =>
    attempt(key(Number(button.dataset.key) as AndroidKeyCode));
});
canvas.onkeydown = (event) => {
  if (!ready || !controller) {
    return;
  }
  const code = AndroidKeyCode[event.code as keyof typeof AndroidKeyCode];
  if (code !== undefined) {
    event.preventDefault();
    pressedKeys.set(event.code, code);
    attempt(
      controller.injectKeyCode({
        action: AndroidKeyEventAction.Down,
        keyCode: code,
        repeat: event.repeat ? 1 : 0,
        metaState: ((event.shiftKey ? AndroidKeyEventMeta.Shift : 0) |
          (event.ctrlKey ? AndroidKeyEventMeta.Ctrl : 0) |
          (event.altKey ? AndroidKeyEventMeta.Alt : 0) |
          (event.metaKey
            ? AndroidKeyEventMeta.Meta
            : 0)) as AndroidKeyEventMeta,
      }),
    );
  }
};
canvas.onkeyup = (event) => {
  const code = pressedKeys.get(event.code);
  if (code !== undefined && controller) {
    event.preventDefault();
    pressedKeys.delete(event.code);
    attempt(
      controller.injectKeyCode({
        action: AndroidKeyEventAction.Up,
        keyCode: code,
        repeat: 0,
        metaState: 0,
      }),
    );
  }
};
canvas.onblur = () => {
  for (const code of pressedKeys.values()) {
    attempt(
      controller?.injectKeyCode({
        action: AndroidKeyEventAction.Up,
        keyCode: code,
        repeat: 0,
        metaState: 0,
      }),
    );
  }
  pressedKeys.clear();
};
element("type").onclick = () => {
  text.hidden = !text.hidden;
  if (!text.hidden) {
    element<HTMLInputElement>("message").focus();
  }
};
text.onsubmit = (event) => {
  event.preventDefault();
  const input = element<HTMLInputElement>("message");
  if (!controller || !ready || !input.value) {
    return;
  }
  // Sequence zero needs no clipboard acknowledgement. UTF-8 clipboard paste supports Chinese.
  void run(text, async () => {
    await controller!.setClipboard({
      sequence: 0n,
      paste: true,
      content: input.value,
    });
    input.value = "";
  });
};
element("fullscreen").onclick = () => {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(report);
  } else if (document.documentElement.requestFullscreen) {
    void document.documentElement.requestFullscreen().catch(report);
  } else {
    report(t("fcboard.此浏览器不支持全屏，可横屏使用"));
  }
};
element("disconnect").onclick = () => {
  cleanup?.();
  void api("disconnect")
    .then(() => {
      status.textContent = t("fcboard.已断开");
    })
    .catch(report);
};
window.addEventListener("pagehide", () => cleanup?.());
