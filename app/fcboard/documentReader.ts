import { t } from "@fcboard/fcboard/i18n";

import { isNativeDocumentInput, nativeDocumentUrl } from "./documentInput";

import type { OfficeSheet } from "./officeSheets";
import type { DocumentInput } from "./documentInput";

export type DocumentPage = {
  index: number;
  name: string;
  sheet?: { name: string; start: number; end: number };
};
export type DocumentMatch = {
  left: number;
  top: number;
  width: number;
  height: number;
};
export type DocumentOutline = { title: string; index: number; depth: number };
export type DocumentFrame = {
  ratio: number;
  naturalWidth?: number;
  text: string;
  image?: Blob;
  html?: string;
  word?: Blob;
  sheet?: OfficeSheet;
  openDocument?: Blob;
};
export type DocumentReader = {
  pages: DocumentPage[];
  showThumbnails: boolean;
  outline?: () => Promise<DocumentOutline[]>;
  find?: (
    index: number,
    query: string,
    signal: AbortSignal,
  ) => Promise<DocumentMatch[]>;
  render: (
    index: number,
    width?: number,
    signal?: AbortSignal,
  ) => Promise<DocumentFrame>;
  text?: (index: number) => Promise<string>;
  close: () => void;
};

const pagesOf = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    index,
    name: String(index + 1),
  }));

const unavailable = () => new Error(t("alerts.couldNotLoadInvalidFile"));

const request = async (url: string, signal?: AbortSignal) => {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw unavailable();
  }
  return response;
};

export const documentBlob = async (source: DocumentInput) =>
  isNativeDocumentInput(source)
    ? (await request(nativeDocumentUrl(source))).blob()
    : source;

export const documentMime = (source: DocumentInput) =>
  isNativeDocumentInput(source) ? source.mime : source.type;

export const documentCanvasBlob = (
  canvas: HTMLCanvasElement,
  mime = "image/png",
) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(unavailable())),
      mime,
    ),
  );

const canvasFor = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
};

