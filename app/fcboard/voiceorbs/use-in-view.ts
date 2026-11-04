import { useEffect, useRef } from "react";

import type { RefObject } from "react";

export const observeActivity = (
  el: Element,
  onChange: (active: boolean) => void,
): (() => void) => {
  let inView = true;
  let pageVisible = document.visibilityState === "visible";
  let active = inView && pageVisible;

  const sync = () => {
    const next = inView && pageVisible;
    if (next === active) {
      return;
    }
    active = next;
    onChange(next);
  };

  const observer =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver((entries) => {
          inView = entries[entries.length - 1]?.isIntersecting ?? true;
          sync();
        });
  observer?.observe(el);

  const onVisibility = () => {
    pageVisible = document.visibilityState === "visible";
    sync();
  };
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    observer?.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
  };
};

export const useInView = (
  ref: RefObject<Element | null>,
  onChange?: (active: boolean) => void,
): RefObject<boolean> => {
  const activeRef = useRef(true);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const unobserve = observeActivity(el, (active) => {
      activeRef.current = active;
      onChangeRef.current?.(active);
    });
    return () => {
      unobserve();
      activeRef.current = true;
    };
  }, [ref]);

  return activeRef;
};

/*
Adapted from voiceorbs Siri Sheet and its animation helpers.
MIT License
Copyright (c) 2026 Alexis Munoz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
