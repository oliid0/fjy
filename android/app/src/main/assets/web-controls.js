/* Fixed DOM bridge for the native browser. Page content never receives app APIs. */
(() => {
  if (window.fcNativeWebControls) {
    return;
  }
  const session = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // HMinWebWindow imports the image/text under a long press. Search results
  // also use inline or blob images that cannot be fetched by the host app.
  window.fcNativeWebSelection = (x, y) => {
    try {
      const node = document.elementFromPoint(x, y);
      if (!node) {
        return "null";
      }
      const image =
        node.closest("img") ||
        node.querySelector("img") ||
        node.closest("a,button,[role=link]")?.querySelector("img") ||
        document.elementsFromPoint(x, y).find((item) => item.tagName === "IMG");
      if (image) {
        let value = image.currentSrc || image.src;
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        if (!width || !height) {
          throw Error("WEB_IMAGE_UNAVAILABLE");
        }
        // Drawing the displayed image preserves inline/blob pixels and avoids
        // a second request for same-origin or CORS-enabled images.
        if (!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(value)) {
          try {
            const canvas = document.createElement("canvas");
            // Match DEFAULT_MAX_IMAGE_WIDTH_OR_HEIGHT in the image importer.
            const scale = Math.min(1, 1440 / Math.max(width, height));
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            canvas
              .getContext("2d")
              .drawImage(image, 0, 0, canvas.width, canvas.height);
            value = canvas.toDataURL("image/png");
          } catch (error) {
            // Cross-origin images without CORS can still use native HTTP.
            if (!/^https?:\/\//i.test(value)) {
              throw error;
            }
          }
        }
        if (value.length > 28000000) {
          throw Error("WEB_IMAGE_TOO_LARGE");
        }
        const box = image.getBoundingClientRect();
        return JSON.stringify({
          kind: "image",
          value,
          bounds: { x: box.x, y: box.y, width: box.width, height: box.height },
        });
      }
      const value = (node.innerText || "").trim().slice(0, 10000);
      return value ? JSON.stringify({ kind: "text", value }) : "null";
    } catch (error) {
      return JSON.stringify({ error: "WEB_SELECTION_FAILED" });
    }
  };
  const ids = new WeakMap();
  let count = 0;
  let revision = 0;
  let previous = "";
  let offset = 0;
  const inspected = new Set();
  const text = (value, limit = 500) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit);
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
    const rect = node.getBoundingClientRect();
    return node.isConnected && rect.width > 0 && rect.height > 0;
  };
  const disabled = (node) =>
    node.matches(":disabled") ||
    !!node.closest("[inert],[aria-disabled='true']");
  const activate = (node) => {
    if (typeof node.click === "function") {
      node.click();
    } else {
      node.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    }
  };
  const safeText = (node) => {
    const clone = node.cloneNode(true);
    clone
      .querySelectorAll(
        "script,style,noscript,input,textarea,select,[contenteditable]",
      )
      .forEach((item) => item.remove());
    return clone.textContent;
  };
  const label = (node) =>
    text(
      node.getAttribute("aria-label") ||
        Array.from(node.labels || [])
          .map(safeText)
          .join(" ") ||
        (!["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName) &&
          safeText(node)) ||
        node.getAttribute("title") ||
        node.name ||
        node.id,
    );
  const sensitive = (node) =>
    node.type === "password" ||
    /password|passwd|api.?key|token|secret|密码|密钥/i.test(
      `${node.name || ""} ${node.id} ${node.autocomplete || ""} ${label(node)}`,
    );
  const controls = () =>
    Array.from(
      document.querySelectorAll(
        "button,input:not([type=hidden]),select,textarea,a[href],[role=button],[role=switch],[role=checkbox],[role=radio],[role=slider],[role=tab],[role=menuitem]",
      ),
    ).filter(visible);
  const id = (node) => {
    if (!ids.has(node)) {
      ids.set(node, `w${++count}`);
    }
    return ids.get(node);
  };
  const describe = (node) => {
    const rect = node.getBoundingClientRect();
    const item = {
      id: id(node),
      role: node.getAttribute("role") || node.tagName.toLowerCase(),
      type: node.type || undefined,
      label: label(node),
      disabled: disabled(node),
      readonly: !!node.readOnly,
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
    if (sensitive(node)) {
      item.sensitive = true;
      item.hasValue = !!node.value;
    } else if (node.type === "checkbox" || node.type === "radio") {
      item.checked = node.checked;
    } else if ("value" in node) {
      item.value = text(node.value, 4000);
    } else if (node.hasAttribute("aria-valuenow")) {
      item.value = node.getAttribute("aria-valuenow");
    }
    for (const field of ["min", "max", "step"]) {
      if (node.getAttribute(field) !== null) {
        item[field] = node.getAttribute(field);
      }
    }
    if (node.tagName === "SELECT") {
      item.options = Array.from(node.options)
        .slice(0, 100)
        .map((option) => ({
          value: option.value,
          label: text(option.label),
          disabled: option.disabled || option.parentElement?.disabled === true,
        }));
    }
    for (const field of ["aria-checked", "aria-selected", "aria-expanded"]) {
      if (node.hasAttribute(field)) {
        item[field.slice(5)] = node.getAttribute(field);
      }
    }
    return item;
  };
  const state = (expose = false) => {
    let visibleText = "";
    if (document.body) {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      while (walker.nextNode() && visibleText.length < 12000) {
        const node = walker.currentNode;
        const parent = node.parentElement;
        if (
          parent &&
          visible(parent) &&
          !parent.closest(
            "script,style,noscript,input,textarea,select,[contenteditable]",
          )
        ) {
          visibleText += ` ${text(node.textContent)}`;
        }
      }
    }
    const result = {
      url: location.href,
      title: text(document.title),
      text: text(visibleText, 12000),
      scroll: { x: scrollX, y: scrollY },
      controls: controls().map(describe),
    };
    const fingerprint = JSON.stringify(result);
    if (fingerprint !== previous) {
      previous = fingerprint;
      revision++;
    }
    const page = result.controls.slice(offset, offset + 100);
    if (expose) {
      page.forEach((control) => inspected.add(control.id));
    }
    return {
      version: `${session}:${revision}`,
      ...result,
      controls: page,
      total: result.controls.length,
      offset,
      truncated: offset + page.length < result.controls.length,
    };
  };
  window.fcNativeWebControls = (args) => {
    try {
      const action = args.action || "read";
      if (!["read", "click", "set", "key", "scroll"].includes(action)) {
        throw Error("WEB_ACTION_INVALID");
      }
      if (args.offset !== undefined) {
        if (!Number.isInteger(args.offset) || args.offset < 0) {
          throw Error("WEB_OFFSET_INVALID");
        }
        offset = args.offset;
      }
      const before = state();
      if (action === "read") {
        return JSON.stringify(state(true));
      }
      if (args.version !== before.version) {
        throw Error("WEB_STATE_CHANGED_READ_AGAIN");
      }
      if (action === "scroll") {
        const { x = 0, y = 0 } = args;
        if (
          typeof x !== "number" ||
          typeof y !== "number" ||
          !Number.isFinite(x + y) ||
          Math.abs(x) > 5000 ||
          Math.abs(y) > 5000
        ) {
          throw Error("WEB_SCROLL_INVALID");
        }
        window.scrollBy(x, y);
      } else {
        const node = controls().find((item) => id(item) === args.control);
        if (!node || !inspected.has(args.control) || disabled(node)) {
          throw Error("WEB_CONTROL_UNAVAILABLE");
        }
        if (action === "click") {
          activate(node);
        } else if (action === "key") {
          if (
            ![
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
              "Enter",
              " ",
              "Home",
              "End",
              "Escape",
              "Tab",
            ].includes(args.key)
          ) {
            throw Error("WEB_KEY_INVALID");
          }
          node.focus?.();
          node.dispatchEvent(
            new KeyboardEvent("keydown", { key: args.key, bubbles: true }),
          );
          node.dispatchEvent(
            new KeyboardEvent("keyup", { key: args.key, bubbles: true }),
          );
        } else {
          if (
            !["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName) ||
            node.readOnly ||
            node.type === "file"
          ) {
            throw Error("WEB_CONTROL_READONLY");
          }
          if (node.type === "checkbox" || node.type === "radio") {
            if (typeof args.value !== "boolean") {
              throw Error("WEB_VALUE_INVALID");
            }
            if (node.checked !== args.value) {
              if (node.type === "radio" && !args.value) {
                throw Error("WEB_RADIO_REQUIRES_SELECTION");
              }
              activate(node);
            }
          } else {
            if (
              typeof args.value !== "string" &&
              typeof args.value !== "number"
            ) {
              throw Error("WEB_VALUE_INVALID");
            }
            const value = String(args.value);
            if (value.length > 16000) {
              throw Error("WEB_VALUE_TOO_LONG");
            }
            if (
              node.tagName === "SELECT" &&
              !Array.from(node.options).some(
                (option) =>
                  option.value === value &&
                  !option.disabled &&
                  option.parentElement?.disabled !== true,
              )
            ) {
              throw Error("WEB_OPTION_UNAVAILABLE");
            }
            if (["range", "number"].includes(node.type)) {
              const numeric = Number(value);
              if (
                !value.trim() ||
                !Number.isFinite(numeric) ||
                (node.min !== "" && numeric < Number(node.min)) ||
                (node.max !== "" && numeric > Number(node.max))
              ) {
                throw Error("WEB_VALUE_OUT_OF_RANGE");
              }
              if (node.step && node.step !== "any") {
                const step = Number(node.step);
                const remainder = (numeric - Number(node.min || 0)) / step;
                if (
                  step > 0 &&
                  Math.abs(remainder - Math.round(remainder)) > 1e-6
                ) {
                  throw Error("WEB_VALUE_OFF_STEP");
                }
              }
            }
            const prototype =
              node.tagName === "TEXTAREA"
                ? HTMLTextAreaElement.prototype
                : node.tagName === "SELECT"
                ? HTMLSelectElement.prototype
                : HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(prototype, "value").set.call(
              node,
              value,
            );
            node.dispatchEvent(new Event("input", { bubbles: true }));
            node.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      }
      return JSON.stringify(state(true));
    } catch (error) {
      return JSON.stringify({ error: String(error.message || error) });
    }
  };
})();