const readPdf = async (source: DocumentInput): Promise<DocumentReader> => {
  const [pdf, worker, assets] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
    import("./documentPdfResources"),
  ]);
  pdf.GlobalWorkerOptions.workerSrc = worker.default;
  const rangeChunkSize = 262144;
  let transferError: unknown;
  let stop = () => {};
  let input:
    | { data: ArrayBuffer }
    | { range: InstanceType<typeof pdf.PDFDataRangeTransport> };
  if (isNativeDocumentInput(source)) {
    const url = nativeDocumentUrl(source);
    const { size } = source;
    const transfer = new AbortController();
    const part = async (begin: number, end: number) => {
      const reply = await fetch(url, {
        headers: { Range: `bytes=${begin}-${end - 1}` },
        signal: transfer.signal,
      });
      if (
        reply.status !== 206 ||
        reply.headers.get("Content-Range") !==
          `bytes ${begin}-${end - 1}/${size}`
      ) {
        throw unavailable();
      }
      const received = new Uint8Array(await reply.arrayBuffer());
      if (received.length !== end - begin) {
        throw unavailable();
      }
      return received;
    };
    class NativePdfRange extends pdf.PDFDataRangeTransport {
      requestDataRange(begin: number, end: number) {
        void part(begin, end)
          .then((bytes) => {
            if (!transfer.signal.aborted) {
              this.onDataRange(begin, bytes);
            }
          })
          .catch((failure) => {
            if (!transfer.signal.aborted) {
              transferError = failure;
              stop();
            }
          });
      }
      abort() {
        transfer.abort();
      }
    }
    const first = await part(0, Math.min(rangeChunkSize, size));
    input = { range: new NativePdfRange(size, first, true) };
  } else {
    input = { data: await source.arrayBuffer() };
  }
  const loading = pdf.getDocument({
    ...input,
    rangeChunkSize,
    disableStream: true,
    disableAutoFetch: true,
    isEvalSupported: false,
    useWorkerFetch: false,
    CMapReaderFactory: assets.DocumentCMapReader,
    StandardFontDataFactory: assets.DocumentStandardFontReader,
  });
  stop = () => void loading.destroy().catch(() => {});
  try {
    const document = await loading.promise;
    const textOf = async (page: Awaited<ReturnType<typeof document.getPage>>) =>
      (await page.getTextContent()).items
        .map((item) =>
          "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
        )
        .join("")
        .trim();
    return {
      pages: pagesOf(document.numPages),
      showThumbnails: true,
      text: async (index) => textOf(await document.getPage(index + 1)),
      find: async (index, query, signal) => {
        signal.throwIfAborted();
        const page = await document.getPage(index + 1);
        const content = await page.getTextContent();
        signal.throwIfAborted();
        const viewport = page.getViewport({ scale: 1 });
        const positions: {
          start: number;
          end: number;
          position: DocumentMatch;
        }[] = [];
        let text = "";
        const normalized = (value: string) =>
          value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ");
        for (const item of content.items) {
          if (!("str" in item) || !item.str) {
            continue;
          }
          const itemText = normalized(item.str);
          const start = text.length;
          text += itemText + (item.hasEOL ? " " : "");
          const [a, b, , , x, y] = pdf.Util.transform(
            viewport.transform,
            item.transform,
          );
          const left = Math.min(x, x + (a < 0 ? -item.width : item.width));
          const height = Math.max(item.height, Math.abs(b), 1);
          positions.push({
            start,
            end: start + itemText.length,
            position: {
              left: (left / viewport.width) * 100,
              top: ((y - height) / viewport.height) * 100,
              width: (Math.max(item.width, 1) / viewport.width) * 100,
              height: (height / viewport.height) * 100,
            },
          });
        }
        const value = normalized(query.trim());
        const found: DocumentMatch[] = [];
        for (
          let at = text.indexOf(value);
          value && at !== -1;
          at = text.indexOf(value, at + value.length)
        ) {
          for (const { start, end, position } of positions) {
            if (start < at + value.length && end > at) {
              found.push(position);
            }
          }
        }
        return found;
      },
      outline: async () => {
        const result: DocumentOutline[] = [];
        type Nodes = NonNullable<
          Awaited<ReturnType<typeof document.getOutline>>
        >;
        const append = async (nodes: Nodes, depth: number) => {
          for (const node of nodes) {
            try {
              const destination =
                typeof node.dest === "string"
                  ? await document.getDestination(node.dest)
                  : node.dest;
              const ref = destination?.[0];
              if (ref !== undefined && ref !== null) {
                const index =
                  typeof ref === "number"
                    ? ref
                    : await document.getPageIndex(ref);
                result.push({ title: node.title, index, depth });
              }
            } catch {
              // A broken bookmark should not prevent navigation to other pages.
            }
            await append(node.items, depth + 1);
          }
        };
        await append((await document.getOutline()) || [], 0);
        return result;
      },
      render: async (index, width = 1280, signal) => {
        signal?.throwIfAborted();
        const page = await document.getPage(index + 1);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(
          width / base.width,
          4096 / Math.max(base.width, base.height),
          Math.sqrt(4_000_000 / (base.width * base.height)),
        );
        const viewport = page.getViewport({ scale });
        const canvas = canvasFor(viewport.width, viewport.height);
        const canvasContext = canvas.getContext("2d");
        if (!canvasContext) {
          throw unavailable();
        }
        const task = page.render({ canvasContext, viewport });
        const abort = () => task.cancel();
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) {
          abort();
        }
        try {
          await task.promise;
          return {
            ratio: base.width / base.height,
            naturalWidth: (base.width * 96) / 72,
            text: width < 256 ? "" : await textOf(page),
            image: await documentCanvasBlob(canvas),
          };
        } finally {
          signal?.removeEventListener("abort", abort);
          page.cleanup();
          canvas.width = canvas.height = 1;
        }
      },
      close: stop,
    };
  } catch (error) {
    await loading.destroy().catch(() => {});
    throw transferError ?? error;
  }
};

