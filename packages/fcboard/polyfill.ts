const polyfill = () => {
  // Android WebView 95 has AbortController, but lacks reason/throwIfAborted
  // and timeout. Preserve DOM cancellation semantics before OCR/commands run.
  // https://dom.spec.whatwg.org/#interface-abortsignal
  if (typeof AbortSignal !== "undefined") {
    if (!("reason" in AbortSignal.prototype)) {
      const reasons = new WeakMap<AbortSignal, unknown>();
      const abort = AbortController.prototype.abort;
      Object.defineProperty(AbortSignal.prototype, "reason", {
        configurable: true,
        get(this: AbortSignal) {
          return this.aborted
            ? reasons.has(this)
              ? reasons.get(this)
              : new DOMException("Aborted", "AbortError")
            : undefined;
        },
      });
      AbortController.prototype.abort = function (reason?: unknown) {
        if (!this.signal.aborted) {
          reasons.set(
            this.signal,
            reason === undefined
              ? new DOMException("Aborted", "AbortError")
              : reason,
          );
        }
        abort.call(this);
      };
    }
    if (!AbortSignal.prototype.throwIfAborted) {
      Object.defineProperty(AbortSignal.prototype, "throwIfAborted", {
        configurable: true,
        writable: true,
        value(this: AbortSignal) {
          if (this.aborted) {
            throw this.reason;
          }
        },
      });
    }
    if (!AbortSignal.timeout) {
      Object.defineProperty(AbortSignal, "timeout", {
        configurable: true,
        writable: true,
        value(milliseconds: number) {
          if (
            !Number.isInteger(milliseconds) ||
            milliseconds < 0 ||
            milliseconds > 2147483647
          ) {
            throw new RangeError("Unsupported abort timeout");
          }
          const controller = new AbortController();
          setTimeout(
            () =>
              controller.abort(new DOMException("Timed out", "TimeoutError")),
            milliseconds,
          );
          return controller.signal;
        },
      });
    }
  }

  if (!Array.prototype.at) {
    // Taken from https://github.com/tc39/proposal-relative-indexing-method#polyfill so that it works in tests
    /* eslint-disable */
    Object.defineProperty(Array.prototype, "at", {
      value: function (n: number) {
        // ToInteger() abstract op
        n = Math.trunc(n) || 0;
        // Allow negative indexing from the end
        if (n < 0) {
          n += this.length;
        }
        // OOB access is guaranteed to return undefined
        if (n < 0 || n >= this.length) {
          return undefined;
        }
        // Otherwise, this is just normal property access
        return this[n];
      },
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }

  if (!Element.prototype.replaceChildren) {
    Element.prototype.replaceChildren = function (...nodes) {
      this.innerHTML = "";
      this.append(...nodes);
    };
  }
};
export default polyfill;
