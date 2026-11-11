import { useEffect, useRef, useState } from "react";
import { newElementWith, CaptureUpdateAction } from "@fcboard/element";
import { isColorDark } from "@fcboard/common";
import { ToolbarExtras } from "@fcboard/fcboard";
import { FactoryIcon } from "@fcboard/fcboard/components/FactoryIcon";
import { getDataURL } from "@fcboard/fcboard/data/blob";
import { t } from "@fcboard/fcboard/i18n";
import {
  toolbarItems,
  useToolbarItems,
} from "@fcboard/fcboard/toolbarPreferences";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";
import type { FileId } from "@fcboard/element/types";

import { classroomCommands } from "./commands";
import { insertElements, insertionPoint, objectSelection } from "./board";
import { MaterialPanel } from "./MaterialPanel";
import { TransientMessage } from "./TransientMessage";
import dialogClose from "./native-toolbar-assets/dialog-close.svg?url";
import site0 from "./native-toolbar-assets/area_badminton_court_bg.svg?url";
import preview0 from "./native-toolbar-assets/area_type_badminton.svg?url";
import site1 from "./native-toolbar-assets/area_baseball_field_bg.svg?url";
import preview1 from "./native-toolbar-assets/area_type_baseball.svg?url";
import site2 from "./native-toolbar-assets/area_basketball_court_bg.svg?url";
import preview2 from "./native-toolbar-assets/area_type_basketball.svg?url";
import site3 from "./native-toolbar-assets/area_go_bg.svg?url";
import preview3 from "./native-toolbar-assets/area_type_go.svg?url";
import site4 from "./native-toolbar-assets/area_handball_court_bg.svg?url";
import preview4 from "./native-toolbar-assets/area_type_handball.svg?url";
import site5 from "./native-toolbar-assets/area_ice_rink_bg.svg?url";
import preview5 from "./native-toolbar-assets/area_type_ice_hockey.svg?url";
import site6 from "./native-toolbar-assets/area_football_field_bg.svg?url";
import preview6 from "./native-toolbar-assets/area_type_football.svg?url";
import site7 from "./native-toolbar-assets/area_volleyball_court_bg.svg?url";
import preview7 from "./native-toolbar-assets/area_type_volleyball.svg?url";
import site8 from "./native-toolbar-assets/area_rugby_field_bg.svg?url";
import preview8 from "./native-toolbar-assets/area_type_rugby.svg?url";
import site9 from "./native-toolbar-assets/area_softball_field_bg.svg?url";
import preview9 from "./native-toolbar-assets/area_type_softball.svg?url";