const readSlides = async (source: DocumentInput): Promise<DocumentReader> => {
  const [{ PPTXViewer }, { default: JSZip }] = await Promise.all([
    import("pptxviewjs"),
    import("jszip"),
  ]);
  const native = isNativeDocumentInput(source)
    ? nativeDocumentUrl(source)
    : undefined;
  const deck = native
    ? undefined
    : new PPTXViewer({ slideSizeMode: "fit", backgroundColor: "#fff" });
  let count: number;
  let ratio = 16 / 9;
  let presentation: Awaited<ReturnType<typeof JSZip.loadAsync>> | undefined;
  const xmlPart = async (
    zip: NonNullable<typeof presentation>,
    path: string,
  ) => {
    const xml = await zip.file(path)?.async("string");
    return xml
      ? new DOMParser().parseFromString(xml, "application/xml")
      : undefined;
  };
  const slideText = async (
    zip: NonNullable<typeof presentation>,
    index: number,
  ) => {
    const xml = await xmlPart(zip, "ppt/presentation.xml");
    const slide = xml?.getElementsByTagNameNS("*", "sldId")[index];
    if (!slide) {
      return "";
    }
    const relationships = await xmlPart(zip, "ppt/_rels/presentation.xml.rels");
    const relationship = Array.from(
      relationships?.getElementsByTagNameNS("*", "Relationship") || [],
    ).find((item) => item.getAttribute("Id") === slide.getAttribute("r:id"));
    const target = relationship?.getAttribute("Target");
    if (!target || relationship?.getAttribute("TargetMode") === "External") {
      return "";
    }
    const path = new URL(
      target,
      "https://slide.local/ppt/presentation.xml",
    ).pathname.slice(1);
    const content = await xmlPart(zip, path);
    return Array.from(
      content?.getElementsByTagNameNS("*", "t") || [],
      (text) => text.textContent,
    ).join(" ");
  };
  if (native) {
    ({ count, ratio } = await (await request(`${native}/slides`)).json());
  } else {
    try {
      const data = await (source as File).arrayBuffer();
      presentation = await JSZip.loadAsync(data);
      const size = (
        await xmlPart(presentation, "ppt/presentation.xml")
      )?.getElementsByTagNameNS("*", "sldSz")[0];
      const width = Number(size?.getAttribute("cx"));
      const height = Number(size?.getAttribute("cy"));
      if (width > 0 && height > 0) {
        ratio = width / height;
      }
      await deck!.loadFile(data);
      count = deck!.getSlideCount();
    } catch (error) {
      deck!.destroy();
      throw error;
    }
  }
  let pending = Promise.resolve();
  let closed = false;
  return {
    pages: pagesOf(count),
    showThumbnails: true,
    render(index, width = 1280, signal) {
      const work = pending.then(async () => {
        signal?.throwIfAborted();
        if (closed) {
          throw new DOMException("Document closed", "AbortError");
        }
        const viewer =
          deck ??
          new PPTXViewer({ slideSizeMode: "fit", backgroundColor: "#fff" });
        const canvas = canvasFor(width, width / ratio);
        try {
          let contents = presentation;
          if (native) {
            const data = await (
              await request(`${native}/slides/${index}`, signal)
            ).arrayBuffer();
            signal?.throwIfAborted();
            await viewer.loadFile(data);
            if (width >= 256) {
              contents = await JSZip.loadAsync(data);
            }
          }
          signal?.throwIfAborted();
          await viewer.renderSlide(native ? 0 : index, canvas);
          signal?.throwIfAborted();
          return {
            ratio,
            text:
              width >= 256 && contents
                ? await slideText(contents, native ? 0 : index)
                : "",
            image: await documentCanvasBlob(canvas),
          };
        } finally {
          if (!deck) {
            viewer.destroy();
          }
          canvas.width = canvas.height = 1;
        }
      });
      pending = work.then(
        () => {},
        () => {},
      );
      return work;
    },
    close() {
      closed = true;
      void pending.then(() => deck?.destroy());
      presentation = undefined;
    },
  };
};

