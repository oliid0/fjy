import handwriting from "./hw.ttf";

import type { FcboardFontFaceDescriptor } from "../Fonts";

/** HAlphabetObject uses this exact asset from the reference, not a substitute handwriting font. */
export const FactoryHandwritingFontFaces: FcboardFontFaceDescriptor[] = [
  { uri: handwriting },
];
