import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { FONT_FAMILY, FONT_METADATA } from "@fcboard/common";
import { Fonts } from "@fcboard/fcboard/fonts";
import { FcboardFontFace } from "@fcboard/fcboard/fonts/FcboardFontFace";

it("ships the exact reference handwriting font with its measured metrics as a private insertion face", async () => {
  const asset = await readFile(
    resolve("packages/fcboard/fonts/FactoryHandwriting/hw.ttf"),
  );
  expect(createHash("sha256").update(asset).digest("hex")).toBe(
    "6c4f2b8692ca638c0103b47f8819480aaf0c6094775baf8da9c333c1eb5a08c4",
  );
  const font = Fonts.registered.get(FONT_FAMILY.FactoryHandwriting)!;
  expect(font.metadata.private).toBe(true);
  expect(font.fontFaces).toHaveLength(1);
  const tables = new Map<string, number>();
  for (let index = 0; index < asset.readUInt16BE(4); index++) {
    const entry = 12 + index * 16;
    tables.set(
      asset.toString("ascii", entry, entry + 4),
      asset.readUInt32BE(entry + 8),
    );
  }
  const metadata = FONT_METADATA[FONT_FAMILY.FactoryHandwriting].metrics;
  expect(metadata.unitsPerEm).toBe(
    asset.readUInt16BE(tables.get("head")! + 18),
  );
  expect(metadata.ascender).toBe(asset.readInt16BE(tables.get("hhea")! + 4));
  expect(metadata.descender).toBe(asset.readInt16BE(tables.get("hhea")! + 6));
});

it("embeds the real TrueType bytes for PNG/SVG export without feeding them into a WOFF2-only decoder", async () => {
  const asset = await readFile(
    resolve("packages/fcboard/fonts/FactoryHandwriting/hw.ttf"),
  );
  const face = new FcboardFontFace(
    "FactoryHandwriting",
    "/FactoryHandwriting/hw.ttf",
  );
  const fetchFont = vi
    .spyOn(face, "fetchFont")
    .mockResolvedValue(
      asset.buffer.slice(
        asset.byteOffset,
        asset.byteOffset + asset.byteLength,
      ) as ArrayBuffer,
    );
  try {
    const css = await face.toCSS("Hello");
    expect(css).toContain("font-family: FactoryHandwriting");
    const base64 = /data:font\/ttf;base64,([^)]*)/.exec(css!)![1];
    expect(Buffer.from(base64, "base64")).toEqual(asset);
  } finally {
    fetchFont.mockRestore();
  }
});
