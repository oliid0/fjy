import { Scene, newElementWith, syncInvalidIndices } from "@fcboard/element";
import { API } from "@fcboard/fcboard/tests/helpers/api";

it("publishes version deltas for commits, in-place edits, deletion and restoration", () => {
  const first = API.createElement({ type: "freedraw" });
  const other = API.createElement({ type: "freedraw" });
  const scene = new Scene(syncInvalidIndices([first, other]));
  const listener = vi.fn();
  const stop = scene.onMutation(listener);
  expect(listener).toHaveBeenLastCalledWith(
    scene.getElementsIncludingDeleted(),
    [],
  );
  listener.mockClear();
  const current = scene.getElement(first.id)!;
  scene.mutateElement(current, { x: 40 });
  expect(listener).toHaveBeenLastCalledWith([current], []);
  const moved = newElementWith(current, { x: 80 });
  scene.replaceAllElements([moved, scene.getElement(other.id)!]);
  expect(listener).toHaveBeenLastCalledWith([moved], []);
  scene.replaceAllElements([moved]);
  expect(listener).toHaveBeenLastCalledWith([], [other.id]);
  const deleted = newElementWith(moved, { isDeleted: true });
  scene.replaceAllElements([deleted]);
  expect(listener).toHaveBeenLastCalledWith([deleted], []);
  scene.replaceAllElements([moved]);
  expect(listener).toHaveBeenLastCalledWith([moved], []);
  listener.mockClear();
  scene.triggerUpdate();
  expect(listener).not.toHaveBeenCalled();
  stop();
  scene.destroy();
});

it("audits legacy direct mutations and initializes late subscribers with current objects", () => {
  const scene = new Scene(
    syncInvalidIndices([API.createElement({ type: "freedraw" })]),
  );
  const listener = vi.fn();
  const stop = scene.onMutation(listener);
  const element = scene.getElementsIncludingDeleted()[0];
  // Low-level callers can modify in place and trigger a generic update.
  Object.assign(element, { x: 100, version: element.version + 1 });
  scene.triggerUpdate();
  expect(listener).toHaveBeenLastCalledWith([element], []);
  stop();
  const later = vi.fn();
  scene.onMutation(later);
  expect(later).toHaveBeenCalledWith([element], []);
  scene.destroy();
});
