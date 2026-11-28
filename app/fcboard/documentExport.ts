import { t } from "@fcboard/fcboard/i18n";

import { documentBlob, documentCanvasBlob } from "./documentReader";
import { inkBitmap } from "./documents";

import type { DocumentReader } from "./documentReader";
import type { DocumentInput } from "./documentInput";
import type { DocumentInk } from "./documents";

export const renderDocumentMarkup = async (html: string) => {
  const measuring = document.createElement("iframe");
  measuring.setAttribute("sandbox", "allow-same-origin");
  measuring.style.cssText =
    "position:fixed;left:-10000px;top:0;width:1000px;height:1px;border:0;visibility:hidden";
  try {
    await new Promise<void>((resolve, reject) => {
      measuring.onload = () => resolve();
      measuring.onerror = () =>
        reject(new Error(t("fcboard.could_not_capture_document")));
      measuring.srcdoc = html;
      document.body.append(measuring);
    });
    const contents = measuring.contentDocument;
    if (!contents) {
      throw new Error(t("fcboard.could_not_capture_document"));
    }
    await contents.fonts.ready;
    await Promise.all(
      [...contents.images].map((image) => image.decode().catch(() => {})),
    );
    const height = Math.max(
      1,
      contents.body.scrollHeight,
      contents.documentElement.scrollHeight,
    );
    const markup = new XMLSerializer().serializeToString(
      contents.documentElement,
    );
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${height}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const scale = Math.min(1, 1600 / height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(1000 * scale);
      canvas.height = Math.ceil(height * scale);
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error(t("fcboard.could_not_capture_document"));
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return { height, image: await documentCanvasBlob(canvas) };
    } finally {
      URL.revokeObjectURL(url);
    }
  } finally {
    measuring.remove();
  }
};

export const annotatedPdf = async (
  source: DocumentInput,
  reader: DocumentReader,
  ink: DocumentInk,
  signal: AbortSignal,
) => {
  const { PDFDocument, degrees } = await import("pdf-lib");
  signal.throwIfAborted();
  const preserve = /\.pdf$/i.test(source.name);
  const pdf = preserve
    ? await PDFDocument.load(await (await documentBlob(source)).arrayBuffer())
    : await PDFDocument.create();
  if (preserve) {
    const pages = pdf.getPages();
    for (const [index, strokes] of Object.entries(ink)) {
      signal.throwIfAborted();
      const page = pages[Number(index)];
      if (!page || !strokes.length) {
        continue;
      }
      const { x, y, width, height } = page.getCropBox();
      const angle = ((page.getRotation().angle % 360) + 360) % 360;
      const rotated = angle === 90 || angle === 270;
      const displayWidth = rotated ? height : width;
      const displayHeight = rotated ? width : height;
      const image = await inkBitmap(
        strokes,
        (1000 * displayHeight) / displayWidth,
        undefined,
        0,
        {
          transparent: true,
          uncropped: true,
        },
      );
      page.drawImage(await pdf.embedPng(await image.arrayBuffer()), {
        x: x + (angle === 90 || angle === 180 ? width : 0),
        y: y + (angle === 180 || angle === 270 ? height : 0),
        width: displayWidth,
        height: displayHeight,
        rotate: degrees(angle),
      });
    }
  } else {
    for (const [index, page] of reader.pages.entries()) {
      signal.throwIfAborted();
      const frame = await reader.render(page.index, 1400, signal);
      const background = frame.html
        ? await renderDocumentMarkup(frame.html)
        : { height: 1000 / (frame.ratio || 16 / 9), image: frame.image };
      if (!background.image) {
        throw new Error(t("fcboard.could_not_capture_document"));
      }
      const annotated = await inkBitmap(
        ink[index] || [],
        background.height,
        background.image,
        0,
        {
          uncropped: true,
          jpegQuality: 0.94,
        },
      );
      const image = await pdf.embedJpg(await annotated.arrayBuffer());
      pdf.addPage([image.width, image.height]).drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });
    }
  }
  signal.throwIfAborted();
  return new Blob([Uint8Array.from(await pdf.save())], {
    type: "application/pdf",
  });
};
