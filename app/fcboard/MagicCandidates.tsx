import { useEffect, useRef, useState } from "react";
import { t, useI18n } from "@fcboard/fcboard/i18n";

import { classroomCommands } from "./commands";
import { magicEmojiCandidates } from "./magicPen";

import "./MagicCandidates.scss";

import type { GeneratedImage } from "./imageGeneration";
import type { MagicCandidateInput, MagicChoice } from "./magicPen";

type Request = MagicCandidateInput & {
  id: number;
  image?: GeneratedImage;
  error?: string;
  running: boolean;
  controller?: AbortController;
  candidateController?: AbortController;
  finish: (choice?: MagicChoice) => void;
  retry: () => void;
};

/** p6.s / layout_select_emoji: three columns, explicit selection then Confirm.
 * Independent regions keep their own preview jobs while the picker shows each in order. */
export const MagicCandidates = () => {
  useI18n();
  const [requests, setRequests] = useState<Request[]>([]);
  const [selection, setSelection] = useState<{
    id: number;
    value: MagicChoice;
  }>();
  const dialog = useRef<HTMLDivElement>(null);
  const active = requests[0];
  useEffect(() => {
    const pending = new Map<number, Request>();
    let sequence = 0;
    const publish = () => setRequests([...pending.values()]);
    const unregister = classroomCommands.register(
      "magic.candidates",
      "@internal",
      (args) => {
        const input = args as unknown as MagicCandidateInput;
        if (
          !(input.signal instanceof AbortSignal) ||
          !input.bounds ||
          ![
            input.bounds.left,
            input.bounds.top,
            input.bounds.right,
            input.bounds.bottom,
          ].every(Number.isFinite) ||
          typeof input.generate !== "function" ||
          !Array.isArray(input.candidates) ||
          (input.loadCandidates !== undefined &&
            typeof input.loadCandidates !== "function")
        ) {
          throw new Error("Invalid magic candidates");
        }
        input.signal.throwIfAborted();
        if (pending.size >= 8) {
          throw new Error(t("fcboard.local_queue_full"));
        }
        return new Promise<MagicChoice>((resolve, reject) => {
          const id = ++sequence;
          const abort = () => job.finish();
          const job: Request = {
            ...input,
            id,
            candidates: magicEmojiCandidates(input.candidates),
            running: false,
            finish: (choice) => {
              if (!pending.delete(id)) {
                return;
              }
              input.signal.removeEventListener("abort", abort);
              job.controller?.abort();
              job.candidateController?.abort();
              publish();
              if (choice) {
                resolve(choice);
              } else {
                reject(
                  new DOMException("Magic choice cancelled", "AbortError"),
                );
              }
            },
            retry: () => {
              job.controller?.abort();
              const controller = new AbortController();
              job.controller = controller;
              job.error = undefined;
              job.image = undefined;
              job.running = true;
              publish();
              void Promise.resolve()
                .then(() => {
                  controller.signal.throwIfAborted();
                  return input.generate(controller.signal);
                })
                .then((image) => {
                  if (!pending.has(id) || controller.signal.aborted) {
                    return;
                  }
                  job.image = image;
                })
                .catch((error) => {
                  if (!pending.has(id) || controller.signal.aborted) {
                    return;
                  }
                  job.error =
                    error instanceof Error ? error.message : String(error);
                })
                .finally(() => {
                  if (pending.has(id) && job.controller === controller) {
                    job.running = false;
                    publish();
                  }
                });
            },
          };
          pending.set(id, job);
          input.signal.addEventListener("abort", abort, { once: true });
          job.retry();
          if (input.loadCandidates) {
            const candidateController = new AbortController();
            job.candidateController = candidateController;
            void Promise.resolve()
              .then(() => {
                candidateController.signal.throwIfAborted();
                return input.loadCandidates!(candidateController.signal);
              })
              .then((candidates) => {
                if (pending.has(id) && !input.signal.aborted) {
                  job.candidates = magicEmojiCandidates(candidates);
                  publish();
                }
              })
              .catch(() => {});
          }
        });
      },
    );
    const invalidate = classroomCommands.onInvalidate(() =>
      [...pending.values()].forEach((request) => request.finish()),
    );
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pending.size) {
        event.stopPropagation();
        pending.values().next().value?.finish();
      }
    };
    window.addEventListener("keydown", escape);
    window.addEventListener("resize", publish);
    return () => {
      [...pending.values()].forEach((request) => request.finish());
      unregister();
      invalidate();
      window.removeEventListener("keydown", escape);
      window.removeEventListener("resize", publish);
    };
  }, []);
  useEffect(() => {
    dialog.current?.focus({ preventScroll: true });
  }, [active?.id]);
  if (!active) {
    return null;
  }
  const chosen = selection?.id === active.id ? selection.value : undefined;
  const width = Math.min(464 * 0.67, Math.max(0, innerWidth - 16));
  const height = Math.min(560 * 0.67, Math.max(0, innerHeight - 16));
  const beside = active.bounds.right + 20 * 0.67;
  const left = Math.max(
    8,
    Math.min(
      beside + width <= innerWidth - 8
        ? beside
        : active.bounds.left - width - 20 * 0.67,
      innerWidth - width - 8,
    ),
  );
  return (
    <div
      ref={dialog}
      className="fc-magic-candidates"
      role="dialog"
      aria-label={t("fcboard.magic_pen")}
      tabIndex={-1}
      data-prevent-outside-click
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        left,
        top: Math.max(8, Math.min(active.bounds.top, innerHeight - height - 8)),
        width,
        height,
      }}
    >
      <div
        className="fc-magic-grid"
        role="group"
        aria-label={t("fcboard.magic_pen")}
      >
        <button
          type="button"
          className="fc-magic-image"
          aria-label={t("fcboard.image")}
          aria-pressed={chosen?.kind === "image"}
          disabled={active.running}
          title={active.error}
          onClick={() =>
            active.image
              ? setSelection({
                  id: active.id,
                  value: { kind: "image", image: active.image },
                })
              : active.retry()
          }
        >
          {active.image ? (
            <img src={active.image.dataURL} alt="" />
          ) : active.running ? (
            <span role="status">{t("fcboard.generating_image")}</span>
          ) : (
            <span role="alert">
              <span className="fc-magic-error">{active.error}</span>
              <span>{t("chat.retry")}</span>
            </span>
          )}
        </button>
        {active.candidates.map((text) => (
          <button
            key={text}
            type="button"
            aria-label={text}
            aria-pressed={chosen?.kind === "emoji" && chosen.text === text}
            onClick={() =>
              setSelection({ id: active.id, value: { kind: "emoji", text } })
            }
          >
            <span className="fc-magic-emoji">{text}</span>
          </button>
        ))}
      </div>
      <footer>
        <button type="button" onClick={() => active.finish()}>
          {t("buttons.cancel")}
        </button>
        <button
          type="button"
          disabled={!chosen}
          onClick={() => chosen && active.finish(chosen)}
        >
          {t("buttons.confirm")}
        </button>
      </footer>
    </div>
  );
};
