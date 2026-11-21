import { useEffect, useRef, useState } from "react";
import { FONT_FAMILY, getFontString } from "@fcboard/common";
import { t } from "@fcboard/fcboard/i18n";

import { documentStrokeBounds } from "./documents";

import type { InkStroke } from "./documents";

/** Edit in the document's SVG coordinate system without re-rasterizing the page. */
export const DocumentTextEditor = ({
  stroke,
  onSubmit,
  onCancel,
}: {
  stroke: InkStroke;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) => {
  const [text, setText] = useState(stroke.text || "");
  const input = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const bounds = documentStrokeBounds({ ...stroke, text: text || " " });
  const size = stroke.fontSize || 26;
  const submit = () => {
    if (!done.current) {
      done.current = true;
      onSubmit(text);
    }
  };
  return (
    <foreignObject
      x={stroke.points[0][0]}
      y={stroke.points[0][1]}
      width={Math.max(size * 3, bounds.right - bounds.left + size)}
      height={
        Math.max(
          size * (stroke.lineHeight || 1.3),
          bounds.bottom - bounds.top,
        ) + 4
      }
    >
      <textarea
        ref={input}
        className="fc-document-text-editor"
        aria-label={t("buttons.edit")}
        value={text}
        style={{
          width: "100%",
          height: "100%",
          boxSizing: "border-box",
          margin: 0,
          padding: 0,
          border: 0,
          outline: "1px solid #0368ff",
          resize: "none",
          overflow: "hidden",
          background: "transparent",
          color: stroke.color,
          opacity: (stroke.opacity ?? 100) / 100,
          font: getFontString({
            fontSize: size,
            fontFamily: stroke.fontFamily || FONT_FAMILY.Helvetica,
            fontWeight: stroke.fontWeight,
          }),
          lineHeight: stroke.lineHeight || 1.3,
          whiteSpace: "pre",
        }}
        onChange={(event) => setText(event.target.value)}
        onBlur={submit}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            done.current = true;
            onCancel();
          } else if (
            event.key === "Enter" &&
            (event.ctrlKey || event.metaKey)
          ) {
            event.preventDefault();
            submit();
          }
        }}
      />
    </foreignObject>
  );
};
