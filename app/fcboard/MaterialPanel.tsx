import Paper from "@mui/material/Paper";
import Dialog from "@mui/material/Dialog";
import { forwardRef } from "react";

import type { ComponentPropsWithoutRef } from "react";

/** Tool pickers use their trigger; settings use MUI's viewport-centered modal. */
export const MaterialPanel = forwardRef<
  HTMLElement,
  ComponentPropsWithoutRef<"section"> & {
    centered?: boolean;
    onDismiss?: () => void;
  }
>(({ centered, onDismiss, children, ...props }, ref) =>
  centered ? (
    <Dialog
      open
      disablePortal
      maxWidth={false}
      onClose={onDismiss}
      aria-label={props["aria-label"]}
      slotProps={{
        paper: {
          component: "section",
          ...props,
          ref,
          sx: {
            color: "var(--fc-ink)",
            backgroundColor: "var(--fc-surface)",
            backgroundImage: "none",
            fontFamily: "inherit",
          },
        },
      }}
    >
      {children}
    </Dialog>
  ) : (
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
    >
      {children}
    </Paper>
  ),
);
