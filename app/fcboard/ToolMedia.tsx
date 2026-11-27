import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { fileOpen } from "browser-fs-access";
import {
  getDataURL,
  normalizeFile,
  isSupportedImageFile,
} from "@fcboard/fcboard/data/blob";
import { loadHTMLImageElement } from "@fcboard/element/image";
import { t } from "@fcboard/fcboard/i18n";
import { mediaResourceId } from "@fcboard/fcboard/interactiveHtml";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { contentViewport } from "./board";
import { Media } from "./builtinNative";
import { classroomCommands } from "./commands";
import { insertImageResult } from "./imageGeneration";
import { pendingMediaPlayback, saveMediaFiles } from "./mediaPlaylist";
import {
  boardFileKind,
  imageFileType,
  mediaFileType,
  OPEN_ACCEPT,
  openFileTypes,
} from "./fileTypes";

import type { InkStroke } from "./documents";

export const ToolMedia = ({ api }: { api: FcboardImperativeAPI }) => {
  useEffect(() => {
    const open = async (args: Record<string, unknown>) => {
      const signal =
        args.signal instanceof AbortSignal
          ? args.signal
          : new AbortController().signal;
      signal.throwIfAborted();
      let images: File[] = [];
      let playlist: File[] = [];
      let documents: File[] = [];
      let key: string | undefined;
      let title: string | undefined;
      let video = false;
      if (Capacitor.isNativePlatform()) {
        const result = await Media.open({ fileTypes: openFileTypes });
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
        for (const item of result.documents || []) {
          const response = await fetch(Capacitor.convertFileSrc(item.uri), {
            signal,
          });
          if (!response.ok) {
            throw new Error(t("alerts.couldNotLoadInvalidFile"));
          }
          const blob = await response.blob();
          if (blob.size > 64 * 1024 * 1024) {
            throw new Error(t("errors.unsupportedFileType"));
          }
          documents.push(new File([blob], item.name, { type: item.mime }));
        }
        key = result.key;
        title = result.title;
        video = !!result.video;
      } else {
        let files: File[];
        try {
          files = await fileOpen({ multiple: true, extensions: OPEN_ACCEPT });
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            return { cancelled: true };
          }
          throw error;
        }
        if (files.some((file) => !boardFileKind(file))) {
          throw new Error(t("errors.unsupportedFileType"));
        }
        images = files.filter((file) => boardFileKind(file) === "image");
        documents = files.filter((file) =>
          ["board", "document"].includes(boardFileKind(file)!),
        );
        playlist = files
          .filter((file) => boardFileKind(file) === "playback")
          .map(
            (file) =>
              new File([file], file.name, { type: mediaFileType(file) }),
          );
        if (playlist.length) {
          key = crypto.randomUUID();
          title = playlist[0].name;
          video = playlist[0].type.startsWith("video/");
        }
      }
      signal.throwIfAborted();
      const courseware = documents.filter(
        (file) => boardFileKind(file) === "document",
      );
      if (courseware.length > 1) {
        throw new Error(t("fcboard.open_one_courseware"));
      }
      for (const file of documents) {
        if (boardFileKind(file) === "board") {
          await classroomCommands.execute({
            name: "board.open",
            args: { file, signal },
          });
        }
      }
      signal.throwIfAborted();
      if (courseware.length) {
        await classroomCommands.execute({
          name: "document.share.open",
          args: { file: courseware[0], signal },
        });
      }
      signal.throwIfAborted();
      if (images.length) {
        const normalizedImages = await Promise.all(
          images.map(async (file) => {
            const type = imageFileType(file);
            const image = await normalizeFile(
              type === file.type ? file : new File([file], file.name, { type }),
            );
            if (!isSupportedImageFile(image)) {
              throw new Error(t("errors.imageInsertError"));
            }
            return image;
          }),
        );
        signal.throwIfAborted();
        if (classroomCommands.has("document.draw")) {
          for (const image of normalizedImages) {
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
            normalizedImages,
            (view.left + view.right) / 2,
            (view.top + view.bottom) / 2,
          );
        }
      }
      if (!key) {
        return { images: images.length, documents: documents.length };
      }
      if (playlist.length) {
        await saveMediaFiles(key, playlist);
      }
      signal.throwIfAborted();
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
    };
    const stopFiles = classroomCommands.register(
      "files.pick",
      "Open the system file picker and route BZD to the editable board importer, images to canvas, audio/video to the media object, and documents to the existing internal viewer.",
      open,
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
      stopFiles();
      stopControl();
    };
  }, [api]);
  return null;
};
