/** Runs inside the opaque-origin graph iframe. Only bounded sampling/point
 * messages cross the frame; board input events stay inside this document. */
(() => {
  const root = document.getElementById("fc-vega");
  const id = root.dataset.functionResource;
  const output = document.querySelector("output");
  const fields = [...document.querySelectorAll("input[data-bound]")];
  const parameters = [...document.querySelectorAll("input[data-parameter]")];
  const parameterValues = () =>
    Object.fromEntries(
      parameters.map((field) => [field.dataset.parameter, Number(field.value)]),
    );
  const snapshot = () => JSON.stringify([domain(), parameterValues()]);
  let appliedParameters = JSON.stringify(parameterValues());
  let view;
  let pending = 0;
  let revision = 0;
  let timer;
  let saved;
  let restored;
  const domain = () => {
    const x = view.signal("xdom");
    const y = view.signal("ydom");
    return { left: x[0], right: x[1], bottom: y[0], top: y[1] };
  };
  const send = (type, extra = {}) => {
    if (view && type === "commit") {
      const next = snapshot();
      if (next === saved) {
        return;
      }
      saved = next;
    }
    if (view) {
      parent.postMessage(
        {
          channel: "fc-function-graph",
          id,
          type,
          request: revision,
          view: domain(),
          ...(type === "commit" ? { parameters: parameterValues() } : {}),
          ...extra,
        },
        "*",
      );
    }
  };
  const refresh = () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      pending = 0;
      revision++;
      const box = domain();
      fields.forEach((field) => {
        field.value = Number(box[field.dataset.bound].toPrecision(7));
      });
      send("sample");
    });
  };
  const commit = () => {
    clearTimeout(timer);
    timer = setTimeout(() => send("commit"), 180);
  };
  document.addEventListener(
    "fc-visualization-ready",
    (event) => {
      view = event.detail;
      if (restored) {
        view
          .signal("xdom", [restored.left, restored.right])
          .signal("ydom", [restored.bottom, restored.top])
          .run();
      }
      saved = snapshot();
      view.addSignalListener("xdom", refresh);
      view.addSignalListener("ydom", refresh);
      view.addSignalListener("clicked", (_name, point) => {
        if (point) {
          send("point", { point, width: view.width(), height: view.height() });
        }
      });
      refresh();
    },
    { once: true },
  );
  addEventListener("message", (event) => {
    const message = event.data;
    if (
      event.source !== parent ||
      !message ||
      message.channel !== "fc-function-graph" ||
      message.id !== id
    ) {
      return;
    }
    if (message.type === "restore") {
      const bounds = message.view;
      if (
        !bounds ||
        ![bounds.left, bounds.right, bounds.bottom, bounds.top].every(
          (value) => Number.isFinite(value) && Math.abs(value) <= 1e6,
        ) ||
        bounds.right - bounds.left < 0.0001 ||
        bounds.right - bounds.left > 2000 ||
        bounds.top - bounds.bottom < 0.0001 ||
        bounds.top - bounds.bottom > 2000
      ) {
        return;
      }
      restored = bounds;
      const previousParameters = appliedParameters;
      parameters.forEach((field) => {
        const value = message.parameters?.[field.dataset.parameter];
        if (Number.isFinite(value) && Math.abs(value) <= 1000) {
          field.min = Math.min(-10, value);
          field.max = Math.max(10, value);
          field.value = value;
        }
      });
      appliedParameters = JSON.stringify(parameterValues());
      if (
        view &&
        (JSON.stringify(domain()) !== JSON.stringify(bounds) ||
          previousParameters !== appliedParameters)
      ) {
        view
          .signal("xdom", [bounds.left, bounds.right])
          .signal("ydom", [bounds.bottom, bounds.top])
          .runAsync()
          .then(refresh)
          .catch((error) => {
            output.textContent = error.message;
          });
      }
      if (view) {
        saved = snapshot();
      }
      return;
    }
    if (message.request !== revision) {
      return;
    }
    if (message.error) {
      output.textContent = message.error;
      return;
    }
    if (message.type === "sample" && view) {
      view
        .change(
          "curves",
          window.vega
            .changeset()
            .remove(() => true)
            .insert(message.points),
        )
        .runAsync()
        .catch((error) => {
          output.textContent = error.message;
        });
    } else if (message.type === "point") {
      output.textContent = message.point
        ? `y = ${message.point.expression}   x=${Number(
            message.point.x.toPrecision(6),
          )}, y=${Number(message.point.y.toPrecision(6))}`
        : "";
    }
  });
  document.addEventListener("change", (event) => {
    if (view && event.target.matches("input[data-parameter]")) {
      commit();
      return;
    }
    if (!view || !event.target.matches("input[data-bound]")) {
      return;
    }
    const bounds = Object.fromEntries(
      fields.map((field) => [field.dataset.bound, Number(field.value)]),
    );
    if (
      !Object.values(bounds).every(
        (value) => Number.isFinite(value) && Math.abs(value) <= 1e6,
      ) ||
      bounds.right - bounds.left < 0.0001 ||
      bounds.right - bounds.left > 2000 ||
      bounds.top - bounds.bottom < 0.0001 ||
      bounds.top - bounds.bottom > 2000
    ) {
      event.target.setCustomValidity("Invalid coordinate range");
      event.target.reportValidity();
      return;
    }
    fields.forEach((field) => field.setCustomValidity(""));
    view
      .signal("xdom", [bounds.left, bounds.right])
      .signal("ydom", [bounds.bottom, bounds.top])
      .runAsync()
      .then(commit)
      .catch((error) => {
        output.textContent = error.message;
      });
  });
  document.addEventListener("pointerup", commit);
  document.addEventListener("touchend", commit);
  document.addEventListener("wheel", commit, { passive: true });
  addEventListener(
    "pagehide",
    () => {
      cancelAnimationFrame(pending);
      clearTimeout(timer);
    },
    { once: true },
  );
})();
