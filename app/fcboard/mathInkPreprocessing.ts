/*!
 * ink-on 0.1.0 src/core/preprocessing.ts, kimseungdae.
 * Extracted unchanged from the installed source map to keep ONNX/OpenCV off
 * the UI thread; inference stays in the existing dedicated worker.
 * https://github.com/kimseungdae/ink-on
 * SPDX-License-Identifier: Apache-2.0
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to the Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by the Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding any notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   Copyright 2025 kimseungdae

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.

 */
export interface StrokePoint {
  x: number;
  y: number;
}

export interface Stroke {
  points: StrokePoint[];
  lineWidth: number;
}

export interface PreprocessResult {
  tensor: Float32Array;
  height: number;
  width: number;
  mask: Uint8Array;
  maskHeight: number;
  maskWidth: number;
}

const MODEL_H = 256;
const MAX_W = 1024;
const MIN_W = 128;
const W_ALIGN = 64; // align width to multiple of 64 for conv/pool layers
const TARGET_H = 128; // CROHME images avg ~107px height; scale content to this range
const PAD = 16;

let _rawCanvas: HTMLCanvasElement | null = null;
let _targetCanvas: HTMLCanvasElement | null = null;

function createCanvas(
  w: number,
  h: number,
  cache?: "raw" | "target",
): HTMLCanvasElement {
  const fw = Math.max(1, Math.floor(w));
  const fh = Math.max(1, Math.floor(h));
  if (cache) {
    const ref = cache === "raw" ? _rawCanvas : _targetCanvas;
    if (ref && ref.width === fw && ref.height === fh) {
      return ref;
    }
  }
  const c = document.createElement("canvas");
  c.width = fw;
  c.height = fh;
  if (cache === "raw") {
    _rawCanvas = c;
  } else if (cache === "target") {
    _targetCanvas = c;
  }
  return c;
}

export function resamplePoints(
  points: StrokePoint[],
  interval: number = 3,
): StrokePoint[] {
  if (points.length < 2) {
    return points;
  }
  const resampled: StrokePoint[] = [points[0]!];
  let remaining = interval;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= remaining) {
      remaining -= dist;
      continue;
    }
    let covered = remaining;
    while (covered <= dist) {
      const t = covered / dist;
      resampled.push({
        x: prev.x + dx * t,
        y: prev.y + dy * t,
      });
      covered += interval;
    }
    remaining = covered - dist;
  }
  resampled.push(points[points.length - 1]!);
  return resampled;
}

function computeBBox(strokes: Stroke[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of strokes) {
    for (const p of s.points) {
      if (p.x < minX) {
        minX = p.x;
      }
      if (p.y < minY) {
        minY = p.y;
      }
      if (p.x > maxX) {
        maxX = p.x;
      }
      if (p.y > maxY) {
        maxY = p.y;
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

function renderStrokes(strokes: Stroke[]): HTMLCanvasElement {
  const bbox = computeBBox(strokes);
  const rawW = Math.max(1, Math.ceil(bbox.maxX - bbox.minX));
  const rawH = Math.max(1, Math.ceil(bbox.maxY - bbox.minY));
  const canvas = createCanvas(rawW + PAD * 2, rawH + PAD * 2, "raw");
  const ctx = canvas.getContext("2d")!;

  // CROHME convention: black background, white strokes
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#ffffff";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const stroke of strokes) {
    if (stroke.points.length === 0) {
      continue;
    }
    const pts = resamplePoints(stroke.points);
    ctx.beginPath();
    ctx.lineWidth = Math.max(2, stroke.lineWidth);
    const first = pts[0]!;
    ctx.moveTo(first.x - bbox.minX + PAD, first.y - bbox.minY + PAD);

    if (
      pts.length === 1 ||
      pts.every((point) => point.x === first.x && point.y === first.y)
    ) {
      ctx.arc(
        first.x - bbox.minX + PAD,
        first.y - bbox.minY + PAD,
        ctx.lineWidth / 2,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    } else if (pts.length === 2) {
      ctx.lineTo(pts[1]!.x - bbox.minX + PAD, pts[1]!.y - bbox.minY + PAD);
    } else if (pts.length > 2) {
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i]!.x + pts[i + 1]!.x) / 2 - bbox.minX + PAD;
        const my = (pts[i]!.y + pts[i + 1]!.y) / 2 - bbox.minY + PAD;
        ctx.quadraticCurveTo(
          pts[i]!.x - bbox.minX + PAD,
          pts[i]!.y - bbox.minY + PAD,
          mx,
          my,
        );
      }
      const last = pts[pts.length - 1]!;
      ctx.lineTo(last.x - bbox.minX + PAD, last.y - bbox.minY + PAD);
    }
    ctx.stroke();
  }
  return canvas;
}

function scaleToFit(src: HTMLCanvasElement): {
  canvas: HTMLCanvasElement;
  contentH: number;
  contentW: number;
  canvasW: number;
} {
  // Scale content to TARGET_H height (matching CROHME training proportions)
  const scale = Math.min(TARGET_H / src.height, MAX_W / src.width);
  const dw = Math.max(1, Math.round(src.width * scale));
  const dh = Math.max(1, Math.round(src.height * scale));

  // Dynamic width: content width + margin, aligned to W_ALIGN, clamped to [MIN_W, MAX_W]
  const canvasW = Math.min(
    MAX_W,
    Math.max(MIN_W, Math.ceil((dw + PAD) / W_ALIGN) * W_ALIGN),
  );

  const target = createCanvas(canvasW, MODEL_H, "target");
  const ctx = target.getContext("2d")!;

  // Black background (matching CROHME training data)
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvasW, MODEL_H);

  // Top-left alignment (CROHME training convention, NOT centered)
  ctx.drawImage(src, 0, 0, dw, dh);

  return { canvas: target, contentH: dh, contentW: dw, canvasW };
}

