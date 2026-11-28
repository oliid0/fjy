import { useEffect, useRef, useState } from "react";
import { t, useI18n } from "@fcboard/fcboard/i18n";
import { exportToFileIcon } from "@fcboard/fcboard/components/icons";

import spreadsheetScript from "x-data-spreadsheet/dist/xspreadsheet.js?url";
import spreadsheetZh from "x-data-spreadsheet/dist/locale/zh-cn.js?url";
import spreadsheetCss from "x-data-spreadsheet/dist/xspreadsheet.css?inline";

import type { ReactNode } from "react";
import type { SheetData } from "x-data-spreadsheet";

import type { OfficeSheet } from "./officeSheets";

const layout = `
  html,body { margin:0; overflow:hidden; overscroll-behavior:none; }
  .x-spreadsheet { display:flex; flex-direction:column; height:100dvh; }
  .x-spreadsheet-sheet { order:-1; }
  .x-spreadsheet-toolbar {
    display:flex; align-items:center; min-width:0;
    max-width:calc(100vw - 202px); margin:0; padding-inline-start:6px;
  }
  .x-spreadsheet-toolbar-btns { display:flex; align-items:center; }
  [data-dark] { filter:invert(.9) hue-rotate(180deg); background:#fff; }
`;

export const SheetOfficeView = ({
  page,
  dark,
  actions,
  onFocus,
  onChange,
  onSave,
  onActivity,
  onError,
}: {
  page: OfficeSheet;
  dark: boolean;
  actions: ReactNode;
  onFocus: () => void;
  onChange: (data: SheetData) => void;
  onSave: () => void;
  onActivity: () => void;
  onError: (error: unknown) => void;
}) => {
  const { langCode } = useI18n();
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const callbacks = useRef({
    page,
    onFocus,
    onChange,
    onSave,
    onActivity,
    onError,
    dark,
  });
  callbacks.current = {
    page,
    onFocus,
    onChange,
    onSave,
    onActivity,
    onError,
    dark,
  };
  useEffect(() => {
    const root = frame.current?.contentDocument?.documentElement;
    if (root) {
      root.toggleAttribute("data-dark", dark);
    }
  }, [dark]);
  useEffect(() => {
    setReady(false);
    const node = frame.current;
    if (!node) {
      return;
    }
    const doc = node.contentDocument;
    const win = node.contentWindow;
    if (!doc || !win) {
      return;
    }
    let disposed = false;
    const script = (url: string) =>
      new Promise<void>((resolve, reject) => {
        const tag = doc.createElement("script");
        tag.src = url;
        tag.onload = () => resolve();
        tag.onerror = () =>
          reject(new Error(t("fcboard.this_file_has_no_displayable_pages")));
        doc.head.append(tag);
      });
    const style = doc.createElement("style");
    style.textContent = spreadsheetCss + layout;
    doc.head.replaceChildren(style);
    const root = doc.createElement("div");
    doc.body.replaceChildren(root);
    const activity = () => callbacks.current.onActivity();
    const focus = () => callbacks.current.onFocus();
    const keys = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        callbacks.current.onSave();
      }
    };
    doc.addEventListener("pointerdown", focus, true);
    doc.addEventListener("scroll", activity, true);
    doc.addEventListener("keydown", keys, true);
    doc.documentElement.toggleAttribute("data-dark", callbacks.current.dark);
    void (async () => {
      await script(spreadsheetScript);
      if (disposed) {
        return;
      }
      if (langCode.startsWith("zh")) {
        await script(spreadsheetZh);
        if (disposed) {
          return;
        }
        const translate = win.x_spreadsheet as typeof win.x_spreadsheet & {
          locale: (value: string) => void;
        };
        translate.locale("zh-cn");
      }
      const { data, start, end } = callbacks.current.page;
      const pane = win.x_spreadsheet(root, {
        showBottomBar: false,
        row: { len: Math.max(26, end - start + 1), height: 25 },
        view: {
          height: () => Math.max(130, win.innerHeight),
          width: () => Math.max(160, win.innerWidth),
        },
      });
      pane.loadData(structuredClone(data)).change((updated) => {
        callbacks.current.onChange(structuredClone(updated) as SheetData);
        activity();
      });
      setReady(true);
      activity();
    })().catch((error) => {
      if (!disposed) {
        callbacks.current.onError(error);
      }
    });
    return () => {
      disposed = true;
      doc.removeEventListener("pointerdown", focus, true);
      doc.removeEventListener("scroll", activity, true);
      doc.removeEventListener("keydown", keys, true);
    };
  }, [langCode]);
  return (
    <div className="fc-sheet-office">
      <iframe
        ref={frame}
        title={page.name}
        sandbox="allow-same-origin allow-scripts"
      />
      <div className="fc-sheet-office-actions">
        <button
          type="button"
          aria-label={t("buttons.save")}
          title={t("buttons.save")}
          disabled={!ready}
          onClick={onSave}
        >
          {exportToFileIcon}
        </button>
        {actions}
      </div>
    </div>
  );
};
