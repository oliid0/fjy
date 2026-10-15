import { crc32c, verifyModel } from "../../scripts/fetch-speech-models.mjs";

describe("offline model integrity", () => {
  it("matches the standard CRC32C vector and rejects a truncated/corrupted asset", () => {
    const bytes = Buffer.from("123456789");
    expect(crc32c(bytes)).toBe("4waSgw==");
    const spec = { size: bytes.length, crc32c: "4waSgw==" };
    expect(verifyModel(bytes, spec)).toBe(true);
    expect(verifyModel(bytes.subarray(1), spec)).toBe(false);
    expect(verifyModel(Buffer.from("123456780"), spec)).toBe(false);
  });
});
