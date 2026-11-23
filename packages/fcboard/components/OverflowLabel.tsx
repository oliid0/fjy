import { useLayoutEffect, useRef } from "react";

/** Keep a translated label inside its button and reveal hidden characters. */
export const OverflowLabel = ({ children }: { children: string }) => {
  const label = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const box = label.current!;
    const text = box.firstElementChild as HTMLElement;
    const measure = () => {
      const overflow = Math.max(0, text.offsetWidth - box.clientWidth);
      const rtl = getComputedStyle(box).direction === "rtl";
      box.style.setProperty(
        "--fc-label-shift",
        `${rtl ? overflow : -overflow}px`,
      );
      box.style.setProperty("--fc-label-time", `${2 + overflow / 22}s`);
      box.toggleAttribute("data-overflows", overflow > 0);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(text);
    return () => observer.disconnect();
  }, [children]);
  return (
    <span className="fc-overflow-label" ref={label}>
      <span>{children}</span>
    </span>
  );
};
