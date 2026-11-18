import { t } from "@fcboard/fcboard/i18n";
import { strToU8 } from "fflate";

import { importNamelist } from "./namelistImport";
import { parseNamelistFile } from "./namelistData";

const file = () => {
  const bytes = strToU8("姓名,班级\n张三,一班");
  const value = new File([bytes], "names.csv");
  Object.defineProperty(value, "arrayBuffer", {
    value: async () => bytes.buffer,
  });
  return value;
};
const worker = () => {
  const instance = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: undefined as ((event: MessageEvent) => void) | undefined,
    onmessageerror: undefined as (() => void) | undefined,
    onerror: undefined as ((event: ErrorEvent) => void) | undefined,
  };
  const create = vi.fn(() => instance);
  vi.stubGlobal("Worker", create);
  return { instance, create };
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("transfers the real file to a per-request module worker and returns its actual parsed names", async () => {
  const { instance, create } = worker();
  const result = importNamelist(file(), new AbortController().signal);
  await Promise.resolve();
  expect(create).toHaveBeenCalledWith(expect.any(URL), { type: "module" });
  const [message, transfer] = instance.postMessage.mock.calls[0];
  expect(transfer).toEqual([message.bytes]);
  instance.onmessage?.({
    data: {
      tables: parseNamelistFile(new Uint8Array(message.bytes), message.name),
    },
  } as MessageEvent);
  expect(await result).toEqual([
    {
      name: "names.csv",
      rows: [
        ["姓名", "班级"],
        ["张三", "一班"],
      ],
    },
  ]);
  expect(instance.terminate).toHaveBeenCalledTimes(1);
});
it("terminates immediately on cancellation and ignores a late result", async () => {
  const { instance } = worker();
  const controller = new AbortController();
  const result = importNamelist(file(), controller.signal);
  const failure = expect(result).rejects.toMatchObject({ name: "AbortError" });
  await Promise.resolve();
  controller.abort();
  await failure;
  expect(instance.terminate).toHaveBeenCalledTimes(1);
  instance.onmessage?.({
    data: { tables: [{ name: "late", rows: [["Late"]] }] },
  } as MessageEvent);
  expect(instance.terminate).toHaveBeenCalledTimes(1);
});
it("terminates a stalled import within its bound and clears the worker timer", async () => {
  vi.useFakeTimers();
  const { instance } = worker();
  const result = importNamelist(file(), new AbortController().signal);
  const failure = expect(result).rejects.toThrow(
    t("fcboard.namelistImport.invalid"),
  );
  await vi.advanceTimersByTimeAsync(10000);
  await failure;
  expect(instance.terminate).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it("rejects unsupported formats and worker submission failures without leaving a worker running", async () => {
  const { instance } = worker();
  const result = importNamelist(file(), new AbortController().signal);
  await Promise.resolve();
  instance.onmessage?.({ data: { error: "namelist_format" } } as MessageEvent);
  await expect(result).rejects.toThrow(t("fcboard.namelistImport.format"));
  expect(instance.terminate).toHaveBeenCalledTimes(1);
  instance.postMessage.mockImplementation(() => {
    throw new Error("post failed");
  });
  await expect(
    importNamelist(file(), new AbortController().signal),
  ).rejects.toThrow();
  expect(instance.terminate).toHaveBeenCalledTimes(2);
});
it("does not allocate a worker for an empty/oversize file or already cancelled request", async () => {
  const { create } = worker();
  await expect(
    importNamelist(new File([], "empty.txt"), new AbortController().signal),
  ).rejects.toThrow();
  const large = file();
  Object.defineProperty(large, "size", { value: 9 * 1024 * 1024 });
  await expect(
    importNamelist(large, new AbortController().signal),
  ).rejects.toThrow();
  const controller = new AbortController();
  controller.abort();
  await expect(importNamelist(file(), controller.signal)).rejects.toMatchObject(
    { name: "AbortError" },
  );
  expect(create).not.toHaveBeenCalled();
});

it("reports unavailable background import without falling back to parsing on the drawing thread", async () => {
  vi.stubGlobal("Worker", undefined);
  await expect(
    importNamelist(file(), new AbortController().signal),
  ).rejects.toThrow(t("fcboard.namelistImport.invalid"));
});
