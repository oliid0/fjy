import {
  ScrcpyOptions3_3_1,
  ScrcpyControlMessageSerializer,
  AndroidMotionEventAction,
} from "@yume-chan/scrcpy";

import { screenPoint } from "./remoteControl";

it("maps a letterboxed touch and serializes it with the actual matching Scrcpy protocol", () => {
  const position = screenPoint(
    200,
    200,
    { left: 0, top: 0, width: 400, height: 400 },
    1280,
    720,
  );
  expect(position.pointerX).toBe(640);
  expect(position.pointerY).toBe(360);
  const serializer = new ScrcpyControlMessageSerializer(
    new ScrcpyOptions3_3_1({}),
  );
  const bytes = serializer.injectTouch({
    ...position,
    action: AndroidMotionEventAction.Down,
    pointerId: 1n,
    pressure: 1,
    actionButton: 0,
    buttons: 1,
  });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(bytes[0]).toBe(2);
  expect(view.getUint32(10)).toBe(640);
  expect(view.getUint32(14)).toBe(360);
  expect(view.getUint16(18)).toBe(1280);
  expect(view.getUint16(20)).toBe(720);
});
it("keeps the edge of a captured drag inside the device after rotation", () => {
  const point = screenPoint(
    -20,
    800,
    { left: 0, top: 0, width: 400, height: 400 },
    720,
    1280,
  );
  expect(point.pointerX).toBe(0);
  expect(point.pointerY).toBe(1279);
});
