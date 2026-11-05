import { IconButton } from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@fcboard/fcboard/i18n";
import { searchIcon } from "@fcboard/fcboard/components/icons";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { TransientMessage } from "./TransientMessage";
import { classroomCommands } from "./commands";
import { recognizeHandwriting, warmHandwriting } from "./ocr";

import { questionSurface } from "./questionInk";
import {
  framedQuestion,
  insertQuestionFrame,
  questionFrames,
} from "./questionFrame";

import type { questionPosition } from "./questionInk";

export type QuestionContext = { text: string; image?: string };

/** Search controls follow persistent hollow scene borders; the canvas owns all writing and erasing. */
export const InkQuestion = ({
  api,
  placement,
  onSubmit,
}: {
  api: FcboardImperativeAPI;
  placement?: ReturnType<typeof questionPosition>;
  onSubmit: (
    text: string,
    signal: AbortSignal,
    sourceIds?: string[],
    context?: QuestionContext,
  ) => Promise<void>;
}) => {
  const [frames, setFrames] = useState(() => questionFrames(api));
  const readSurface = useCallback(() => {
    try {
      return questionSurface(api);
    } catch {
      return undefined;
    }
  }, [api]);
  const [surface, setSurface] = useState(readSurface);
  const [busy, setBusy] = useState<string[]>([]);
  const [error, setError] = useState("");
  const requests = useRef(
    new Map<
      string,
      {
        controller: AbortController;
        signature: string;
        target: string;
        transferred: boolean;
      }
    >(),
  );
  const mounted = useRef(false);
  const created = useRef(false);
  const target = useCallback(() => {
    const document = classroomCommands.read("document") as
      | { id?: string; name?: string; page?: number }
      | undefined;
    const board = classroomCommands.read("boards") as
      | { active?: string }
      | undefined;
    return JSON.stringify(
      document
        ? ["document", document.id, document.name, document.page]
        : ["board", board?.active || api.id],
    );
  }, [api]);
  useEffect(() => {
    mounted.current = true;
    const activeRequests = requests.current;
    const refresh = () => {
      const next = questionFrames(api);
      setFrames((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
      const area = next.length ? readSurface() : undefined;
      setSurface((previous) => {
        if (!previous || !area) {
          return area;
        }
        return JSON.stringify([
          previous.scale,
          previous.viewport,
          previous.point(0, 0),
        ]) === JSON.stringify([area.scale, area.viewport, area.point(0, 0)])
          ? previous
          : area;
      });
      requests.current.forEach((request, id) => {
        if (request.transferred) {
          return;
        }
        if (classroomCommands.isExpectedTransition(request.controller.signal)) {
          if (target() !== request.target) {
            request.transferred = true;
          }
          return;
        }
        try {
          if (
            target() !== request.target ||
            framedQuestion(api, id).signature !== request.signature
          ) {
            request.controller.abort();
          }
        } catch {
          request.controller.abort();
        }
      });
    };
    const stop = api.onChange?.(refresh);
    const document = classroomCommands.watch("document", refresh);
    const board = classroomCommands.watch("boards", refresh);
    const invalidate = classroomCommands.onInvalidate(() => {
      requests.current.forEach((request) => {
        if (classroomCommands.isExpectedTransition(request.controller.signal)) {
          request.transferred = true;
        } else {
          request.controller.abort();
        }
      });
      refresh();
    });
    const cancel = classroomCommands.register(
      "question.cancel",
      "@internal",
      () => {
        activeRequests.forEach((request) => request.controller.abort());
      },
    );
    window.addEventListener("resize", refresh);
    return () => {
      mounted.current = false;
      activeRequests.forEach((request) => request.controller.abort());
      stop?.();
      document();
      board();
      invalidate();
      cancel();
      window.removeEventListener("resize", refresh);
    };
  }, [api, readSurface, target]);
  useEffect(() => {
    if (!placement || created.current) {
      return;
    }
    created.current = true;
    if (questionFrames(api).length) {
      setFrames(questionFrames(api));
      return;
    }
    void insertQuestionFrame(api, placement)
      .then(() => {
        if (mounted.current) {
          setFrames(questionFrames(api));
          setSurface(readSurface());
        }
      })
      .catch((failure) => {
        if (mounted.current) {
          setError(String(failure));
        }
      });
    void warmHandwriting().catch(() => {});
  }, [api, placement, readSurface]);
  const send = async (id: string) => {
    if (requests.current.has(id)) {
      return;
    }
    const controller = new AbortController();
    setError("");
    try {
      const source = framedQuestion(api, id);
      if (!source.hasContent) {
        throw new Error(
          t("fcboard.no_content_recognized_select_the_area_again"),
        );
      }
      requests.current.set(id, {
        controller,
        signature: source.signature,
        target: target(),
        transferred: false,
      });
      setBusy((previous) => [...previous, id]);
      let image: Promise<string> | undefined;
      const capture = () => (image ||= source.image());
      const text =
        source.ink.length || !source.text.trim()
          ? await recognizeHandwriting(
              capture,
              controller.signal,
              () => {},
              "text",
              undefined,
              source.ink,
            )
          : source.text;
      controller.signal.throwIfAborted();
      if (framedQuestion(api, id).signature !== source.signature) {
        throw new DOMException("Question contents changed", "AbortError");
      }
      if (!text.trim()) {
        throw new Error(
          t("fcboard.no_content_recognized_select_the_area_again"),
        );
      }
      await onSubmit(text.trim(), controller.signal, source.ids, {
        text: text.trim(),
        image: await capture(),
      });
    } catch (failure) {
      if (
        mounted.current &&
        !controller.signal.aborted &&
        !(failure instanceof DOMException && failure.name === "AbortError")
      ) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      requests.current.delete(id);
      if (mounted.current) {
        setBusy((previous) => previous.filter((value) => value !== id));
      }
    }
  };
  return (
    <>
      {frames.map((frame) => {
        if (!surface) {
          return null;
        }
        const [left, top] = surface.point(0, 0);
        const position = {
          left: (frame.bounds.left - left) * surface.scale,
          top: (frame.bounds.top - top) * surface.scale,
          width: (frame.bounds.right - frame.bounds.left) * surface.scale,
          height: (frame.bounds.bottom - frame.bounds.top) * surface.scale,
        };
        return (
          <div
            key={frame.id}
            data-question-frame={frame.id}
            role="dialog"
            aria-label={t("fcboard.handwritten_question")}
            aria-busy={busy.includes(frame.id)}
            className="fc-ink-question"
            style={{ ...position, pointerEvents: "none" }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                requests.current.get(frame.id)?.controller.abort();
              }
            }}
          >
            <IconButton
              aria-label={t("fcboard.send_question")}
              disabled={busy.includes(frame.id)}
              className="fc-question-search"
              size="small"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => void send(frame.id)}
            >
              {searchIcon}
            </IconButton>
          </div>
        );
      })}
      <TransientMessage message={error} role="alert" />
    </>
  );
};
