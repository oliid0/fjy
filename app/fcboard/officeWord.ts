import JSZip from "jszip";

import { documentBlob } from "./documentReader";

import type { DocumentInput } from "./documentInput";

const main = "word/document.xml";
const rels = "word/_rels/document.xml.rels";
const types = "[Content_Types].xml";
const xml = (value: string) =>
  new DOMParser().parseFromString(value, "application/xml");
const serialize = (value: Document) =>
  new XMLSerializer().serializeToString(value);
const list = (value: Document | Element, name: string) =>
  Array.from(value.getElementsByTagNameNS("*", name));
const part = async (zip: JSZip, path: string) => {
  const value = await zip.file(path)?.async("string");
  if (!value) {
    throw new Error(`Missing Word package part ${path}`);
  }
  const root = xml(value);
  if (root.querySelector("parsererror")) {
    throw new Error(`Invalid Word package part ${path}`);
  }
  return root;
};
const textParts = async (input: Blob) => {
  const archive = await JSZip.loadAsync(input);
  return list(await part(archive, main), "t")
    .map((node) => node.textContent || "")
    .join(" ");
};
export const wordText = textParts;

const bodyBlocks = (doc: Document) => {
  const body = list(doc, "body")[0];
  if (!body) {
    throw new Error("Missing Word document body");
  }
  return {
    body,
    blocks: Array.from(body.children).filter(
      (node) => node.localName !== "sectPr",
    ),
  };
};

/** Match the native segment boundaries without moving untouched Word body blocks. */
const segmentsOf = (blocks: Element[]) => {
  const segments: Element[][] = [[]];
  let segment = segments[0];
  for (const block of blocks) {
    if (
      segment.length &&
      (segment.length >= 24 || list(block, "pageBreakBefore").length)
    ) {
      segment = [];
      segments.push(segment);
    }
    segment.push(block);
    if (
      list(block, "lastRenderedPageBreak").length ||
      list(block, "br").some((node) => node.getAttribute("w:type") === "page")
    ) {
      segment = [];
      segments.push(segment);
    }
  }
  if (segments.length > 1 && !segment.length) {
    segments.pop();
  }
  return segments;
};

const packagePath = (target: string) =>
  decodeURIComponent(
    new URL(target, "https://office.local/word/document.xml").pathname,
  ).slice(1);

const mergeMedia = async (
  archive: JSZip,
  changed: JSZip,
  relations: Document,
  contentTypes: Document,
  editedBlocks: Element[],
  index: number,
) => {
  if (!changed.file(rels)) {
    return;
  }
  const source = list(await part(changed, rels), "Relationship");
  const incomingTypes = await part(changed, types);
  const urls = new Map<string, string>();
  for (const block of editedBlocks) {
    for (const element of [
      block,
      ...Array.from(block.getElementsByTagName("*")),
    ]) {
      for (const attribute of Array.from(element.attributes)) {
        if (!attribute.namespaceURI?.endsWith("/relationships")) {
          continue;
        }
        const before = attribute.value;
        if (!urls.has(before)) {
          const relation = source.find(
            (item) => item.getAttribute("Id") === before,
          );
          const target = relation?.getAttribute("Target");
          if (!relation || !target) {
            continue;
          }
          const external = relation.getAttribute("TargetMode") === "External";
          const existing = list(relations, "Relationship").find(
            (item) => item.getAttribute("Id") === before,
          );
          if (
            existing?.getAttribute("Target") === target &&
            !relation.getAttribute("Type")?.endsWith("/image")
          ) {
            urls.set(before, before);
            continue;
          }
          const copy = relations.importNode(relation, true);
          const id = `rIdFcPage${index}_${urls.size}`;
          copy.setAttribute("Id", id);
          if (!external) {
            const path = packagePath(target);
            const asset = changed.file(path);
            if (!asset) {
              throw new Error("Missing edited Word attachment");
            }
            const extension = path.split(".").at(-1) || "bin";
            const entry = `media/fc-page-${index}-${urls.size}.${extension}`;
            copy.setAttribute("Target", entry);
            archive.file(`word/${entry}`, await asset.async("uint8array"));
            const type = list(incomingTypes, "Default").find(
              (item) => item.getAttribute("Extension") === extension,
            );
            if (
              type &&
              !list(contentTypes, "Default").some(
                (item) => item.getAttribute("Extension") === extension,
              )
            ) {
              contentTypes.documentElement.append(
                contentTypes.importNode(type, true),
              );
            }
          }
          relations.documentElement.append(copy);
          urls.set(before, id);
        }
        attribute.value = urls.get(before) || before;
      }
    }
  }
};

/** Read the original package only when the user explicitly saves an edited document. */
export const editedWord = async (
  input: DocumentInput,
  edits: ReadonlyMap<number, Blob>,
) => {
  const archive = await JSZip.loadAsync(await documentBlob(input));
  const source = await part(archive, main);
  const { body, blocks } = bodyBlocks(source);
  const segments = segmentsOf(blocks);
  const relationships = archive.file(rels)
    ? await part(archive, rels)
    : xml(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
      );
  const content = await part(archive, types);
  for (const [index, buffer] of edits) {
    const previous = segments[index];
    if (!previous) {
      throw new Error("Edited Word section is unavailable");
    }
    const updated = await JSZip.loadAsync(buffer);
    const { blocks } = bodyBlocks(await part(updated, main));
    await mergeMedia(archive, updated, relationships, content, blocks, index);
    const before =
      previous[0] ??
      Array.from(body.children).find((node) => node.localName === "sectPr") ??
      null;
    for (const node of blocks) {
      body.insertBefore(source.importNode(node, true), before);
    }
    for (const node of previous) {
      node.remove();
    }
  }
  archive.file(main, serialize(source));
  archive.file(rels, serialize(relationships));
  archive.file(types, serialize(content));
  return archive.generateAsync({ type: "blob", compression: "DEFLATE" });
};
