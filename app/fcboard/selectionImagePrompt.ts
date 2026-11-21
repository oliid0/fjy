/** Read the selected image directly; style comes from the user and image model. */
export const selectionImagePrompt = (mode: "creative" | "magic") =>
  mode === "magic"
    ? "Create artwork from the handwritten request and sketch. Understand the subject instead of tracing rough draft strokes. Unless the user specifies a style, use an imaginative, polished 3D style; explicit user preferences take priority. Keep the whole subject visible. Return only the final PNG with a real alpha channel suitable for the whiteboard, without paper, app chrome or a fake transparency checkerboard."
    : "Create freely using the reference image and handwritten requirements. Follow explicit user intent; otherwise choose the content, composition, style and details creatively. Exclude explanatory instructions and whiteboard controls from the artwork. Return the complete final image.";
