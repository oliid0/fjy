import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { fileOpen } from "browser-fs-access";
import { getDataURL, isSupportedImageFile } from "@fcboard/fcboard/data/blob";
import { loadHTMLImageElement } from "@fcboard/element/image";
import { t } from "@fcboard/fcboard/i18n";
import { mediaResourceId } from "@fcboard/fcboard/interactiveHtml";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { contentViewport } from "./board";
import { Media } from "./builtinNative";
import { classroomCommands } from "./commands";
import { insertImageResult } from "./imageGeneration";
import { pendingMediaPlayback, saveMediaFiles } from "./mediaPlaylist";

import type { InkStroke } from "./documents";

export const ToolMedia = ({ api }: { api: FcboardImperativeAPI }) => {
  useEffect(() => {
    const stopOpen = classroomCommands.register(
      "tools.media",
      "Choose local images, audio and video together. Images become selectable canvas images. Audio/video files form a playable scene object. Optional kind=image|playback filters the picker.",
      async (args) => {
        const kind = args.kind;
        if (kind !== undefined && kind !== "image" && kind !== "playback") {
          throw new Error(t("fcboard.invalid_style_parameters"));
        }
        const signal =
          args.signal instanceof AbortSignal
            ? args.signal
            : new AbortController().signal;
        let images: File[] = [];
        let key: string | undefined;
        let title: string | undefined;
        let video = false;
        if (Capacitor.isNativePlatform()) {
          const result = await Media.open({ kind });
          signal.throwIfAborted();
          if (result.cancelled) {
            return { cancelled: true };
          }
          for (const item of result.images || []) {
            const response = await fetch(Capacitor.convertFileSrc(item.uri), {
              signal,
            });
            if (!response.ok) {
              throw new Error(t("errors.imageInsertError"));
            }
            images.push(
              new File([await response.blob()], item.name, { type: item.mime }),
            );
          }
          key = result.key;
          title = result.title;
          video = !!result.video;
        } else {
          let files: File[];
          try {
            files = await fileOpen({
              multiple: true,
              mimeTypes:
                kind === "image"
                  ? ["image/*"]
                  : kind === "playback"
                  ? ["audio/*", "video/*"]
                  : ["image/*", "audio/*", "video/*"],
            });
          } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
              return { cancelled: true };
            }
            throw error;
          }
          const isImage = (item: File) =>
            item.type.startsWith("image/") ||
            (!item.type &&
              /\.(png|jpg|jpeg|webp|gif|bmp|svg|avif)$/i.test(item.name));
          images = files.filter(isImage);
          const playlist = files.filter((item) => !isImage(item));
          if (playlist.length) {
            key = crypto.randomUUID();
            title = playlist[0].name;
            video =
              playlist[0].type.startsWith("video/") ||
              (!playlist[0].type &&
                /\.(mp4|webm|mkv|mov|avi|m4v|ogv)$/i.test(title));
            await saveMediaFiles(key, playlist);
          }
        }
        signal.throwIfAborted();
        if (images.length) {
          if (classroomCommands.has("document.draw")) {
            for (const image of images) {
              if (!isSupportedImageFile(image)) {
                throw new Error(t("errors.imageInsertError"));
              }
              const dataURL = await getDataURL(image);
              const bitmap = await loadHTMLImageElement(dataURL);
              await insertImageResult(
                api,
                {
                  dataURL,
                  mimeType: image.type,
                  width: bitmap.naturalWidth,
                  height: bitmap.naturalHeight,
                },
                signal,
              );
            }
          } else {
            const view = contentViewport(api);
            await api.insertImages(
              images,
              (view.left + view.right) / 2,
              (view.top + view.bottom) / 2,
            );
          }
        }
        if (!key) {
          return { images: images.length };
        }
        pendingMediaPlayback.add(key);
        try {
          const result = await classroomCommands.execute({
            name: "canvas.resource",
            args: {
              signal,
              resource: {
                id: mediaResourceId,
                title: (title || t("fcboard.media")).slice(0, 160),
                html: "",
                media: { key, video },
              },
            },
          });
          return {
            open: true,
            images: images.length,
            ...(result as { ids: string[] }),
          };
        } catch (error) {
          pendingMediaPlayback.delete(key);
          throw error;
        }
      },
    );
    const stopControl = classroomCommands.register(
      "media.control",
      "Control the selected or latest media object, optionally by id. action=read|play|pause|seek|speed|next|previous|enhance|close. Seek uses seconds, speed uses 0.25..3 and Android enhancement uses level 0..3.",
      (args) => {
        if (
          ![
            "read",
            "play",
            "pause",
            "seek",
            "speed",
            "next",
            "previous",
            "enhance",
            "close",
          ].includes(String(args.action))
        ) {
          throw new Error(t("fcboard.invalid_style_parameters"));
        }
        const doc = classroomCommands.read("document") as
          | { ink: InkStroke[]; selection?: string[] }
          | undefined;
        const ids = doc
          ? doc.ink
              .filter((stroke) => stroke.resource?.id === mediaResourceId)
              .map((stroke) => stroke.id)
          : api
              .getSceneElements()
              .filter(
                (el) =>
                  !el.isDeleted &&
                  el.customData?.fcInteractiveResource?.id === mediaResourceId,
              )
              .map((el) => el.id);
        const selected = doc
          ? doc.selection || []
          : Object.keys(api.getAppState().selectedElementIds);
        const target =
          args.id === undefined
            ? ids.find((id) => selected.includes(id)) || ids.at(-1)
            : ids.find((id) => id === args.id);
        if (!target) {
          if (
            args.id === undefined &&
            (args.action === "read" || args.action === "close")
          ) {
            return { open: false };
          }
          throw new Error(t("fcboard.media_choose"));
        }
        return classroomCommands.execute({
          name: `media.object.${target}`,
          args,
        });
      },
    );
    return () => {
      stopOpen();
      stopControl();
    };
  }, [api]);
  return null;
};
