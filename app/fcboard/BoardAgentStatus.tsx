import { useEffect, useState } from "react";
import { t, useI18n } from "@fcboard/fcboard/i18n";

import { classroomCommands } from "./commands";

import type { BoardTask } from "./boardAgents";

export const BoardAgentStatus = () => {
  useI18n();
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEffect(() => {
    const refresh = () =>
      setTasks(
        (classroomCommands.read("agents") as BoardTask[] | undefined) || [],
      );
    const unwatch = classroomCommands.watch("agents", refresh);
    refresh();
    return unwatch;
  }, []);
  useEffect(() => {
    const completed = tasks.filter(
      (task) => task.state === "completed" && !dismissed.has(task.id),
    );
    if (!completed.length) {
      return;
    }
    const timer = setTimeout(
      () =>
        setDismissed(
          (previous) =>
            new Set([...previous, ...completed.map((task) => task.id)]),
        ),
      2500,
    );
    return () => clearTimeout(timer);
  }, [tasks, dismissed]);
  const visible = tasks.filter(
    (task) => !dismissed.has(task.id) && task.state !== "cancelled",
  );
  if (!visible.length) {
    return null;
  }
  return (
    <aside className="fc-agent-tasks" aria-live="polite">
      {visible.slice(-6).map((task) => (
        <div key={task.id} data-state={task.state}>
          <span>
            <strong>
              {task.command?.startsWith("lesson.")
                ? `${t("fcboard.preparing_lesson")} · `
                : ""}
              {task.prompt}
            </strong>
            <small role={task.state === "failed" ? "alert" : "status"}>
              {task.error ||
                t(
                  task.state === "running"
                    ? "fcboard.assistant_executing"
                    : task.state === "completed"
                    ? "fcboard.assistant_completed"
                    : "fcboard.ai_action_failed",
                )}
            </small>
          </span>
          <button
            type="button"
            aria-label={t(
              task.state === "running" ? "buttons.cancel" : "buttons.close",
            )}
            onClick={() => {
              if (task.state === "running") {
                void classroomCommands.execute({
                  name: "agent.cancel",
                  args: { id: task.id },
                });
              } else {
                setDismissed((previous) => new Set([...previous, task.id]));
              }
            }}
          >
            ×
          </button>
        </div>
      ))}
    </aside>
  );
};
