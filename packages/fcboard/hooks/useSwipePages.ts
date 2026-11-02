import { useRef } from "react";

import { DRAGGING_THRESHOLD } from "@fcboard/common";

import type { Dispatch, SetStateAction, PointerEvent, MouseEvent } from "react";

/** Bind only to the paged choices; sliders and other controls stay outside. */
export const useSwipePages = (
  setPage: Dispatch<SetStateAction<number>>,
  pageCount: number,
) => {
  const swipe = useRef<
    | {
        id: number;
        x: number;
        y: number;
        axis?: "x" | "y";
      }
    | undefined
  >(undefined);
  const swipedClick = useRef(false);
  return {
    onPointerDownCapture: (event: PointerEvent<HTMLElement>) => {
      swipedClick.current = false;
      swipe.current =
        event.isPrimary && event.button === 0
          ? { id: event.pointerId, x: event.clientX, y: event.clientY }
          : undefined;
    },
    onPointerMoveCapture: (event: PointerEvent<HTMLElement>) => {
      const current = swipe.current;
      if (!current || current.id !== event.pointerId) {
        return;
      }
      const x = Math.abs(event.clientX - current.x);
      const y = Math.abs(event.clientY - current.y);
      if (!current.axis && Math.max(x, y) > DRAGGING_THRESHOLD) {
        current.axis = x > y ? "x" : "y";
        if (current.axis === "x") {
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }
      }
      if (current.axis === "x") {
        event.preventDefault();
      }
    },
    onPointerUpCapture: (event: PointerEvent<HTMLElement>) => {
      const current = swipe.current;
      if (!current || current.id !== event.pointerId) {
        return;
      }
      swipe.current = undefined;
      swipedClick.current = current.axis === "x";
      const distance = event.clientX - current.x;
      if (current.axis === "x" && Math.abs(distance) > DRAGGING_THRESHOLD) {
        event.preventDefault();
        const direction =
          getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1;
        setPage((page) =>
          Math.max(
            0,
            Math.min(pageCount - 1, page + (distance * direction < 0 ? 1 : -1)),
          ),
        );
      }
    },
    onPointerCancelCapture: () => {
      swipedClick.current = swipe.current?.axis === "x";
      swipe.current = undefined;
    },
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (swipedClick.current && event.detail > 0) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
};
