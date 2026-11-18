/* Trusted snapshot bootstrap, run only inside the existing opaque resource frame. */
(() => {
  const channel = document.currentScript
    .getAttribute("data-fc-library")
    .slice("quiz-snapshot:".length);
  let loaded = document.readyState !== "loading";
  let ready = false;
  let capturing = false;
  let finished = false;
  const send = (value) => {
    if (!finished) {
      finished = true;
      parent.postMessage({ type: "quiz-graphic", channel, ...value }, "*");
    }
  };
  const failed = (error) =>
    send({ error: String(error?.message || error).slice(0, 2000) });
  addEventListener("error", (event) => failed(event.error || event.message));
  addEventListener("unhandledrejection", (event) => failed(event.reason));
  // JSXGraph's default HTML labels do not belong to an exported SVG.
  if (window.JXG) {
    window.JXG.Options.text.display = "internal";
    window.JXG.Options.text.useMathJax = false;
  }
  const visible = (node) => {
    for (let current = node; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
    }
    return true;
  };
  const svgImage = (node, box, scale) =>
    new Promise((resolve, reject) => {
      if (
        [...node.querySelectorAll("foreignObject")].some(
          (element) =>
            visible(element) &&
            (element.children.length || element.textContent.trim()),
        )
      ) {
        reject(new Error("Figure labels must be drawn inside SVG/canvas"));
        return;
      }
      const copy = node.cloneNode(true);
      copy
        .querySelectorAll("script,foreignObject")
        .forEach((element) => element.remove());
      const originals = [node, ...node.querySelectorAll("*")].filter(
        (element) => !element.closest("script,foreignObject"),
      );
      const copies = [copy, ...copy.querySelectorAll("*")];
      if (originals.length !== copies.length) {
        reject(new Error("A figure cannot contain executable SVG scripts"));
        return;
      }
      const properties = [
        "fill",
        "fill-opacity",
        "fill-rule",
        "stroke",
        "stroke-width",
        "stroke-opacity",
        "stroke-linecap",
        "stroke-linejoin",
        "stroke-dasharray",
        "stroke-dashoffset",
        "opacity",
        "color",
        "font-family",
        "font-size",
        "font-style",
        "font-weight",
        "text-anchor",
        "dominant-baseline",
        "paint-order",
        "display",
        "visibility",
      ];
      originals.forEach((element, index) => {
        const style = getComputedStyle(element);
        for (const property of properties) {
          let value = style.getPropertyValue(property);
          if (value.startsWith("url(")) {
            const fragment = value.match(/#([^)'"\s]+)/)?.[1];
            if (fragment) {
              value = `url(#${fragment})`;
            }
          }
          if (value) {
            copies[index].style.setProperty(property, value);
          }
        }
      });
      const width = Math.max(1, Math.round(box.width * scale));
      const height = Math.max(1, Math.round(box.height * scale));
      copy.removeAttribute("xmlns");
      copy.setAttributeNS(
        "http://www.w3.org/2000/xmlns/",
        "xmlns",
        "http://www.w3.org/2000/svg",
      );
      if (!copy.hasAttribute("viewBox")) {
        const size = (attribute, fallback) => {
          const text = node.getAttribute(attribute) || "";
          return text.endsWith("%") ? fallback : parseFloat(text) || fallback;
        };
        copy.setAttribute(
          "viewBox",
          `0 0 ${size("width", box.width)} ${size("height", box.height)}`,
        );
      }
      copy.setAttribute("width", String(width));
      copy.setAttribute("height", String(height));
      copy.style.width = `${width}px`;
      copy.style.height = `${height}px`;
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () =>
        reject(new Error("The rendered figure could not be exported"));
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
        new XMLSerializer().serializeToString(copy),
      )}`;
    });
  const capture = async () => {
    if (!loaded || !ready || capturing || finished) {
      return;
    }
    capturing = true;
    let output;
    try {
      await document.fonts?.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      if (finished) {
        return;
      }
      const runtimeError = document.querySelector("[data-fc-runtime-error]");
      if (runtimeError) {
        throw new Error(runtimeError.textContent);
      }
      const outsideLabels = [...document.body.querySelectorAll("*")].find(
        (element) =>
          !element.closest("svg,canvas,script,style") &&
          visible(element) &&
          [...element.childNodes].some(
            (node) =>
              node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
          ),
      );
      if (outsideLabels) {
        throw new Error(
          `Figure labels must be drawn inside SVG/canvas: ${outsideLabels.textContent
            .trim()
            .slice(0, 200)}`,
        );
      }
      const graphics = [...document.querySelectorAll("svg,canvas")]
        .filter((node) => !node.parentElement.closest("svg") && visible(node))
        .map((node) => ({ node, box: node.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && box.height > 0);
      if (!graphics.length) {
        throw new Error("The figure did not draw any graphics");
      }
      const left = Math.min(...graphics.map(({ box }) => box.left));
      const top = Math.min(...graphics.map(({ box }) => box.top));
      const width = Math.max(...graphics.map(({ box }) => box.right)) - left;
      const height = Math.max(...graphics.map(({ box }) => box.bottom)) - top;
      if (
        ![width, height].every(
          (value) => Number.isFinite(value) && value > 0 && value <= 10000,
        )
      ) {
        throw new Error("The figure has invalid drawing bounds");
      }
      const scale = Math.min(2, 1440 / width, 920 / height);
      output = document.createElement("canvas");
      output.width = Math.max(1, Math.round(width * scale));
      output.height = Math.max(1, Math.round(height * scale));
      const context = output.getContext("2d", { willReadFrequently: true });
      if (!context) {
        throw new Error("Figure image export is unavailable");
      }
      context.fillStyle = "#fff";
      context.fillRect(0, 0, output.width, output.height);
      for (const { node, box } of graphics) {
        const image =
          node.localName === "canvas" ? node : await svgImage(node, box, scale);
        if (finished) {
          return;
        }
        context.drawImage(
          image,
          (box.left - left) * scale,
          (box.top - top) * scale,
          box.width * scale,
          box.height * scale,
        );
      }
      const pixels = context.getImageData(
        0,
        0,
        output.width,
        output.height,
      ).data;
      let visibleInk = false;
      for (let index = 0; index < pixels.length; index += 4) {
        if (
          Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) < 250
        ) {
          visibleInk = true;
          break;
        }
      }
      if (!visibleInk) {
        throw new Error("The exported figure is blank");
      }
      const blob = await new Promise((resolve, reject) => {
        output.toBlob((value) => {
          if (value) {
            resolve(value);
          } else {
            reject(new Error("The rendered figure could not be encoded"));
          }
        }, "image/png");
      });
      const dataURL = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      send({ dataURL });
    } catch (error) {
      failed(error);
    } finally {
      if (output) {
        output.width = output.height = 0;
      }
    }
  };
  const completed = () => {
    ready = true;
    void capture();
  };
  document.addEventListener("fc-figure-ready", completed, { once: true });
  document.addEventListener("fc-visualization-ready", completed, {
    once: true,
  });
  const mounted = () => {
    loaded = true;
    if (
      ![...document.scripts].some(
        (script) =>
          !script.hasAttribute("data-fc-library") &&
          !script.hasAttribute("data-fc-lesson-controls"),
      )
    ) {
      ready = true;
    }
    void capture();
  };
  if (loaded) {
    mounted();
  } else {
    document.addEventListener("DOMContentLoaded", mounted, { once: true });
  }
})();
