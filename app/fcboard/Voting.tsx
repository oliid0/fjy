import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { t } from "@fcboard/fcboard/i18n";

import { QRCode } from "../share/QRCode";

import { classroomCommands } from "./commands";
import { FloatingToolPanel } from "./FloatingToolPanel";
import { Voting as bridge } from "./builtinNative";

import type { VoteState } from "./builtinNative";

export const Voting = () => {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [options, setOptions] = useState("A\nB\nC\nD");
  const [multiple, setMultiple] = useState(false);
  const [session, setSession] = useState<VoteState | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const revision = useRef(0);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const stamp = revision.current;
    const value = await bridge.read();
    if (stamp === revision.current) {
      setSession(value.active ? value : null);
    }
    return value;
  }, []);
  const operate = useCallback(
    async (args: Record<string, unknown>) => {
      const action = args.action ?? "open";
      if (
        !["open", "read", "start", "end", "clear", "close"].includes(
          String(action),
        )
      ) {
        throw new Error(t("fcboard.invalid_style_parameters"));
      }
      if (action === "close") {
        setOpen(false);
        return { open: false };
      }
      setOpen(true);
      if (action === "open") {
        if (Capacitor.isNativePlatform()) {
          return refresh();
        }
        return { open: true, available: false };
      }
      if (!Capacitor.isNativePlatform()) {
        throw new Error(t("fcboard.vote_android_required"));
      }
      if (pending.current) {
        throw new Error(t("fcboard.opening_the_display_tool_please_wait"));
      }
      pending.current = true;
      if (action !== "read") {
        revision.current++;
      }
      setBusy(true);
      setError("");
      try {
        if (action === "read") {
          return await refresh();
        }
        if (action === "start") {
          if (
            typeof args.topic !== "string" ||
            !args.topic.trim() ||
            args.topic.length > 200 ||
            !Array.isArray(args.options) ||
            args.options.length < 2 ||
            args.options.length > 8 ||
            args.options.some(
              (value) =>
                typeof value !== "string" ||
                !value.trim() ||
                value.length > 120,
            ) ||
            (args.multiple !== undefined && typeof args.multiple !== "boolean")
          ) {
            throw new Error(t("fcboard.vote_invalid"));
          }
          const value = await bridge.start({
            topic: args.topic.trim(),
            options: args.options as string[],
            multiple: args.multiple === true,
          });
          setSession(value);
          return value;
        }
        if (action === "end") {
          const value = await bridge.end();
          setSession(value);
          return value;
        }
        await bridge.clear();
        setSession(null);
        return { active: false };
      } catch (failure) {
        setError(String(failure));
        throw failure;
      } finally {
        pending.current = false;
        setBusy(false);
      }
    },
    [refresh],
  );
  useEffect(
    () =>
      classroomCommands.register(
        "tools.vote",
        "Built-in LAN voting. action=open|read|start|end|clear|close. start requires topic (1..200 chars), options (2..8 strings), multiple boolean. QR phone page records actual choices; read returns real participant/option totals. Closing panel keeps voting open; end stops submissions.",
        operate,
      ),
    [operate],
  );
  useEffect(() => {
    if (!open || !Capacitor.isNativePlatform()) {
      return;
    }
    let live = true;
    let polling = false;
    const poll = async () => {
      if (pending.current || polling) {
        return;
      }
      polling = true;
      const stamp = revision.current;
      try {
        const value = await bridge.read();
        if (live && stamp === revision.current) {
          setSession(value.active ? value : null);
        }
      } catch (failure) {
        if (live && stamp === revision.current) {
          setError(String(failure));
        }
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(poll, 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [open]);
  const attempt = (args: Record<string, unknown>) => {
    void operate(args).catch(() => {});
  };
  return open ? (
    <FloatingToolPanel
      title={t("fcboard.vote")}
      width={520}
      onClose={() => setOpen(false)}
    >
      <div className="fc-builtin-body">
        {!Capacitor.isNativePlatform() ? (
          <p role="status">{t("fcboard.vote_android_required")}</p>
        ) : session ? (
          <>
            <h3>{session.topic}</h3>
            <p role="status">
              {t("fcboard.vote_participants", { number: session.participants })}{" "}
              ·{" "}
              {t(
                session.accepting
                  ? "fcboard.vote_collecting"
                  : "fcboard.vote_ended",
              )}
            </p>
            {session.accepting && session.urls[0] && (
              <>
                <QRCode value={session.urls[0]} />
                <a href={session.urls[0]} target="_blank" rel="noreferrer">
                  {session.urls[0]}
                </a>
              </>
            )}
            {session.options.map((option, i) => (
              <div key={i}>
                {option} · {session.counts[i]}
                <progress
                  style={{ width: "100%" }}
                  max={Math.max(1, session.participants)}
                  value={session.counts[i]}
                />
              </div>
            ))}
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                attempt({ action: session.accepting ? "end" : "clear" })
              }
            >
              {t(session.accepting ? "fcboard.vote_end" : "fcboard.vote_new")}
            </button>
          </>
        ) : (
          <>
            <label>
              {t("fcboard.vote_topic")}
              <input
                value={topic}
                maxLength={200}
                onChange={(event) => setTopic(event.target.value)}
              />
            </label>
            <label>
              {t("fcboard.vote_options")}
              <textarea
                rows={5}
                value={options}
                onChange={(event) => setOptions(event.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={multiple}
                onChange={(event) => setMultiple(event.target.checked)}
              />
              {t("fcboard.vote_multiple")}
            </label>
            <button
              type="button"
              disabled={busy || !topic.trim()}
              onClick={() =>
                attempt({
                  action: "start",
                  topic,
                  options: options
                    .split("\n")
                    .map((value) => value.trim())
                    .filter(Boolean),
                  multiple,
                })
              }
            >
              {t(busy ? "fcboard.opening" : "fcboard.vote_start")}
            </button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </FloatingToolPanel>
  ) : null;
};
