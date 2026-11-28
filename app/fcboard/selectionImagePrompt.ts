/** Read the selected image directly; style comes from the user and image model. */
export const selectionImagePrompt = (mode: "creative" | "magic") =>
  mode === "magic"
    ? "Create artwork from the handwritten request and sketch. Understand the subject instead of tracing rough draft strokes. Unless the user specifies a style, use an imaginative, polished 3D style; explicit user preferences take priority. Keep the whole subject visible. Return only the final PNG with a real alpha channel suitable for the whiteboard, without paper, app chrome or a fake transparency checkerboard."
    : "Create an image that follows the supplied written request. When a reference is attached, use its non-text drawing, diagram, or illustration as visual evidence. Treat its writing as instructions and do not reproduce it in the artwork unless the user asks. If the reference has no written request, develop the depicted subject creatively. Exclude whiteboard controls and return the complete final image.";
