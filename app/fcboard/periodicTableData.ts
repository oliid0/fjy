import { t } from "@fcboard/fcboard/i18n";

import type { TranslationKeys } from "@fcboard/fcboard/i18n";

import elements from "./periodic-elements.json";

export const periodicElements = elements;
export type PeriodicElement = typeof elements[number];
export const periodicColors: Record<string, string> = {
  nonmetal: "#a78bfa",
  noble_gas: "#f6c177",
  halogen: "#f472b6",
  alkali_metal: "#f97373",
  alkaline_earth: "#fdba74",
  metalloid: "#67e8f9",
  metal: "#a3e635",
  transition_metal: "#facc15",
  lanthanide: "#5eead4",
  actinide: "#f0abfc",
};
export const periodicName = (element: PeriodicElement) =>
  t(`fcboard.periodic.names.${element.atomicNumber}` as TranslationKeys);
export const periodicCategory = (category: string) =>
  t(`fcboard.periodic.categories.${category}` as TranslationKeys);

/** PeriodicTableView's rows, columns, 2dp gaps and 0.88 cell aspect ratio.
 * Its decompiled getElementRect has broken return branches; these coordinates
 * retain its explicit group/period and detached-series arithmetic. */
export const periodicPosition = (element: PeriodicElement) => {
  const number = element.atomicNumber;
  if (number >= 57 && number <= 71) {
    return { column: number - 57 + 4, row: 8 };
  }
  if (number >= 89 && number <= 103) {
    return { column: number - 89 + 4, row: 9 };
  }
  return { column: element.group, row: element.period };
};
export const periodicMetrics = (width: number, height: number) => {
  const available = Math.max(1, height - 12 - 48 - 12 - 10);
  const cellWidth = Math.max(
    30,
    Math.min((width - 20 - 34) / 18, (available - 16) / 9 / 0.88),
  );
  const cellHeight = cellWidth * 0.88;
  return {
    cellWidth,
    cellHeight,
    x: (width - (cellWidth * 18 + 34)) / 2,
    y: 60 + Math.max(6, (available - (cellHeight * 9 + 16)) / 2),
  };
};

/** PeriodicTableDialogFragment.createSelectedElementBitmap, as a portable SVG.
 * The existing board-image pipeline handles storage, erasing and undo. */
export const periodicElementSvg = (element: PeriodicElement) => {
  const xml = document.implementation.createDocument(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  const root = xml.documentElement;
  root.setAttribute("width", "220");
  root.setAttribute("height", "180");
  root.setAttribute("viewBox", "0 0 220 180");
  const add = (
    tag: string,
    attrs: Record<string, string | number>,
    text?: string,
  ) => {
    const node = xml.createElementNS(root.namespaceURI, tag);
    for (const [key, value] of Object.entries(attrs)) {
      node.setAttribute(key, String(value));
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    root.append(node);
  };
  add("rect", {
    x: 4,
    y: 4,
    width: 212,
    height: 172,
    rx: 18,
    fill: periodicColors[element.category],
    stroke: "#2563eb",
    "stroke-width": 2,
  });
  for (const [text, x, y, size, anchor, weight] of [
    [String(element.atomicNumber), 20, 34, 18, "start", "bold"],
    [element.symbol, 110, 105, 76, "middle", "bold"],
    [periodicName(element), 110, 135, 22, "middle", "bold"],
    [element.atomicWeight, 110, 160, 17, "middle", "normal"],
  ] as const) {
    add(
      "text",
      {
        x,
        y,
        "font-size": size,
        "text-anchor": anchor,
        "font-weight": weight,
        fill: "#0f172a",
        "font-family": "sans-serif",
      },
      text,
    );
  }
  return new XMLSerializer().serializeToString(xml);
};
