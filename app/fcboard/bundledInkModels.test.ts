import manifest from "../../scripts/ink-models.json";

/** Decode the SDK's actual persisted protobuf envelope, so registry paths and
 * checksums cannot silently diverge from the files packed in the application. */
const fields = (buffer: Buffer) => {
  let offset = 0;
  const read = () => {
    let value = 0;
    let shift = 0;
    while (offset < buffer.length) {
      const byte = buffer[offset++];
      value += (byte & 127) * 2 ** shift;
      if (byte < 128) {
        return value;
      }
      shift += 7;
    }
    throw new Error("Truncated model metadata");
  };
  const values: { field: number; value: number | Buffer }[] = [];
  while (offset < buffer.length) {
    const key = read();
    const wire = key % 8;
    let value: number | Buffer;
    if (wire === 0) {
      value = read();
    } else if (wire === 2) {
      const length = read();
      if (offset + length > buffer.length) {
        throw new Error("Invalid model metadata length");
      }
      value = buffer.subarray(offset, offset + length);
      offset += length;
    } else {
      throw new Error("Unexpected model metadata wire type");
    }
    values.push({ field: Math.floor(key / 8), value });
  }
  return values;
};
const decode = (value: string) => fields(Buffer.from(value, "base64"));

it("registers every model group for this package and maps each downloaded archive to a pinned bundled file", () => {
  const groups =
    manifest.preferences.gms_icing_mdd_groupsmlkit_digital_ink_recognition;
  const shared: Record<string, string> =
    manifest.preferences
      .gms_icing_mdd_shared_filesmlkit_digital_ink_recognition;
  const tags: string[] = [];
  for (const [key, value] of Object.entries(groups)) {
    const index = decode(key);
    const group = decode(value);
    const tag = group.find((item) => item.field === 1)!.value.toString();
    tags.push(tag);
    expect(index.find((item) => item.field === 1)?.value.toString()).toBe(tag);
    expect(index.find((item) => item.field === 2)?.value.toString()).toBe(
      manifest.package,
    );
    expect(group.find((item) => item.field === 6)?.value.toString()).toBe(
      manifest.package,
    );
    for (const item of group.filter((item) => item.field === 2)) {
      expect(Buffer.isBuffer(item.value)).toBe(true);
      const file = fields(item.value as Buffer);
      const hash = file.find((field) => field.field === 14)!.value.toString();
      const pin = manifest.files.find((pin) => pin.archiveSha1 === hash)!;
      expect(pin).toBeDefined();
      expect(file.find((field) => field.field === 2)?.value.toString()).toBe(
        pin.url,
      );
      expect(pin.sha256).toMatch(/^[a-f0-9]{64}$/);
      const directory = decode(shared[`${hash}|0`])
        .find((field) => field.field === 4)!
        .value.toString();
      expect(pin.path.split("/").at(-2)).toBe(directory);
    }
  }
  expect(tags.sort()).toEqual([
    "en-US",
    "zh-Hani-CN",
    "zxx-Zsye-x-emoji",
    "zxx-Zsym-x-shapes",
  ]);
  expect(manifest.version).toBe(3);
  expect(manifest.files.filter((file) => /emoji/.test(file.path))).toHaveLength(
    2,
  );
});
