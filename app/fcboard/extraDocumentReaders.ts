import { documentBlob, documentMarkup } from "./documentReader";
import { isNativeDocumentInput, nativeDocumentUrl } from "./documentInput";

import type { DocumentInput } from "./documentInput";
import type { DocumentOutline, DocumentReader } from "./documentReader";

const localContent = (markup: string) => {
  const doc = new DOMParser().parseFromString(markup, "text/html");
  doc
    .querySelectorAll(
      "base, link, meta, script, iframe, video, audio, object, embed, form",
    )
    .forEach((item) => item.remove());
  for (const item of doc.querySelectorAll("*")) {
    for (const attribute of Array.from(item.attributes)) {
      if (
        /^on/i.test(attribute.name) ||
        attribute.name === "href" ||
        attribute.name === "srcset" ||
        (attribute.name === "src" && !attribute.value.startsWith("data:"))
      ) {
        item.removeAttribute(attribute.name);
      }
    }
  }
  return doc;
};

export const readEpub = async (
  source: DocumentInput,
): Promise<DocumentReader> => {
  const { default: epub } = await import("epubjs");
  const book = epub(await (await documentBlob(source)).arrayBuffer(), {
    replacements: "base64",
  });
  try {
    await book.ready;
    const navigation = await book.loaded.navigation;
    const outline: DocumentOutline[] = [];
    type Toc = typeof navigation.toc;
    const walk = (items: Toc, depth: number) => {
      for (const item of items) {
        const section = book.section(item.href.split("#")[0]);
        if (section) {
          outline.push({
            title: item.label.trim(),
            index: section.index,
            depth,
          });
        }
        if (item.subitems) {
          walk(item.subitems, depth + 1);
        }
      }
    };
    walk(navigation.toc, 0);
    const pages: DocumentReader["pages"] = [];
    book.spine.each((section: ReturnType<typeof book.section>) => {
      if (!section.linear) {
        return;
      }
      pages.push({
        index: section.index,
        name:
          outline.find((entry) => entry.index === section.index)?.title ||
          String(pages.length + 1),
      });
    });
    return {
      pages,
      showThumbnails: false,
      outline: async () => outline,
      render: async (index, _width, signal) => {
        signal?.throwIfAborted();
        const section = book.section(index);
        try {
          const page = localContent(await section.render(book.load.bind(book)));
          signal?.throwIfAborted();
          const styles = Array.from(
            page.querySelectorAll("style"),
            (style) => style.outerHTML,
          ).join("");
          return {
            ratio: 0,
            html: documentMarkup(page.body.innerHTML, styles),
            text: page.body.textContent || "",
          };
        } finally {
          section.unload();
        }
      },
      close: () => book.destroy(),
    };
  } catch (error) {
    book.destroy();
    throw error;
  }
};

export const readParquet = async (
  source: DocumentInput,
): Promise<DocumentReader> => {
  const {
    asyncBufferFromUrl,
    parquetMetadataAsync,
    parquetSchema,
    parquetReadObjects,
  } = await import("hyparquet");
  const file = isNativeDocumentInput(source)
    ? await asyncBufferFromUrl({
        url: nativeDocumentUrl(source),
        byteLength: source.size,
      })
    : {
        byteLength: source.size,
        slice: (start: number, end?: number) =>
          source.slice(start, end).arrayBuffer(),
      };
  const metadata = await parquetMetadataAsync(file);
  const columns = parquetSchema(metadata).children.map(
    ({ element }) => element.name,
  );
  const rows = Number(metadata.num_rows);
  const step = 80;
  return {
    pages: Array.from(
      { length: Math.max(1, Math.ceil(rows / step)) },
      (_, index) => ({
        index,
        name: String(index + 1),
      }),
    ),
    showThumbnails: false,
    render: async (index, _width, signal) => {
      signal?.throwIfAborted();
      const data = rows
        ? await parquetReadObjects({
            file,
            metadata,
            rowStart: index * step,
            rowEnd: Math.min(rows, (index + 1) * step),
          })
        : [];
      signal?.throwIfAborted();
      const text = (value: unknown) =>
        value == null
          ? ""
          : typeof value === "object"
          ? JSON.stringify(value, (_key, item) =>
              typeof item === "bigint" ? item.toString() : item,
            )
          : String(value);
      const table = document.createElement("table");
      const headers = table.createTHead().insertRow();
      for (const title of columns) {
        const cell = document.createElement("th");
        cell.textContent = title;
        headers.append(cell);
      }
      const body = table.createTBody();
      for (const row of data) {
        const cells = body.insertRow();
        for (const column of columns) {
          cells.insertCell().textContent = text(row[column]);
        }
      }
      return {
        ratio: 0,
        html: documentMarkup(table.outerHTML),
        text: table.textContent || "",
      };
    },
    close() {},
  };
};

export const readMarkdown = async (
  source: DocumentInput,
): Promise<DocumentReader> => {
  const { default: MarkdownIt } = await import("markdown-it");
  const text = await (await documentBlob(source)).text();
  const page = localContent(new MarkdownIt({ html: false }).render(text));
  return {
    pages: [{ index: 0, name: source.name }],
    showThumbnails: false,
    render: async () => ({
      ratio: 0,
      html: documentMarkup(page.body.innerHTML),
      text,
    }),
    close() {},
  };
};
