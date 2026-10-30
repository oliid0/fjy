import Paper from "@mui/material/Paper";
import Dialog from "@mui/material/Dialog";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import type { ComponentPropsWithoutRef } from "react";

/** Tool pickers use their trigger; settings use MUI's viewport-centered modal. */
export const MaterialPanel = forwardRef<
  HTMLElement,
  ComponentPropsWithoutRef<"section"> & {
    centered?: boolean;
    onDismiss?: () => void;
  }
>(({ centered, onDismiss, children, ...props }, ref) => {
  const panel = useRef<HTMLElement>(null);
  useImperativeHandle(ref, () => panel.current!);
  useEffect(() => {
    if (!centered && props.role === "dialog") {
      panel.current?.focus({ preventScroll: true });
    }
  }, [centered, props.role]);
  return centered ? (
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
          ref: panel,
          sx: {
            // Dialog's maxWidth=false still imposes a 64px viewport gutter.
            // Let the factory panels' own widths and responsive margins apply.
            maxWidth: "calc(100% - 24px)",
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
      ref={panel}
      tabIndex={props.role === "dialog" ? -1 : undefined}
      elevation={8}
      {...props}
      sx={{
        color: "var(--fc-ink)",
        backgroundColor: "var(--fc-surface)",
        backgroundImage: "none",
        fontFamily: "inherit",
        "&:focus": { outline: "none" },
      }}
    >
      {children}
    </Paper>
  );
});