const readBinarySlides = async (
  source: DocumentInput,
): Promise<DocumentReader> => {
  const [{ loadPptViewer }, worker] = await Promise.all([
    import("@file-viewer/ppt"),
    import("@file-viewer/ppt/worker.mjs?url"),
  ]);
  const runtime = await loadPptViewer({
    workerUrl: worker.default,
    transferInputOwnership: true,
  });
  try {
    const slides = await runtime.open(
      await (await documentBlob(source)).arrayBuffer(),
    );
    return {
      pages: pagesOf(slides.slideCount),
      showThumbnails: true,
      render: async (index, width = 1280, signal) => {
        signal?.throwIfAborted();
        const scale = width / slides.width;
        const canvas = canvasFor(width, slides.height * scale);
        try {
          await slides.renderSlide(index, canvas, { scale, pixelRatio: 1 });
          signal?.throwIfAborted();
          return {
            ratio: slides.width / slides.height,
            text: "",
            image: await documentCanvasBlob(canvas),
          };
        } finally {
          await slides.releaseSlide(index);
          canvas.width = canvas.height = 1;
        }
      },
      close: () => void runtime.close().catch(() => {}),
    };
  } catch (error) {
    await runtime.close().catch(() => {});
    throw error;
  }
};

const convertedWord = async (
  html: string,
  text: string,
  header?: string,
): Promise<DocumentReader> => {
  const { default: toDocx } = await import(
    "@turbodocx/html-to-docx/dist/html-to-docx.browser.esm.js"
  );
  const content = await toDocx(documentMarkup(html), header);
  const word =
    content instanceof Blob ? content : new Blob([new Uint8Array(content)]);
  return {
    pages: pagesOf(1),
    showThumbnails: false,
    render: async () => ({ ratio: 0, word, text }),
    close() {},
  };
};

const readBinaryWord = async (
  source: DocumentInput,
): Promise<DocumentReader> => {
  const [{ default: decode }, blob] = await Promise.all([
    import("legacy-word-binary"),
    documentBlob(source),
  ]);
  const bytes = await blob.arrayBuffer();
  const parsed = decode.html(bytes);
  if (!parsed) {
    throw unavailable();
  }
  const html = [parsed.body, parsed.footnotes, parsed.endnotes]
    .filter(Boolean)
    .join("<hr>");
  return convertedWord(html, decode(bytes) || "", parsed.headers);
};

const readRichText = async (source: DocumentInput): Promise<DocumentReader> => {
  const [{ RTFJS }, blob] = await Promise.all([
    import("rtf.js"),
    documentBlob(source),
  ]);
  const records = await new RTFJS.Document(await blob.arrayBuffer()).render();
  return convertedWord(
    records.map((node) => node.outerHTML).join(""),
    records.map((node) => node.textContent || "").join("\n"),
  );
};

export const documentMarkup = (content: string, styles = "") =>
  `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'unsafe-inline'"><style>html,body{margin:0;background:white;color:#222;font:16px system-ui,sans-serif}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>${styles}</head><body>${content}</body></html>`;

const readWord = async (source: DocumentInput): Promise<DocumentReader> => {
  const { wordText } = await import("./officeWord");
  const native = isNativeDocumentInput(source);
  const url = native ? `${nativeDocumentUrl(source)}/word` : "";
  const { count } = native ? await (await request(url)).json() : { count: 1 };
  return {
    pages: pagesOf(count),
    showThumbnails: false,
    render: async (index, _width, signal) => {
      const word = native
        ? await (await request(`${url}/${index}`, signal)).blob()
        : source;
      const text = await wordText(word);
      return { ratio: 0, text, word };
    },
    close() {},
  };
};

