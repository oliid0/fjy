import { useEffect, useRef, useState } from "react";
import { t } from "@fcboard/fcboard/i18n";

import { classroomCommands, executeBoardCommand } from "./commands";
import { TransientMessage } from "./TransientMessage";

/** ZWhiteBoardActivity.onKeyDown / SkizzeService: PageUp/PageDown turn pages. */
export const PageNavigation = () => {
  const pending = useRef<AbortController | undefined>(undefined);
  const sequence = useRef(0);
  const [notice, setNotice] = useState<{
    message: string;
    error: boolean;
    id: number;
  }>();
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        !["PageUp", "PageDown"].includes(event.key) ||
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      const target = event.target instanceof Element ? event.target : undefined;
      if (
        target?.closest(
          'input,textarea,select,[contenteditable],[role="menu"],[role="listbox"],[role="combobox"]',
        ) ||
        document.querySelector(
          '[role="dialog"]:not(.fc-preview),[role="menu"],[role="listbox"]',
        )
      ) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      const pen = classroomCommands.read("skizze") as
        | { connected: boolean; visible: boolean }
        | undefined;
      if (
        pen?.connected &&
        pen.visible &&
        classroomCommands.has("skizze.resize")
      ) {
        void classroomCommands
          .execute({
            name: "skizze.resize",
            args: { key: event.key },
          })
          .catch((failure) =>
            setNotice({
              message: String(failure),
              error: true,
              id: ++sequence.current,
            }),
          );
        return;
      }
      if (pending.current) {
        return;
      }
      const direction = event.key === "PageDown" ? 1 : -1;
      const documentOpen = !!classroomCommands.read("document");
      let command;
      if (documentOpen) {
        if (
          !classroomCommands.has(
            direction > 0 ? "document.next" : "document.previous",
          )
        ) {
          return;
        }
        command = {
          name: direction > 0 ? "document.next" : "document.previous",
        };
      } else {
        const boards = classroomCommands.read("boards") as
          | { active: string; boards: { id: string }[] }
          | undefined;
        const index =
          boards?.boards.findIndex((board) => board.id === boards.active) ?? -1;
        if (!boards || index < 0) {
          return;
        }
        const next = boards.boards[index + direction];
        if (!next) {
          setNotice({
            message: t(
              direction > 0
                ? "fcboard.last_page_reached"
                : "fcboard.first_page_reached",
            ),
            error: false,
            id: ++sequence.current,
          });
          return;
        }
        command = { name: "board.switch", args: { id: next.id } };
      }
      const request = new AbortController();
      pending.current = request;
      setNotice(undefined);
      void executeBoardCommand(command, request.signal)
        .catch((failure) => {
          if (!request.signal.aborted) {
            setNotice({
              message: String(failure),
              error: true,
              id: ++sequence.current,
            });
          }
        })
        .finally(() => {
          if (pending.current === request) {
            pending.current = undefined;
          }
        });
    };
    window.addEventListener("keydown", keydown, true);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      pending.current?.abort();
    };
  }, []);
  return notice ? (
    <TransientMessage
      key={notice.id}
      role={notice.error ? "alert" : "status"}
      className={notice.error ? "fc-notice fc-error" : "fc-notice"}
      message={notice.message}
    />
  ) : null;
};
