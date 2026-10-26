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
  const controls = () =>
    Array.from(document.querySelectorAll("input,select,button")).filter(
      (node) =>
        visible(node) &&
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
    (["text", "number"].includes(node.type) && node.readOnly === true);
  const state = () => {
    const nodes = controls();
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
      controls: nodes.slice(0, 80).map((node) => ({
        id: id(node),
        label: text(
          node.getAttribute("aria-label") ||
            Array.from(node.labels || [])
              .map((label) => label.textContent)
              .join(" ") ||
            node.textContent ||
            node.name ||
            node.id,
        ),
        type:
          node.tagName === "SELECT"
            ? "select"
            : node.tagName === "BUTTON"
            ? "button"
            : node.type,
        disabled: disabled(node),
        value: ["checkbox", "radio"].includes(node.type)
          ? node.checked
          : node.value.slice(0, 500),
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
      truncated: nodes.length > 80 || outputs.length > 32,
    };
  };
  const act = (request) => {
    if (request.type === "inspect") {
      return;
    }
    if (
      !["set", "click"].includes(request.type) ||
      request.version !== version
    ) {
      throw new Error("RESOURCE_STALE_CONTROL");
    }
    const node = controls()
      .slice(0, 80)
      .find((item) => id(item) === request.control);
    if (!node || disabled(node)) {
      throw new Error("RESOURCE_CONTROL_UNAVAILABLE");
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
      return;
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
      return;
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
      act(event.data.request);
      // Allow event handlers' microtasks to finish before reporting actual output.
      queueMicrotask(() => {
        try {
          port.postMessage({ ok: true, state: state() });
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
