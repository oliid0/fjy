declare module "nerdamer/all" {
  type Expression = { toString(): string };
  const nerdamer: {
    (expression: string, substitutions?: Record<string, string>): Expression;
    solveEquations(
      expression: string | string[],
      variable?: string | string[],
    ): Expression[] | [string, number | string][];
  };
  export default nerdamer;
}

declare module "legacy-word-binary" {
  const reader: {
    (input: ArrayBuffer): string | null;
    html(input: ArrayBuffer): {
      body: string;
      headers?: string;
      footnotes?: string;
      endnotes?: string;
    } | null;
  };
  export default reader;
}

declare module "@turbodocx/html-to-docx/dist/html-to-docx.browser.esm.js" {
  export { default } from "@turbodocx/html-to-docx";
}

declare module "markdown-it" {
  export default class MarkdownIt {
    constructor(options?: { html?: boolean });
    render(value: string): string;
  }
}

declare module "rtf.js" {
  export const RTFJS: {
    Document: new (input: ArrayBuffer) => { render(): Promise<HTMLElement[]> };
  };
}
