import { useEffect, useState } from "react";
import { ToolbarExtras } from "@fcboard/fcboard";
import { FactoryIcon } from "@fcboard/fcboard/components/FactoryIcon";
import { t } from "@fcboard/fcboard/i18n";
import {
  toolbarItems,
  useToolbarItems,
} from "@fcboard/fcboard/toolbarPreferences";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { classroomCommands } from "./commands";
import { insertElements, insertionPoint, objectSelection } from "./board";
import { TransientMessage } from "./TransientMessage";
import { RollCall } from "./RollCall";

const controls = ["image", "rollcall", "sticky", "period"] as const;
/** The remaining x.apk entries use the existing real scene/file/resource paths. */
export const NativeToolbarItems = ({ api }: { api: FcboardImperativeAPI }) => {
  const selected = useToolbarItems();
  const [pointMode, setPointMode] = useState(() => ({
    multi: api.getAppState().multiStroke !== false,
    document: !!classroomCommands.read("document"),
  }));
  useEffect(() => {
    const refresh = () => {
      const multi = api.getAppState().multiStroke !== false;
      const document = !!classroomCommands.read("document");
      setPointMode((old) =>
        old.multi === multi && old.document === document
          ? old
          : { multi, document },
      );
    };
    const stops = [
      api.onChange(refresh),
      classroomCommands.watch("document", refresh),
    ];
    refresh();
    return () => stops.forEach((stop) => stop());
  }, [api]);
  const [error, setError] = useState("");
  const open = async (id: typeof controls[number]) => {
    setError("");
    window.dispatchEvent(new Event("fcboard:toolbox-close"));
    try {
      if (id === "image") {
        api.setActiveTool({ type: "image" });
      } else if (id === "rollcall") {
        await classroomCommands.execute({ name: "tools.rollcall" });
      } else if (id === "period") {
        await classroomCommands.execute({
          name: "resources.use",
          args: { id: "chemistry:str_periodic_table" },
        });
      } else {
        // StickyNotes.java: empty editable note, 200x200, yellow #eecf00,
        // radius30, black16sp text. Bound text remains editable in the editor.
        const size = { width: 134, height: 134 };
        const ids = insertElements(api, [
          {
            type: "rectangle",
            ...insertionPoint(api, size),
            ...size,
            backgroundColor: "#eecf00",
            fillStyle: "solid",
            strokeColor: "transparent",
            roughness: 0,
            roundness: { type: 3, value: 20.1 },
            label: { text: "", fontSize: 16, strokeColor: "#000000" },
          },
        ]);
        api.setActiveTool({ type: "selection" });
        api.updateScene({
          appState: objectSelection(
            api
              .getSceneElements()
              .filter((element) => ids.includes(element.id)),
          ),
        });
      }
    } catch (failure) {
      setError(String(failure));
    }
  };
  const button = (id: typeof controls[number]) => (
    <button
      key={id}
      type="button"
      data-close-insert
      data-native-tool={id}
      onClick={() => void open(id)}
    >
      <FactoryIcon name={toolbarItems[id].icon} />
      <span>{t(`fcboard.${toolbarItems[id].label}`)}</span>
    </button>
  );
  return (
    <>
      <ToolbarExtras toolId="multi">
        <button
          type="button"
          data-menu-toggle
          aria-label={t(
            pointMode.multi
              ? "fcboard.multi_touch_writing"
              : "fcboard.single_touch_writing",
          )}
          aria-pressed={pointMode.multi}
          disabled={pointMode.document}
          onClick={() =>
            api.updateScene({
              appState: {
                multiStroke: !pointMode.multi,
                ...(!pointMode.multi
                  ? { currentItemInkAssist: undefined }
                  : {}),
              },
            })
          }
        >
          <FactoryIcon name={pointMode.multi ? "multi" : "single"} />
          <span>{t(pointMode.multi ? "fcboard.multi" : "fcboard.single")}</span>
        </button>
      </ToolbarExtras>
      <ToolbarExtras placement="insert">
        {controls.filter((id) => !selected.includes(id)).map(button)}
      </ToolbarExtras>
      {controls.map((id) => (
        <ToolbarExtras key={id} toolId={id}>
          {button(id)}
        </ToolbarExtras>
      ))}
      <RollCall />
      <TransientMessage message={error} role="alert" />
    </>
  );
};
