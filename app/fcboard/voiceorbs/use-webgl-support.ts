import { useSyncExternalStore } from "react";

let cached: boolean | null = null;

const detect = (): boolean => {
  if (cached !== null) {
    return cached;
  }
  try {
    const canvas = document.createElement("canvas");
    const attributes: WebGLContextAttributes = {
      failIfMajorPerformanceCaveat: true,
    };
    const context = canvas.getContext("webgl", attributes);
    cached = !!context && typeof context.createShader === "function";
  } catch {
    cached = false;
  }
  return cached;
};

const subscribe = (): (() => void) => () => {};
const getSnapshot = (): boolean | null => detect();
const getServerSnapshot = (): boolean | null => null;

export const useWebGLSupport = (): boolean | null =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

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
