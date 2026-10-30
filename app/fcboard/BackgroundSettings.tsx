import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import Popper from "@mui/material/Popper";
import {
  DEFAULT_MAX_IMAGE_WIDTH_OR_HEIGHT,
  MAX_ALLOWED_FILE_BYTES,
} from "@fcboard/common";
import { getDataURL, resizeImageFile } from "@fcboard/fcboard/data/blob";
import { t } from "@fcboard/fcboard/i18n";
import {
  validBackgroundImage,
  loadBackground,
} from "@fcboard/fcboard/whiteboardBackground";

import type { AppState } from "@fcboard/fcboard/types";

import {
  factoryBackgroundColorIcons,
  factoryBackgroundPatternIcons,
} from "./factoryBackgroundIcons";
import addCustomIcon from "./factory-background-icons/add_category_module.png?url";
import { classroomCommands } from "./commands";
import { FactoryColorWheel } from "./FactoryColorWheel";
import { TransientMessage } from "./TransientMessage";
import { pickImageFile } from "./boardFile";

const colors = ["#212121", "#576269", "#000000", "#253a35", "#60a96c"];

/** NewSlideBackgroundView: choose an image, tap its preview to reuse it,
 * long-press to replace. Background pixels remain outside erasable objects. */
export const BackgroundSettings = ({
  state,
  onChange,
}: {
  state: AppState;
  onChange: (input: Record<string, unknown>) => void;
}) => {
  const [wheel, setWheel] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const colorButton = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  const browsing = useRef<AbortController | undefined>(undefined);
  const press = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longPressed = useRef(false);
  const custom =
    state.whiteboardCustomBackground ?? state.whiteboardBackground?.image;
  const selected = state.viewBackgroundColor.toLowerCase();
  useEffect(
    () => () => {
      generation.current++;
      browsing.current?.abort();
      clearTimeout(press.current);
    },
    [],
  );
  const choose = async (image: File) => {
    const request = ++generation.current;
    const revision = classroomCommands.revision;
    const current = () =>
      request === generation.current && revision === classroomCommands.revision;
    setBusy(true);
    setError("");
    try {
      if (
        ![
          "image/png",
          "image/jpeg",
          "image/webp",
          "image/bmp",
          "image/gif",
        ].includes(image.type)
      ) {
        throw new Error(t("errors.unsupportedFileType"));
      }
      const resized = await resizeImageFile(image, {
        maxWidthOrHeight: DEFAULT_MAX_IMAGE_WIDTH_OR_HEIGHT,
        ...(["image/bmp", "image/gif"].includes(image.type)
          ? { outputType: "image/png" as const }
          : {}),
      });
      if (resized.size > MAX_ALLOWED_FILE_BYTES) {
        throw new Error(
          t("errors.fileTooBig", {
            maxSize: `${MAX_ALLOWED_FILE_BYTES / 1024 / 1024}MB`,
          }),
        );
      }
      const data = await getDataURL(resized);
      if (!validBackgroundImage(data)) {
        throw new Error(t("errors.unsupportedFileType"));
      }
      await loadBackground({ pattern: 14, image: data, width: 1, height: 1 });
      if (current()) {
        onChange({ backgroundImage: data });
      }
    } catch (failure) {
      if (current()) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      if (request === generation.current) {
        setBusy(false);
      }
    }
  };
  const requestFile = async () => {
    if (!Capacitor.isNativePlatform()) {
      file.current?.click();
      return;
    }
    if (browsing.current) {
      return;
    }
    const controller = new AbortController();
    browsing.current = controller;
    const stop = classroomCommands.onInvalidate(() => controller.abort());
    const request = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const image = await pickImageFile(controller.signal);
      if (image) {
        await choose(image);
      }
    } catch (failure) {
      if (!controller.signal.aborted && request === generation.current) {
        setError(String(failure));
      }
    } finally {
      stop();
      if (browsing.current === controller) {
        browsing.current = undefined;
      }
      if (request === generation.current) {
        setBusy(false);
      }
    }
  };
  return (
    <div className="fc-background-settings" aria-busy={busy}>
      <h3>{t("fcboard.factorySettings.color")}</h3>
      <div
        className="fc-background-colors"
        role="group"
        aria-label={t("fcboard.background")}
      >
        {factoryBackgroundColorIcons.map((icons, index) => {
          const active =
            index < 5 ? selected === colors[index] : !colors.includes(selected);
          return (
            <button
              key={index}
              type="button"
              ref={index === 5 ? colorButton : undefined}
              aria-label={
                index < 5
                  ? `${t("fcboard.background")} ${colors[index]}`
                  : t("fcboard.custom_colour")
              }
              aria-pressed={active}
              aria-expanded={index === 5 ? wheel : undefined}
              onClick={() => {
                if (index === 5) {
                  setWheel(!wheel);
                } else {
                  setWheel(false);
                  onChange({ backgroundColor: colors[index] });
                }
              }}
            >
              <img src={active ? icons.selected : icons.normal} alt="" />
            </button>
          );
        })}
      </div>
      <Popper
        open={wheel}
        anchorEl={colorButton.current}
        placement="right-start"
        modifiers={[
          {
            name: "flip",
            options: { fallbackPlacements: ["bottom-start", "left-start"] },
          },
          { name: "preventOverflow", options: { padding: 12 } },
        ]}
        sx={{ zIndex: 1400 }}
      >
        <FactoryColorWheel
          value={state.viewBackgroundColor}
          onChange={(color) => onChange({ backgroundColor: color })}
        />
      </Popper>
      <h3>{t("fcboard.factorySettings.pattern")}</h3>
      <div
        className="fc-background-picker"
        role="group"
        aria-label={t("fcboard.factorySettings.pattern")}
      >
        {factoryBackgroundPatternIcons.map((icons, pattern) => {
          const active = (state.whiteboardBackground?.pattern || 0) === pattern;
          return (
            <button
              key={pattern}
              type="button"
              aria-pressed={active}
              aria-label={
                pattern
                  ? t("fcboard.background_pattern_number", { number: pattern })
                  : t("fcboard.no_background_pattern")
              }
              onClick={() => onChange({ backgroundPattern: pattern })}
            >
              <img src={active ? icons.selected : icons.normal} alt="" />
            </button>
          );
        })}
      </div>
      <h3>{t("fcboard.factorySettings.custom")}</h3>
      <button
        className="fc-background-custom"
        type="button"
        disabled={busy}
        aria-label={t("fcboard.factorySettings.custom")}
        aria-pressed={state.whiteboardBackground?.pattern === 14}
        onClick={() => {
          clearTimeout(press.current);
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          if (custom) {
            onChange({ backgroundImage: custom });
          } else {
            void requestFile();
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          longPressed.current = false;
          press.current = setTimeout(() => {
            longPressed.current = true;
            void requestFile();
          }, 500);
        }}
        onPointerUp={() => clearTimeout(press.current)}
        onPointerCancel={() => clearTimeout(press.current)}
        onPointerLeave={() => clearTimeout(press.current)}
        onContextMenu={(event) => {
          event.preventDefault();
          clearTimeout(press.current);
          if (longPressed.current) {
            return;
          }
          longPressed.current = true;
          void requestFile();
        }}
      >
        <img src={custom || addCustomIcon} alt="" />
      </button>
      <input
        ref={file}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
        onChange={(event) => {
          const image = event.target.files?.[0];
          event.target.value = "";
          if (image) {
            void choose(image);
          }
        }}
      />
      {busy && <p role="status">{t("labels.loadingScene")}</p>}
      {error && (
        <TransientMessage role="alert" className="fc-error" message={error} />
      )}
    </div>
  );
};