// SelectAreaDialogNew: grid_icons/grid_area_bg, four columns, instant insertion.
const sites = [
  { background: site0, icon: preview0, name: "area_badminton" },
  { background: site1, icon: preview1, name: "area_baseball" },
  { background: site2, icon: preview2, name: "area_basketball" },
  { background: site3, icon: preview3, name: "area_weiqi" },
  { background: site4, icon: preview4, name: "area_handball" },
  { background: site5, icon: preview5, name: "area_ice_hockey" },
  { background: site6, icon: preview6, name: "area_football" },
  { background: site7, icon: preview7, name: "area_volleyball" },
  { background: site8, icon: preview8, name: "area_rugby" },
  { background: site9, icon: preview9, name: "area_softball" },
] as const;
const controls = ["image", "areaBg", "sticky", "period"] as const;
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
  const [area, setArea] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => operation.current?.abort(), []);
  const addSite = async (site: typeof sites[number]) => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    operation.current = controller;
    const revision = classroomCommands.revision;
    try {
      const response = await fetch(site.background, {
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      if (!response.ok) {
        throw new Error(t("fcboard.this_teaching_tool_is_unavailable"));
      }
      const blob = await response.blob();
      const svg = new DOMParser().parseFromString(
        await blob.text(),
        "image/svg+xml",
      ).documentElement;
      const intrinsic = (svg.getAttribute("viewBox") || "")
        .split(/\s+/)
        .map(Number);
      if (
        intrinsic.length !== 4 ||
        !(intrinsic[2] > 0) ||
        !(intrinsic[3] > 0)
      ) {
        throw new Error(t("fcboard.this_teaching_tool_is_unavailable"));
      }
      const background = api.getAppState().viewBackgroundColor;
      const lineColor = isColorDark(background) ? "#ffffff" : "#010101";
      svg.querySelectorAll('[stroke="#ffffff"]').forEach((path) => {
        path.setAttribute("stroke", lineColor);
      });
      const dataURL = await getDataURL(
        new Blob([new XMLSerializer().serializeToString(svg)], {
          type: "image/svg+xml",
        }),
      );
      controller.signal.throwIfAborted();
      if (revision !== classroomCommands.revision) {
        return;
      }
      // AreaShape.initBitmapLocation: intrinsic drawable size, fit the viewport,
      // never enlarge. These vectors declare literal dp, not scaled x* dimens.
      const state = api.getAppState();
      const scale = Math.min(
        1,
        state.width / state.zoom.value / intrinsic[2],
        state.height / state.zoom.value / intrinsic[3],
      );
      const width = intrinsic[2] * scale;
      const height = intrinsic[3] * scale;
      const position = insertionPoint(api, { width, height });
      if (classroomCommands.has("document.draw")) {
        await classroomCommands.execute({
          name: "document.draw",
          args: {
            progress: 1,
            image: dataURL,
            shape: {
              id: crypto.randomUUID(),
              type: "image",
              ...position,
              width,
              height,
            },
            signal: controller.signal,
          },
        });
      } else {
        const fileId = crypto.randomUUID() as FileId;
        api.addFiles([
          {
            id: fileId,
            dataURL,
            mimeType: "image/svg+xml",
            created: Date.now(),
          },
        ]);
        const existing = api
          .getSceneElements()
          .find((element) => element.customData?.fcNativeArea);
        if (existing?.type === "image") {
          api.updateScene({
            elements: api.getSceneElements().map((element) =>
              element.id === existing.id
                ? newElementWith(existing, {
                    fileId,
                    width:
                      typeof existing.customData?.fcNativeAreaWidth ===
                        "number" && existing.customData.fcNativeAreaWidth > 0
                        ? (existing.width /
                            existing.customData.fcNativeAreaWidth) *
                          intrinsic[2]
                        : width,
                    height:
                      typeof existing.customData?.fcNativeAreaHeight ===
                        "number" && existing.customData.fcNativeAreaHeight > 0
                        ? (existing.height /
                            existing.customData.fcNativeAreaHeight) *
                          intrinsic[3]
                        : height,
                    customData: {
                      ...existing.customData,
                      fcNativeAreaWidth: intrinsic[2],
                      fcNativeAreaHeight: intrinsic[3],
                    },
                  })
                : element,
            ),
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
          });
        } else {
          insertElements(api, [
            {
              type: "image",
              ...position,
              width,
              height,
              fileId,
              locked: true,
              customData: {
                fcNativeArea: true,
                fcNativeAreaWidth: intrinsic[2],
                fcNativeAreaHeight: intrinsic[3],
              },
            },
          ]);
        }
        api.setActiveTool({ type: "freedraw" });
      }
      controller.signal.throwIfAborted();
      setArea(false);
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(String(failure));
      }
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        pending.current = false;
        setBusy(false);
      }
    }
  };
  const closeSite = () => {
    operation.current?.abort();
    operation.current = undefined;
    pending.current = false;
    setBusy(false);
    setArea(false);
  };
  const open = async (id: typeof controls[number]) => {
    setError("");
    window.dispatchEvent(new Event("fcboard:toolbox-close"));
    try {
      if (id === "image") {
        api.setActiveTool({ type: "image" });
      } else if (id === "areaBg") {
        setArea(true);
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
      {area && (
        <MaterialPanel
          centered
          role="dialog"
          className="fc-native-area"
          aria-label={t("fcboard.area_background")}
          onDismiss={closeSite}
        >
          <header>
            <h2>{t("fcboard.area_background")}</h2>
            <button
              type="button"
              aria-label={t("buttons.close")}
              onClick={closeSite}
            >
              <img src={dialogClose} alt="" draggable={false} />
            </button>
          </header>
          <TransientMessage message={error} role="alert" />
          <div className="fc-native-area-grid" aria-busy={busy}>
            {sites.map((site) => (
              <button
                key={site.name}
                type="button"
                disabled={busy}
                onClick={() => void addSite(site)}
              >
                <img src={site.icon} alt="" />
                <span>{t(`fcboard.native_sites.${site.name}`)}</span>
              </button>
            ))}
          </div>
        </MaterialPanel>
      )}
      {!area && <TransientMessage message={error} role="alert" />}
    </>
  );
};
