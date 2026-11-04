import { transparentInkImage } from "./transparentInkImage";

import type { SubjectLayer } from "./transparentInkImage";

const layer = (zIndex = 1, left = 10): SubjectLayer => ({
  image: { naturalWidth: 100, naturalHeight: 50 } as HTMLImageElement,
  zIndex,
  bounds: { left, top: 20, right: left + 100, bottom: 70 },
});
const setup = (alpha = [255, 0]) => {
  const contexts: { drawImage: ReturnType<typeof vi.fn> }[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    const context = {
      drawImage: vi.fn(),
      getImageData: () => ({
        data: new Uint8ClampedArray(alpha.flatMap((a) => [255, 255, 255, a])),
      }),
    };
    contexts.push(context);
    return context as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;base64,composed",
  );
  return contexts;
};
afterEach(() => vi.restoreAllMocks());

it("composes only foreground layers in z order at their documented bounds, preserving white pixels", () => {
  const contexts = setup();
  const back = layer(1);
  const front = layer(2, 60);
  const output = transparentInkImage([front, back]);
  expect(output).toEqual({
    dataURL: "data:image/png;base64,composed",
    width: 150,
    height: 50,
  });
  expect(contexts[0].drawImage.mock.calls).toEqual([
    [back.image, 0, 0, 100, 50],
    [front.image, 50, 0, 100, 50],
  ]);
});

it.each([
  [255, 255],
  [0, 0],
])("rejects opaque or empty layers with alpha %j", (...alpha) => {
  const contexts = setup(alpha);
  expect(() => transparentInkImage([layer()])).toThrow();
  expect(contexts[0].drawImage).not.toHaveBeenCalled();
});

it("rejects base layers, repeated z indices and invalid bounds", () => {
  setup();
  for (const layers of [
    [],
    [layer(0)],
    [layer(), layer()],
    [{ ...layer(), bounds: { left: 100, top: 0, right: 0, bottom: 50 } }],
  ]) {
    expect(() => transparentInkImage(layers)).toThrow();
  }
});

it("caps composition and alpha sampling for large subjects", () => {
  const contexts = setup();
  const subject = layer();
  subject.bounds = { left: 0, top: 0, right: 8000, bottom: 4000 };
  subject.image = {
    naturalWidth: 8000,
    naturalHeight: 4000,
  } as HTMLImageElement;
  const result = transparentInkImage([subject]);
  expect(result.width).toBe(2048);
  expect(result.height).toBe(1024);
  expect(contexts[1].drawImage).toHaveBeenCalledWith(
    subject.image,
    0,
    0,
    256,
    128,
  );
});
