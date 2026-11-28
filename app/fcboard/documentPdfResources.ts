const cmaps = import.meta.glob<string>(
  "../node_modules/pdfjs-dist/cmaps/*.bcmap",
  {
    exhaustive: true,
    query: "?url",
    import: "default",
  },
);
const fonts = import.meta.glob<string>(
  "../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}",
  {
    exhaustive: true,
    query: "?url",
    import: "default",
  },
);

const bytes = async (file: (() => Promise<string>) | undefined) => {
  if (!file) {
    throw new Error("PDF font resource not found");
  }
  const reply = await fetch(await file());
  if (!reply.ok) {
    throw new Error("PDF font resource could not be loaded");
  }
  return new Uint8Array(await reply.arrayBuffer());
};

export class DocumentCMapReader {
  async fetch({ name }: { name: string }) {
    return {
      cMapData: await bytes(
        cmaps[`../node_modules/pdfjs-dist/cmaps/${name}.bcmap`],
      ),
      compressionType: 1,
    };
  }
}

export class DocumentStandardFontReader {
  fetch({ filename }: { filename: string }) {
    return bytes(
      fonts[`../node_modules/pdfjs-dist/standard_fonts/${filename}`],
    );
  }
}
