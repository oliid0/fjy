import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { InlineFunctionGraph } from "./InlineFunctionGraph";

import type { ComponentProps } from "react";
import type { FunctionGraphInput } from "./InlineFunctionGraph";

type Props = Omit<
  ComponentProps<typeof InlineFunctionGraph>,
  "inputRef" | "onIdle"
> & {
  selected: boolean;
  preview?: string;
  onSelect?: () => void;
  onReady?: () => void;
  onErasePointer?: (
    event: import("react").PointerEvent<HTMLDivElement>,
  ) => boolean;
};

/** Idle floating objects keep a real hit surface and their saved pixels. Only
 * selected objects or active contacts allocate a live rendering backing store. */
export const FunctionGraphObject = ({
  selected,
  preview,
  onSelect,
  onReady,
  onErasePointer,
  interactive = true,
  ...graph
}: Props) => {
  const [engaged, setEngaged] = useState(false);
  const input = useRef<FunctionGraphInput>(null);
  useLayoutEffect(() => {
    onReady?.();
    return () => onReady?.();
  }, [onReady]);
  return (
    <div
      id={`fc-inline-function-${graph.id}`}
      data-native-resource-object-id={graph.id}
      style={{
        width: "100%",
        height: "100%",
        pointerEvents: interactive ? "auto" : "none",
        touchAction: "none",
      }}
      onPointerDownCapture={(event) => {
        if (onErasePointer?.(event)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onWheel={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        if (
          !interactive ||
          event.button !== 0 ||
          event.target instanceof HTMLCanvasElement
        ) {
          return;
        }
        flushSync(() => {
          onSelect?.();
          setEngaged(true);
        });
        if (input.current?.down(event.nativeEvent)) {
          event.stopPropagation();
        }
      }}
    >
      {selected || engaged ? (
        <InlineFunctionGraph
          {...graph}
          interactive={interactive}
          inputRef={input}
          onIdle={() => setEngaged(false)}
        />
      ) : (
        <img
          src={preview}
          alt={`y = ${graph.plot.expression}`}
          draggable={false}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
};
