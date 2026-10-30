import { arrayToMap } from "@fcboard/common";
import { type GlobalPoint, type LocalPoint, pointFrom } from "@fcboard/math";
import { Fcboard } from "@fcboard/fcboard";
import { API } from "@fcboard/fcboard/tests/helpers/api";
import { UI } from "@fcboard/fcboard/tests/helpers/ui";
import "@fcboard/utils/test-utils";
import { render } from "@fcboard/fcboard/tests/test-utils";

import * as distance from "../src/distance";
import { hitElementItself } from "../src/collision";

it.each([0, Math.PI / 2])(
  "selects the displayed factory curve rather than an unrelated spline at angle %s",
  (angle) => {
    const element = {
      ...API.createElement({
        type: "freedraw",
        points: [
          pointFrom<LocalPoint>(0, 0),
          pointFrom<LocalPoint>(100, 200),
          pointFrom<LocalPoint>(200, 0),
        ],
        angle,
      }),
      customData: { fcInk: { version: 2, pen: "hard", unit: 1 } },
    };
    const hit = (x: number, y: number) =>
      hitElementItself({
        point: pointFrom<GlobalPoint>(
          100 + (x - 100) * Math.cos(angle) - (y - 100) * Math.sin(angle),
          100 + (x - 100) * Math.sin(angle) + (y - 100) * Math.cos(angle),
        ),
        element,
        threshold: 2,
        elementsMap: arrayToMap([element]),
      });
    expect(hit(100, 150)).toBe(true);
    expect(hit(100, 200)).toBe(false);
  },
);

it("lets a factory ink dot be selected", () => {
  const element = {
    ...API.createElement({
      type: "freedraw",
      x: 100,
      y: 200,
      points: [pointFrom<LocalPoint>(0, 0)],
    }),
    customData: { fcInk: { version: 2, pen: "hard", unit: 1 } },
  };
  expect(
    hitElementItself({
      point: pointFrom<GlobalPoint>(100, 200),
      element,
      threshold: 2,
      elementsMap: arrayToMap([element]),
    }),
  ).toBe(true);
});

describe("check rotated elements can be hit:", () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(<Fcboard handleKeyboardGlobally={true} />);
  });

  it("arrow", () => {
    UI.createElement("arrow", {
      x: 0,
      y: 0,
      width: 124,
      height: 302,
      angle: 1.8700426423973724,
      points: [
        [0, 0],
        [120, -198],
        [-4, -302],
      ] as LocalPoint[],
    });
    const hit = hitElementItself({
      point: pointFrom<GlobalPoint>(88, -68),
      element: window.h.elements[0],
      threshold: 10,
      elementsMap: window.h.scene.getNonDeletedElementsMap(),
    });
    expect(hit).toBe(true);
  });
});

describe("hitElementItself cache", () => {
  beforeEach(async () => {
    // reset cache
    hitElementItself({
      point: pointFrom<GlobalPoint>(50, 50),
      element: API.createElement({
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        backgroundColor: "#ffffff",
      }),
      threshold: Infinity,
      elementsMap: new Map([]),
    });

    localStorage.clear();
    await render(<Fcboard handleKeyboardGlobally={true} />);
  });

  it("reuses cached result when threshold increases", () => {
    const element = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      backgroundColor: "#ffffff",
    });
    const elementsMap = arrayToMap([element]);
    const point = pointFrom<GlobalPoint>(100.5, 50);

    const distanceSpy = jest.spyOn(distance, "distanceToElement");

    expect(
      hitElementItself({
        point,
        element,
        threshold: 1,
        elementsMap,
      }),
    ).toBe(true);

    expect(distanceSpy).toHaveBeenCalledTimes(1);

    expect(
      hitElementItself({
        point,
        element,
        threshold: 10,
        elementsMap,
      }),
    ).toBe(true);

    expect(distanceSpy).toHaveBeenCalledTimes(1);

    distanceSpy.mockRestore();
  });

  it("does not reuse cache when threshold decreases", () => {
    const element = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      backgroundColor: "transparent",
    });
    const elementsMap = arrayToMap([element]);
    const point = pointFrom<GlobalPoint>(105, 50);

    const distanceSpy = jest.spyOn(distance, "distanceToElement");

    expect(
      hitElementItself({
        point,
        element,
        threshold: 10,
        elementsMap,
      }),
    ).toBe(true);

    expect(distanceSpy).toHaveBeenCalledTimes(1);

    expect(
      hitElementItself({
        point,
        element,
        threshold: 6,
        elementsMap,
      }),
    ).toBe(true);

    expect(distanceSpy).toHaveBeenCalledTimes(2);
    distanceSpy.mockRestore();
  });

  it("invalidates cache when element version changes", () => {
    const element = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      backgroundColor: "#ffffff",
    });
    const elementsMap = arrayToMap([element]);
    const point = pointFrom<GlobalPoint>(100.5, 50);

    const distanceSpy = jest.spyOn(distance, "distanceToElement");

    expect(
      hitElementItself({
        point,
        element,
        threshold: 1,
        elementsMap,
      }),
    ).toBe(true);

    expect(distanceSpy).toHaveBeenCalledTimes(1);

    const movedElement = {
      ...element,
      version: element.version + 1,
      versionNonce: element.versionNonce + 1,
    };

    expect(
      hitElementItself({
        point,
        element: movedElement,
        threshold: 1,
        elementsMap,
      }),
    ).toBe(true);

    expect(distanceSpy).toHaveBeenCalledTimes(2);
    distanceSpy.mockRestore();
  });

  it("override does not affect caching", () => {
    const element = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      backgroundColor: "transparent",
    });
    const elementsMap = arrayToMap([element]);
    const point = pointFrom<GlobalPoint>(50, 50);

    const distanceSpy = jest.spyOn(distance, "distanceToElement");

    expect(
      hitElementItself({
        point,
        element,
        threshold: 10,
        elementsMap,
      }),
    ).toBe(false);

    expect(distanceSpy).toHaveBeenCalledTimes(1);

    expect(
      hitElementItself({
        point,
        element,
        threshold: 10,
        elementsMap,
        overrideShouldTestInside: true,
      }),
    ).toBe(true);
  });
});
