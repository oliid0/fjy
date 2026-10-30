import type { NonDeletedFcboardElement } from "@fcboard/element/types";

export type ChartElements = readonly NonDeletedFcboardElement[];

export interface Spreadsheet {
  title: string | null;
  labels: string[] | null;
  series: SpreadsheetSeries[];
}

export interface SpreadsheetSeries {
  title: string | null;
  values: number[];
}

export type ParseSpreadsheetResult =
  | { ok: false; reason: string }
  | { ok: true; data: Spreadsheet };
