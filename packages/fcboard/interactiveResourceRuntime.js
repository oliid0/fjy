/* Runs only inside the opaque-origin lesson iframe. No host command access. */
(() => {
  const version = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ids = new WeakMap();
  let nextId = 0;
  const text = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
  const visible = (node) => {
    for (let current = node; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (
        current.hidden ||
        style.display === "none" ||
        style.visibility === "hidden"
      ) {
        return false;
      }
    }
    return node.isConnected;
  };
  const graphic = (node) =>
    node instanceof SVGElement || node.tagName === "CANVAS";
  const controls = () =>
    Array.from(
      document.querySelectorAll(
        "input,select,button,canvas,svg,svg g,svg rect,svg circle,svg ellipse,svg path,svg line,svg polyline,svg polygon,svg text,svg image,svg use",
      ),
    ).filter(
      (node) =>
        visible(node) &&
        !node.closest("defs,clipPath,mask,marker,pattern,symbol") &&
        (node.tagName !== "INPUT" ||
          [
            "range",
            "number",
            "text",
            "checkbox",
            "radio",
            "color",
            "button",
            "reset",
          ].includes(node.type)),
    );
  const id = (node) => {
    if (!ids.has(node)) {
      ids.set(node, `c${++nextId}`);
    }
    return ids.get(node);
  };
  const disabled = (node) =>
    node.matches(":disabled") ||
    node.closest("[inert],[aria-disabled='true']") !== null ||
    (graphic(node) && getComputedStyle(node).pointerEvents === "none") ||
    (["text", "number"].includes(node.type) && node.readOnly === true);
  const viewport = () => ({
    width: document.documentElement.clientWidth || innerWidth,
    height: document.documentElement.clientHeight || innerHeight,
  });
  const bounds = (node) => {
    const box = node.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  };
  const state = (offset = 0) => {
    const nodes = controls();
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 50000 ||
      (offset !== 0 && offset >= nodes.length)
    ) {
      throw new Error("RESOURCE_INVALID_OFFSET");
    }
    const outputs = Array.from(
      document.querySelectorAll("output,[role='status'],[aria-live]"),
    )
      .filter(visible)
      .map((node) => text(node.textContent))
      .filter(Boolean);
    return {
      version,
      title: text(
        document.querySelector("h1")?.textContent || document.title,
      ).slice(0, 160),
      viewport: viewport(),
      offset,
      total: nodes.length,
      controls: nodes.slice(offset, offset + 80).map((node) => ({
        id: id(node),
        label: text(
          node.getAttribute("aria-label") ||
            node.querySelector("title")?.textContent ||
            Array.from(node.labels || [])
              .map((label) => label.textContent)
              .join(" ") ||
            node.textContent ||
            node.name ||
            node.id,
        ),
        type: graphic(node)
          ? "graphic"
          : node.tagName === "SELECT"
          ? "select"
          : node.tagName === "BUTTON"
          ? "button"
          : node.type,
        disabled: disabled(node),
        value: graphic(node)
          ? ""
          : ["checkbox", "radio"].includes(node.type)
          ? node.checked
          : node.value.slice(0, 500),
        ...(graphic(node)
          ? {
              kind: node.localName,
              role: text(node.getAttribute("role")),
              bounds: bounds(node),
            }
          : {}),
        ...(node.tagName === "INPUT"
          ? { min: node.min, max: node.max, step: node.step }
          : {}),
        ...(node.tagName === "SELECT"
          ? {
              options: Array.from(node.options)
                .slice(0, 80)
                .map((option) => ({
                  value: option.value.slice(0, 500),
                  label: text(option.label),
                  disabled:
                    option.disabled || option.parentElement?.disabled === true,
                })),
            }
          : {}),
      })),
      outputs: outputs.slice(0, 32),
      truncated:
        offset > 0 || nodes.length > offset + 80 || outputs.length > 32,
    };
  };
  const point = (value, box, inside) => {
    const candidate = value || {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    };
    const size = viewport();
    if (
      !Number.isFinite(candidate.x) ||
      !Number.isFinite(candidate.y) ||
      candidate.x < 0 ||
      candidate.y < 0 ||
      candidate.x > size.width ||
      candidate.y > size.height ||
      (inside &&
        ((box.width <= 0 && box.height <= 0) ||
          candidate.x < box.x - (box.width === 0 ? 3 : 0) ||
          candidate.y < box.y - (box.height === 0 ? 3 : 0) ||
          candidate.x > box.x + box.width + (box.width === 0 ? 3 : 0) ||
          candidate.y > box.y + box.height + (box.height === 0 ? 3 : 0)))
    ) {
      throw new Error("RESOURCE_INVALID_POINT");
    }
    return candidate;
  };
  const gesture = (node, request) => {
    const box = bounds(node);
    const start = point(request.from, box, true);
    const end = request.type === "drag" ? point(request.to, box, false) : start;
    const pointerId = 2147483001;
    let captured;
    const names = [
      "setPointerCapture",
      "releasePointerCapture",
      "hasPointerCapture",
    ];
    const descriptors = names.map((name) =>
      Object.getOwnPropertyDescriptor(Element.prototype, name),
    );
    // A synthetic PointerEvent has no browser-owned active pointer. Scope capture
    // to this gesture only; real input keeps the original browser implementation.
    names.forEach((name, index) => {
      const original = descriptors[index]?.value;
      Object.defineProperty(Element.prototype, name, {
        configurable: true,
        writable: true,
        value(id) {
          if (id !== pointerId) {
            return original?.call(this, id);
          }
          if (name === "setPointerCapture") {
            captured = this;
          } else if (name === "releasePointerCapture") {
            if (captured === this) {
              captured = undefined;
            }
          } else {
            return captured === this;
          }
        },
      });
    });
    const dispatch = (target, type, position, buttons) => {
      const init = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: position.x,
        clientY: position.y,
        button: 0,
        buttons,
        pointerId,
        pointerType: "mouse",
        isPrimary: true,
        pressure: buttons ? 0.5 : 0,
      };
      const event =
        type.startsWith("pointer") && typeof PointerEvent === "function"
          ? new PointerEvent(type, init)
          : new MouseEvent(type, init);
      if (type.startsWith("pointer") && !("pointerId" in event)) {
        for (const key of [
          "pointerId",
          "pointerType",
          "isPrimary",
          "pressure",
        ]) {
          Object.defineProperty(event, key, { value: init[key] });
        }
      }
      return target.dispatchEvent(event);
    };
    try {
      node.focus?.();
      const compatibilityMouse = dispatch(node, "pointerdown", start, 1);
      if (compatibilityMouse) {
        dispatch(node, "mousedown", start, 1);
      }
      if (request.type === "drag") {
        for (let step = 1; step <= 12; step++) {
          if (!node.isConnected || !visible(node)) {
            throw new Error("RESOURCE_CONTROL_UNAVAILABLE");
          }
          const position = {
            x: start.x + ((end.x - start.x) * step) / 12,
            y: start.y + ((end.y - start.y) * step) / 12,
          };
          const target =
            captured ||
            document.elementFromPoint?.(position.x, position.y) ||
            node;
          dispatch(target, "pointermove", position, 1);
          if (compatibilityMouse) {
            dispatch(target, "mousemove", position, 1);
          }
        }
      }
      const target =
        captured || document.elementFromPoint?.(end.x, end.y) || node;
      dispatch(target, "pointerup", end, 0);
      if (compatibilityMouse) {
        dispatch(target, "mouseup", end, 0);
      }
      if (request.type === "click") {
        dispatch(node, "click", start, 0);
      }
    } catch (error) {
      dispatch(captured || node, "pointercancel", end, 0);
      throw error;
    } finally {
      names.forEach((name, index) => {
        if (descriptors[index]) {
          Object.defineProperty(Element.prototype, name, descriptors[index]);
        } else {
          delete Element.prototype[name];
        }
      });
    }
  };
  const act = (request) => {
    if (request.type === "inspect") {
      const offset = request.offset ?? 0;
      if (
        !Number.isInteger(offset) ||
        offset < 0 ||
        offset > 50000 ||
        (offset !== 0 && offset >= controls().length)
      ) {
        throw new Error("RESOURCE_INVALID_OFFSET");
      }
      return offset;
    }
    if (
      !["set", "click", "drag"].includes(request.type) ||
      request.version !== version
    ) {
      throw new Error("RESOURCE_STALE_CONTROL");
    }
    const nodes = controls();
    // Only an inspected node has an id. Later pages remain available without
    // allowing guessed control names or arbitrary DOM selectors.
    const node = nodes.find((item) => ids.get(item) === request.control);
    if (!node || disabled(node)) {
      throw new Error("RESOURCE_CONTROL_UNAVAILABLE");
    }
    if (graphic(node)) {
      if (!["click", "drag"].includes(request.type)) {
        throw new Error("RESOURCE_CONTROL_NOT_SETTABLE");
      }
      if (request.type === "drag" && !request.to) {
        throw new Error("RESOURCE_INVALID_POINT");
      }
      gesture(node, request);
      return Math.floor(nodes.indexOf(node) / 80) * 80;
    }
    if (request.type === "drag") {
      throw new Error("RESOURCE_CONTROL_NOT_DRAGGABLE");
    }
    if (request.type === "click") {
      if (
        !(
          node.tagName === "BUTTON" ||
          ["button", "reset", "checkbox", "radio"].includes(node.type)
        )
      ) {
        throw new Error("RESOURCE_CONTROL_NOT_CLICKABLE");
      }
      node.click();
      return Math.floor(nodes.indexOf(node) / 80) * 80;
    }
    const value = request.value;
    if (["checkbox", "radio"].includes(node.type)) {
      if (typeof value !== "boolean") {
        throw new Error("RESOURCE_INVALID_VALUE");
      }
      if (node.type === "radio" && !value) {
        throw new Error("RESOURCE_INVALID_VALUE");
      }
      if (node.checked !== value) {
        node.click();
      }
      return Math.floor(nodes.indexOf(node) / 80) * 80;
    }
    if (typeof value !== "string" && typeof value !== "number") {
      throw new Error("RESOURCE_INVALID_VALUE");
    }
    const written = String(value);
    if (written.length > 500) {
      throw new Error("RESOURCE_INVALID_VALUE");
    }
    if (node.tagName === "SELECT") {
      if (
        node.multiple ||
        !Array.from(node.options).some(
          (option) =>
            option.value === written &&
            !option.disabled &&
            option.parentElement?.disabled !== true,
        )
      ) {
        throw new Error("RESOURCE_INVALID_VALUE");
      }
    } else if (
      node.tagName === "INPUT" &&
      ["range", "number", "text", "color"].includes(node.type)
    ) {
      const candidate = node.cloneNode();
      candidate.value = written;
      if (
        !candidate.checkValidity() ||
        (node.maxLength >= 0 && written.length > node.maxLength) ||
        (["number", "range"].includes(node.type)
          ? !written.trim() ||
            !Number.isFinite(Number(written)) ||
            Number(candidate.value) !== Number(written)
          : candidate.value !== written)
      ) {
        throw new Error("RESOURCE_INVALID_VALUE");
      }
    } else {
      throw new Error("RESOURCE_CONTROL_NOT_SETTABLE");
    }
    node.value = written;
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    return Math.floor(nodes.indexOf(node) / 80) * 80;
  };
  window.addEventListener("message", (event) => {
    if (
      event.source !== parent ||
      event.data?.type !== "fc-resource-control-v1" ||
      !event.ports[0]
    ) {
      return;
    }
    const port = event.ports[0];
    try {
      const offset = act(event.data.request);
      // Allow event handlers' microtasks to finish before reporting actual output.
      queueMicrotask(() => {
        try {
          const available = controls().length;
          port.postMessage({
            ok: true,
            state: state(
              event.data.request.type === "inspect"
                ? offset
                : Math.min(
                    offset,
                    Math.max(0, Math.floor((available - 1) / 80) * 80),
                  ),
            ),
          });
        } catch {
          port.postMessage({ ok: false, error: "RESOURCE_INVALID_STATE" });
        } finally {
          port.close();
        }
      });
    } catch (error) {
      port.postMessage({ ok: false, error: error.message });
      port.close();
    }
  });
})();
