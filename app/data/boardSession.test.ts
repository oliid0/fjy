import { getDefaultAppState } from "@fcboard/fcboard/appState";
import { newFreeDrawElement } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";

import { STORAGE_KEYS } from "../app_constants";

const platform = vi.hoisted(() => ({ getPlatform: vi.fn() }));
const workspace = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("@capacitor/core", async (original) => ({
  ...(await original<typeof import("@capacitor/core")>()),
  Capacitor: platform,
}));
vi.mock("idb-keyval", async (original) => ({
  ...(await original<typeof import("idb-keyval")>()),
  get: workspace.get,
  set: workspace.set,
}));
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  platform.getPlatform.mockReturnValue("android");
  workspace.get.mockReset();
  workspace.set.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("opens a fresh Android board without parsing old ink or opening the scratch workspace", async () => {
  localStorage.setItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS, "invalid old ink");
  localStorage.setItem(
    STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
    JSON.stringify({
      currentItemStrokeColor: "#ff0000",
      scrollX: 500,
      scrollY: -500,
      zoom: { value: 2 },
    }),
  );
  const read = vi.spyOn(Storage.prototype, "getItem");
  const { importFromLocalStorage } = await import("./localStorage");
  const { readWorkspace } = await import("../fcboard/boards");
  const scene = importFromLocalStorage();
  expect(scene.elements).toEqual([]);
  expect(scene.appState).toMatchObject({
    currentItemStrokeColor: "#ff0000",
    scrollX: 0,
    scrollY: 0,
    zoom: { value: 1 },
  });
  expect(read).not.toHaveBeenCalledWith(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS);
  expect(await readWorkspace()).toBeUndefined();
  expect(workspace.get).not.toHaveBeenCalled();
});

it("consumes explicit saved exit once per document; another process starts fresh", async () => {
  const session = await import("./boardSession");
  session.markSavedBoardExit();
  expect(session.shouldRestoreBoardSession()).toBe(true);
  expect(session.shouldRestoreBoardSession()).toBe(true);
  expect(localStorage.getItem("fcboard-saved-exit")).toBeNull();
  vi.resetModules();
  expect((await import("./boardSession")).shouldRestoreBoardSession()).toBe(
    false,
  );
});

it("keeps Android page switching in memory and only writes an explicit exit snapshot", async () => {
  const { readWorkspace, writeWorkspace } = await import("../fcboard/boards");
  const value = { active: "empty", boards: [] };
  await writeWorkspace(value);
  expect(await readWorkspace()).toBe(value);
  expect(workspace.set).not.toHaveBeenCalled();
  await writeWorkspace(value, true);
  expect(workspace.set).toHaveBeenCalledTimes(1);
});

it("fails fresh when local storage access is blocked and retains browser restoration", async () => {
  const session = await import("./boardSession");
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  expect(session.shouldRestoreBoardSession()).toBe(false);
  platform.getPlatform.mockReturnValue("web");
  expect(session.shouldRestoreBoardSession()).toBe(true);
});

it("does not serialize scratch ink during pauses but preserves the explicit exit scene", async () => {
  vi.useFakeTimers();
  const { LocalData } = await import("./LocalData");
  const files = vi
    .spyOn(LocalData.fileStorage, "saveFiles")
    .mockResolvedValue({ savedFiles: new Map(), erroredFiles: new Map() });
  const ink = newFreeDrawElement({
    x: 20,
    y: 20,
    points: [pointFrom(0, 0), pointFrom(100, 0)],
    pressures: [],
    simulatePressure: true,
  });
  const state = getDefaultAppState();
  const saved = vi.fn();
  LocalData.save([ink], state, {}, saved);
  await vi.runOnlyPendingTimersAsync();
  expect(saved).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS)).toBe("[]");
  expect(files).toHaveBeenCalledWith({ elements: [ink], files: {} });
  await LocalData.saveForExit([ink], state, {});
  expect(
    JSON.parse(localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS)!),
  ).toMatchObject([{ id: ink.id }]);
  expect(localStorage.getItem("fcboard-saved-exit")).toBeNull();
});

it("rejects an actual explicit save storage failure without granting resume intent", async () => {
  const { LocalData } = await import("./LocalData");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("full", "QuotaExceededError");
  });
  await expect(
    LocalData.saveForExit([], getDefaultAppState(), {}),
  ).rejects.toThrow("full");
  expect(localStorage.getItem("fcboard-saved-exit")).toBeNull();
});
