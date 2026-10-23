import Paper from "@mui/material/Paper";
import { forwardRef } from "react";

import type { ComponentPropsWithoutRef } from "react";

/** Shared MUI surface; the existing anchored-panel hook owns canvas-relative placement. */
export const MaterialPanel = forwardRef<
  HTMLElement,
  ComponentPropsWithoutRef<"section">
>((props, ref) => (
  <Paper
    component="section"
    ref={ref}
    elevation={8}
    {...props}
    sx={{
      color: "var(--fc-ink)",
      backgroundColor: "var(--fc-surface)",
      backgroundImage: "none",
      fontFamily: "inherit",
    }}
  />
));
