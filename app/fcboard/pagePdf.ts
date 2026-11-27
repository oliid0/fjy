/** ISO 32000-1 §§7.5, 7.7 and 8.9. Embed each canvas JPEG as an image XObject. */
export const rasterPagesPdf = async (
  pages: readonly Blob[],
  signal?: AbortSignal,
): Promise<Blob> => {
  const parts: BlobPart[] = [];
  const offsets = [0];
  const ascii = new TextEncoder();
  let length = 0;
  const append = (part: string | Blob | Uint8Array<ArrayBuffer>) => {
    const bytes = typeof part === "string" ? ascii.encode(part) : part;
    parts.push(bytes);
    length += bytes instanceof Blob ? bytes.size : bytes.byteLength;
  };
  const object = (id: number, ...body: (string | Blob)[]) => {
    offsets[id] = length;
    append(`${id} 0 obj\n`);
    body.forEach(append);
    append("\nendobj\n");
  };

  append("%PDF-1.4\n");
  append(new Uint8Array([37, 226, 227, 207, 211, 10]));
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  const kids = pages.map((_, index) => `${3 + index * 3} 0 R`);
  object(
    2,
    `<< /Type /Pages /Count ${kids.length} /Kids [${kids.join(" ")}] >>`,
  );
  for (const [index, jpeg] of pages.entries()) {
    signal?.throwIfAborted();
    const bitmap = await createImageBitmap(jpeg);
    const { width, height } = bitmap;
    bitmap.close();
    signal?.throwIfAborted();
    const page = 3 + index * 3;
    const image = page + 1;
    const contents = page + 2;
    const landscape = width > height;
    const pageWidth = landscape ? 842 : 595;
    const pageHeight = landscape ? 595 : 842;
    const scale = Math.min(
      (pageWidth - 60) / width,
      (pageHeight - 60) / height,
    );
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    const draw = [
      drawWidth,
      0,
      0,
      drawHeight,
      (pageWidth - drawWidth) / 2,
      (pageHeight - drawHeight) / 2,
    ]
      .map((number) => number.toFixed(4))
      .join(" ");
    const stream = `q\n${draw} cm\n/Board Do\nQ\n`;
    object(
      page,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Board ${image} 0 R >> >> /Contents ${contents} 0 R >>`,
    );
    object(
      image,
      `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.size} >>\nstream\n`,
      jpeg,
      "\nendstream",
    );
    object(
      contents,
      `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    );
  }
  const startXref = length;
  append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1)) {
    append(`${String(offset).padStart(10, "0")} 00000 n \n`);
  }
  append(
    `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`,
  );
  return new Blob(parts, { type: "application/pdf" });
};
