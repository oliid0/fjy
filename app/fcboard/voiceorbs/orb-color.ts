import { hexToRgb } from "./orb-state";

export type Rgb = [number, number, number];

const toLinear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const toSrgb = (v: number): number => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, c * 255));
};

export const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [
  toSrgb(toLinear(a[0]) + (toLinear(b[0]) - toLinear(a[0])) * t),
  toSrgb(toLinear(a[1]) + (toLinear(b[1]) - toLinear(a[1])) * t),
  toSrgb(toLinear(a[2]) + (toLinear(b[2]) - toLinear(a[2])) * t),
];

const hexChannel = (c: number): string =>
  Math.round(c).toString(16).padStart(2, "0");

export const rgbToHex = ([r, g, b]: Rgb): string =>
  `#${hexChannel(r)}${hexChannel(g)}${hexChannel(b)}`;

export const mixHex = (a: string, b: string, t: number): string =>
  rgbToHex(mixRgb(hexToRgb(a), hexToRgb(b), t));

export const shadeHex = (hex: string, t: number): string =>
  mixHex(hex, "#000000", t);

export const tintHex = (hex: string, t: number): string =>
  mixHex(hex, "#ffffff", t);

export const rgba = ([r, g, b]: Rgb, alpha: number): string =>
  `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.min(
    1,
    Math.max(0, alpha),
  ).toFixed(3)})`;

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