const readSheets = async (source: DocumentInput): Promise<DocumentReader> => {
  const { sheetRows, sheetStyles } = await import("./officeSheets");
  if (isNativeDocumentInput(source) && /\.xls[xm]$/i.test(source.name)) {
    const url = `${nativeDocumentUrl(source)}/sheets`;
    const [pages, styles] = await Promise.all([
      request(url).then((reply) => reply.json() as Promise<DocumentPage[]>),
      request(`${url}/styles`)
        .then((reply) => reply.text())
        .then(sheetStyles)
        .catch(() => []),
    ]);
    return {
      pages,
      showThumbnails: false,
      render: async (index, _width, signal) => {
        const section = pages[index].sheet;
        if (!section) {
          throw unavailable();
        }
        const rows = (await (
          await request(`${url}/${index}`, signal)
        ).json()) as Parameters<typeof sheetRows>[3];
        return {
          ratio: 0,
          sheet: sheetRows(
            section.name,
            section.start,
            section.end,
            rows,
            styles,
          ),
          text: rows
            .map((row) => row.cells.map((cell) => cell.value).join("\t"))
            .join("\n"),
        };
      },
      close() {},
    };
  }
  const { read, utils } = await import("xlsx");
  const book = read(await (await documentBlob(source)).arrayBuffer(), {
    cellStyles: true,
  });
  const pages: DocumentPage[] = [];
  const perPage = 80;
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    const range = utils.decode_range(sheet["!ref"] || "A1:A1");
    for (let start = 0; start <= range.e.r; start += perPage) {
      const end = Math.min(range.e.r, start + perPage - 1);
      pages.push({
        index: pages.length,
        name: range.e.r >= perPage ? `${name} · ${start + 1}–${end + 1}` : name,
        sheet: { name, start, end },
      });
    }
  }
  return {
    pages,
    showThumbnails: false,
    render: async (index) => {
      const section = pages[index].sheet!;
      const source = book.Sheets[section.name];
      const rows = new Map<number, Parameters<typeof sheetRows>[3][number]>();
      for (const address of Object.keys(source)) {
        if (address.startsWith("!")) {
          continue;
        }
        const { r, c } = utils.decode_cell(address);
        if (r < section.start || r > section.end) {
          continue;
        }
        const row = rows.get(r) ?? { row: r, cells: [] };
        const cell = source[address];
        row.cells.push({
          column: c,
          value: String(cell.v ?? ""),
          formula: cell.f,
        });
        rows.set(r, row);
      }
      const data = [...rows.values()];
      const sheet = sheetRows(section.name, section.start, section.end, data);
      sheet.data.merges = (source["!merges"] || [])
        .filter(
          (range) => range.s.r >= section.start && range.e.r <= section.end,
        )
        .map(({ s, e }) =>
          utils.encode_range({
            s: { ...s, r: s.r - section.start },
            e: { ...e, r: e.r - section.start },
          }),
        );
      return {
        ratio: 0,
        sheet,
        text: data
          .map((row) => row.cells.map((cell) => cell.value).join("\t"))
          .join("\n"),
      };
    },
    close() {},
  };
};

export const openDocumentReader = async (
  source: DocumentInput,
): Promise<DocumentReader> => {
  const extension = source.name.split(".").at(-1)?.toLowerCase();
  switch (extension) {
    case "pdf":
      return readPdf(source);
    case "ppt":
    case "pps":
      return readBinarySlides(source);
    case "doc":
      return readBinaryWord(source);
    case "rtf":
      return readRichText(source);
    case "odt":
    case "odp": {
      const openDocument = await documentBlob(source);
      return {
        pages: pagesOf(1),
        showThumbnails: false,
        render: async () => ({ ratio: 0, text: "", openDocument }),
        close() {},
      };
    }
    case "epub":
      return (await import("./extraDocumentReaders")).readEpub(source);
    case "parquet":
      return (await import("./extraDocumentReaders")).readParquet(source);
    case "md":
    case "markdown":
      return (await import("./extraDocumentReaders")).readMarkdown(source);
    case "pptx":
    case "ppsx":
    case "pptm":
      return readSlides(source);
    case "docx":
    case "dotx":
      return readWord(source);
    case "xlsx":
    case "xls":
    case "xlsm":
    case "csv":
    case "tsv":
    case "ods":
      return readSheets(source);
    case "txt": {
      const text = await (await documentBlob(source)).text();
      const pre = document.createElement("pre");
      pre.textContent = text;
      return {
        pages: pagesOf(1),
        showThumbnails: false,
        render: async () => ({
          html: documentMarkup(pre.outerHTML),
          ratio: 0,
          text,
        }),
        close() {},
      };
    }
    case "png":
    case "jpeg":
    case "jpg":
    case "bmp":
    case "webp":
      return {
        pages: pagesOf(1),
        showThumbnails: false,
        render: async () => ({
          ratio: 0,
          text: "",
          image: await documentBlob(source),
        }),
        close() {},
      };
    default:
      throw new Error(t("errors.unsupportedFileType"));
  }
};
