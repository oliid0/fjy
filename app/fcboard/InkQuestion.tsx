import { IconButton } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { t } from "@excalidraw/excalidraw/i18n";
import {
  CloseIcon,
  microphoneIcon,
  TrashIcon,
  searchIcon,
  chevronRight,
} from "@excalidraw/excalidraw/components/icons";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { TransientMessage } from "./TransientMessage";
import { MaterialPanel } from "./MaterialPanel";
import { classroomCommands } from "./commands";
import { clipInk } from "./digitalInk";
import { documentStrokeGeometry } from "./documentInk";
import { startDictation } from "./dictation";
import { recognizeHandwriting, warmHandwriting } from "./ocr";
import { questionPosition, questionSurface } from "./questionInk";
import { updateQuestionAnswer, visibleObjectIds } from "./questionAnswer";

import type { PointerEvent as ReactPointerEvent } from "react";
import type { InkInput } from "./digitalInk";
import type { InkStroke } from "./documents";
import type { LocalSpeechHandle } from "./localSpeech";

/** A bounded writing sheet on the current surface, independent of the board pen. */
export const InkQuestion = ({
  api,
  placement,
  onSubmit,
  onClose,
}: {
  api: ExcalidrawImperativeAPI;
  placement: ReturnType<typeof questionPosition>;
  onSubmit: (
    text: string,
    signal: AbortSignal,
    sourceIds?: string[],
  ) => Promise<void>;
  onClose: () => void;
}) => {
  const width = placement.width;
  const height = placement.height;
  const svg = useRef<SVGSVGElement>(null);
  const paper = useRef<HTMLElement>(null);
  const strokes = useRef<InkStroke[]>([]);
  const active = useRef<{ id: number; stroke: InkStroke } | null>(null);
  const [ink, setInk] = useState<InkStroke[]>([]);
  const transcript = useRef("");
  const [words, setWords] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState(placement);
  const [answered, setAnswered] = useState(false);
  const [persisted, setPersisted] = useState(false);
  const [answer, setAnswer] = useState({ collapsed: false, count: 0 });
  const questionIds = useRef<string[]>([]);
  const [listening, setListening] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const mounted = useRef(true);
  const speech = useRef<LocalSpeechHandle | null>(null);
  const voiceGeneration = useRef(0);
  const request = useRef<AbortController | null>(null);
  const submitted = useRef("");
  const lock = useRef(false);
  const voiceLock = useRef(false);
  const cancelStroke = () => {
    active.current = null;
    setInk(strokes.current);
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        classroomCommands.isOwnedBy(
          classroomCommands.interactionSource,
          request.current?.signal,
        )
      ) {
        return;
      }
      if (!answered && !paper.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [onClose, answered]);
  useEffect(() => {
    const resize = () => {
      request.current?.abort();
      cancelStroke();
      try {
        setPosition(questionPosition(api));
      } catch (failure) {
        const { viewport } = questionSurface(api);
        setPosition((previous) => ({
          ...previous,
          left: Math.max(
            viewport.left,
            Math.min(previous.left, viewport.right - previous.width),
          ),
          top: Math.max(
            viewport.top,
            Math.min(previous.top, viewport.bottom - previous.height),
          ),
          width: Math.min(previous.width, viewport.right - viewport.left),
          height: Math.min(previous.height, viewport.bottom - viewport.top),
        }));
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [api]);
  useEffect(() => {
    mounted.current = true;
    const voice = voiceGeneration;
    paper.current?.focus();
    void warmHandwriting().catch(() => {});
    window.addEventListener("blur", cancelStroke);
    return () => {
      mounted.current = false;
      voice.current++;
      request.current?.abort();
      void speech.current?.cancel().catch(() => {});
      window.removeEventListener("blur", cancelStroke);
    };
  }, []);

  const fail = (failure: unknown) => {
    if (
      mounted.current &&
      !(failure instanceof DOMException && failure.name === "AbortError")
    ) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  const toggleVoice = async () => {
    if (lock.current || voiceLock.current) {
      return;
    }
    voiceLock.current = true;
    setConnecting(true);
    setError("");
    try {
      if (speech.current) {
        const handle = speech.current;
        speech.current = null;
        await handle.stop();
        voiceGeneration.current++;
        setListening(false);
        return;
      }
      const classroom = classroomCommands.read("classroom") as
        | { recording?: boolean; listening?: boolean }
        | undefined;
      if (classroom?.recording || classroom?.listening) {
        throw new Error(
          t(
            "fcboard.stop_recording_or_voice_commands_before_dictating_a_question",
          ),
        );
      }
      const generation = ++voiceGeneration.current;
      const handle = await startDictation(
        (text) => {
          if (mounted.current && generation === voiceGeneration.current) {
            transcript.current = [transcript.current, text.trim()]
              .filter(Boolean)
              .join(" ");
            setWords(transcript.current);
            setPersisted(false);
          }
        },
        (message) => {
          if (mounted.current && generation === voiceGeneration.current) {
            voiceGeneration.current++;
            void speech.current?.cancel().catch(() => {});
            speech.current = null;
            setListening(false);
            setError(message);
          }
        },
      );
      if (!mounted.current || generation !== voiceGeneration.current) {
        await handle.cancel();
      } else {
        speech.current = handle;
        setListening(true);
      }
    } catch (failure) {
      fail(failure);
    } finally {
      voiceLock.current = false;
      if (mounted.current) {
        setConnecting(false);
      }
    }
  };
  const send = async () => {
    if (lock.current || voiceLock.current || active.current) {
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    const abort = new AbortController();
    request.current = abort;
    try {
      const handle = speech.current;
      speech.current = null;
      await handle?.stop();
      voiceGeneration.current++;
      if (mounted.current) {
        setListening(false);
      }
      abort.signal.throwIfAborted();
      const input: InkInput = strokes.current.map((stroke) => stroke.points);
      const written = input.length
        ? await recognizeHandwriting(
            async () => {
              const canvas = document.createElement("canvas");
              canvas.width = width * 2;
              canvas.height = height * 2;
              const context = canvas.getContext("2d");
              if (!context) {
                throw new Error(
                  t("fcboard.unable_to_capture_the_writing_area"),
                );
              }
              context.fillStyle = "#fff";
              context.fillRect(0, 0, canvas.width, canvas.height);
              context.scale(2, 2);
              context.strokeStyle = "#000";
              context.lineCap = "round";
              context.lineJoin = "round";
              for (const stroke of strokes.current) {
                context.lineWidth = stroke.width;
                context.stroke(new Path2D(documentStrokeGeometry(stroke).path));
              }
              return canvas.toDataURL("image/png");
            },
            abort.signal,
            () => {},
            "text",
            undefined,
            input,
          )
        : "";
      abort.signal.throwIfAborted();
      const text = [written, transcript.current]
        .filter(Boolean)
        .join("\n")
        .trim();
      if (!text) {
        return;
      }
      const signature = JSON.stringify([input, transcript.current]);
      if (submitted.current !== signature && svg.current) {
        const rect = svg.current.getBoundingClientRect();
        const surface = questionSurface(api);
        const result = await classroomCommands.execute({
          name: "canvas.ink",
          args: {
            strokes: input.map((stroke) =>
              stroke.map(([x, y]) =>
                surface.point(
                  rect.left + (x * rect.width) / width,
                  rect.top + (y * rect.height) / height,
                ),
              ),
            ),
            text: transcript.current,
            bounds: {
              left: surface.point(rect.left, rect.top)[0],
              top: surface.point(rect.left, rect.top)[1],
              right: surface.point(rect.right, rect.bottom)[0],
              bottom: surface.point(rect.right, rect.bottom)[1],
            },
            replaceIds: questionIds.current,
            signal: abort.signal,
            select: false,
          },
        });
        questionIds.current = (result as { ids: string[] }).ids;
        submitted.current = signature;
        setPersisted(true);
      }
      abort.signal.throwIfAborted();
      const available = new Set(visibleObjectIds(api));
      if (questionIds.current.some((id) => !available.has(id))) {
        throw new DOMException("Question changed", "AbortError");
      }
      const before = new Set(visibleObjectIds(api));
      const target = () => {
        const document = classroomCommands.read("document") as
          | { id?: string; name?: string; page?: number }
          | undefined;
        const boards = classroomCommands.read("boards") as
          | { active?: string }
          | undefined;
        return JSON.stringify(
          document
            ? ["document", document.id, document.name, document.page]
            : ["board", boards?.active || api.id],
        );
      };
      let currentTarget = target();
      let transferred = false;
      const source = () => {
        const document = classroomCommands.read("document") as
          | { ink?: InkStroke[] }
          | undefined;
        return JSON.stringify(
          (document ? document.ink || [] : api.getSceneElements()).filter(
            (item) => questionIds.current.includes(item.id),
          ),
        );
      };
      const signatureBefore = source();
      let scheduled = false;
      let checking = true;
      const changed = () => {
        if (
          !transferred &&
          target() === currentTarget &&
          source() !== signatureBefore &&
          !classroomCommands.isExpectedTransition(abort.signal)
        ) {
          abort.abort();
          return;
        }
        if (scheduled) {
          return;
        }
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          if (!checking) {
            return;
          }
          const next = target();
          if (next !== currentTarget) {
            if (!classroomCommands.isExpectedTransition(abort.signal)) {
              abort.abort();
              return;
            }
            currentTarget = next;
            transferred = true;
          }
          if (!transferred && source() !== signatureBefore) {
            abort.abort();
          }
        });
      };
      const unwatch = api.onChange?.(changed);
      const documentChanged = classroomCommands.watch("document", changed);
      const boardChanged = classroomCommands.watch("boards", changed);
      try {
        await onSubmit(text, abort.signal, questionIds.current);
      } finally {
        checking = false;
        unwatch?.();
        documentChanged();
        boardChanged();
      }
      if (!abort.signal.aborted) {
        if (transferred) {
          onClose();
          return;
        }
        const ids = visibleObjectIds(api).filter((id) => !before.has(id));
        if (questionIds.current.length && ids.length) {
          setAnswer(
            await updateQuestionAnswer(api, questionIds.current[0], ids),
          );
        }
        setAnswered(true);
      }
    } catch (failure) {
      fail(failure);
    } finally {
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  };
  const append = (event: ReactPointerEvent<SVGSVGElement>) => {
    const current = active.current;
    if (!current || current.id !== event.pointerId || !svg.current) {
      return;
    }
    const rect = svg.current.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }
    const samples = event.nativeEvent.getCoalescedEvents?.() || [];
    for (const sample of [...samples, event]) {
      const point: [number, number] = [
        ((sample.clientX - rect.left) * width) / rect.width,
        ((sample.clientY - rect.top) * height) / rect.height,
      ];
      const last = current.stroke.points.at(-1);
      if (!last || point[0] !== last[0] || point[1] !== last[1]) {
        current.stroke.points.push(point);
      }
    }
    if (current.stroke.points.length > 10000) {
      cancelStroke();
      return;
    }
    setInk([...strokes.current, { ...current.stroke }]);
  };
  const clear = async () => {
    if (lock.current || voiceLock.current) {
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      const available = new Set(visibleObjectIds(api));
      const ids = questionIds.current.filter((id) => available.has(id));
      if (ids.length) {
        await classroomCommands.execute({
          name: "canvas.erase",
          args: { ids },
        });
      }
      questionIds.current = [];
      strokes.current = [];
      transcript.current = "";
      submitted.current = "";
      setPersisted(false);
      cancelStroke();
      setWords("");
      setError("");
    } catch (failure) {
      fail(failure);
    } finally {
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  };

  return (
    <MaterialPanel
      ref={paper}
      role="dialog"
      tabIndex={-1}
      aria-label={t("fcboard.handwritten_question")}
      aria-busy={busy}
      className="fc-ink-question fc-surface"
      style={{
        ...position,
        background: "transparent",
        boxShadow: "none",
        pointerEvents: persisted ? "none" : "auto",
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          onClose();
        }
      }}
    >
      <svg
        ref={svg}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t("fcboard.ask_the_ai_teacher")}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (
            lock.current ||
            answered ||
            active.current ||
            event.button !== 0 ||
            event.isPrimary === false ||
            (event.pointerType === "touch" && event.width > 36)
          ) {
            return;
          }
          event.preventDefault();
          setPersisted(false);
          const surface = questionSurface(api);
          active.current = {
            id: event.pointerId,
            stroke: {
              id: crypto.randomUUID(),
              points: [],
              color: surface.color,
              width: Math.min(4, Math.max(1, surface.width * surface.scale)),
              fcInk: {
                version: 2,
                pen: "hard",
                unit: 1 / (devicePixelRatio || 1),
              },
            },
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          append(event);
        }}
        onPointerMove={append}
        onPointerUp={(event) => {
          if (active.current?.id !== event.pointerId) {
            return;
          }
          append(event);
          const current = active.current;
          if (current) {
            const parts = clipInk([current.stroke.points], {
              left: 0,
              top: 0,
              right: width,
              bottom: height,
            });
            strokes.current = [
              ...strokes.current,
              ...parts.map((points) => ({
                ...current.stroke,
                id: crypto.randomUUID(),
                points,
              })),
            ];
          }
          active.current = null;
          setInk(strokes.current);
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }}
        onPointerCancel={cancelStroke}
        onLostPointerCapture={cancelStroke}
      >
        {!ink.length && !words && (
          <text x="16" y="30" className="fc-ink-question-hint">
            {t("fcboard.write_your_question_here")}
          </text>
        )}
        {!answered &&
          !persisted &&
          ink.map((stroke) => (
            <path
              key={stroke.id}
              d={documentStrokeGeometry(stroke).path}
              stroke={stroke.color}
              strokeWidth={stroke.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}
      </svg>
      {words && !persisted && (
        <div className="fc-ink-question-words">{words}</div>
      )}
      <TransientMessage message={error} role="alert" />
      <footer style={{ pointerEvents: "auto" }}>
        <IconButton
          aria-label={t("fcboard.hide_question_input")}
          onClick={onClose}
          size="small"
        >
          {CloseIcon}
        </IconButton>
        <IconButton
          aria-label={t("fcboard.clear_question")}
          disabled={busy || listening || connecting || answered}
          size="small"
          onClick={() => void clear()}
        >
          {TrashIcon}
        </IconButton>
        <IconButton
          aria-label={t("fcboard.dictate_question")}
          aria-pressed={listening}
          disabled={busy || connecting || answered}
          size="small"
          onClick={() => void toggleVoice()}
        >
          {microphoneIcon}
        </IconButton>
        <IconButton
          aria-label={t("fcboard.send_question")}
          disabled={
            busy ||
            connecting ||
            answered ||
            (!ink.length && !words && !listening)
          }
          size="small"
          onClick={() => void send()}
        >
          {searchIcon}
        </IconButton>
        <IconButton
          aria-label={t(
            answer.collapsed
              ? "fcboard.expand_answer"
              : "fcboard.collapse_answer",
          )}
          disabled={busy || !answer.count}
          aria-pressed={answer.collapsed}
          size="small"
          onClick={() => {
            if (lock.current) {
              return;
            }
            lock.current = true;
            setBusy(true);
            void updateQuestionAnswer(api, questionIds.current[0])
              .then(setAnswer)
              .catch(fail)
              .finally(() => {
                lock.current = false;
                if (mounted.current) {
                  setBusy(false);
                }
              });
          }}
        >
          {chevronRight}
        </IconButton>
      </footer>
    </MaterialPanel>
  );
};