function canvasToGrayscaleTensor(canvas: HTMLCanvasElement): Float32Array {
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  const pixels = canvas.width * canvas.height;
  const tensor = new Float32Array(pixels);

  for (let i = 0; i < pixels; i++) {
    const offset = i * 4;
    const gray =
      (data[offset]! * 0.299 +
        data[offset + 1]! * 0.587 +
        data[offset + 2]! * 0.114) /
      255;
    tensor[i] = gray;
  }
  return tensor;
}

const MIN_STROKE_SIZE = 8; // minimum bbox dimension in canvas pixels
const MIN_TOTAL_POINTS = 6; // minimum total points across all strokes
const MIN_PATH_LENGTH = 15; // minimum total path length in canvas pixels

export function isStrokeMeaningful(strokes: Stroke[]): boolean {
  if (strokes.length === 0) {
    return false;
  }
  const bbox = computeBBox(strokes);
  const w = bbox.maxX - bbox.minX;
  const h = bbox.maxY - bbox.minY;
  if (w < MIN_STROKE_SIZE && h < MIN_STROKE_SIZE) {
    return false;
  }

  // Check total points — dots/taps have very few points
  let totalPoints = 0;
  let totalLength = 0;
  for (const s of strokes) {
    totalPoints += s.points.length;
    for (let i = 1; i < s.points.length; i++) {
      const dx = s.points[i]!.x - s.points[i - 1]!.x;
      const dy = s.points[i]!.y - s.points[i - 1]!.y;
      totalLength += Math.sqrt(dx * dx + dy * dy);
    }
  }
  return totalPoints >= MIN_TOTAL_POINTS && totalLength >= MIN_PATH_LENGTH;
}

export function preprocessStrokes(strokes: Stroke[]): PreprocessResult {
  const rawCanvas = renderStrokes(strokes);
  const { canvas, contentH, contentW, canvasW } = scaleToFit(rawCanvas);
  const tensor = canvasToGrayscaleTensor(canvas);

  // Mask: 1 = padding, 0 = valid content area
  const mask = new Uint8Array(MODEL_H * canvasW);
  for (let y = 0; y < MODEL_H; y++) {
    for (let x = 0; x < canvasW; x++) {
      mask[y * canvasW + x] = y < contentH && x < contentW ? 0 : 1;
    }
  }

  return {
    tensor,
    height: MODEL_H,
    width: canvasW,
    mask,
    maskHeight: MODEL_H,
    maskWidth: canvasW,
  };
}
