import { useEffect, useRef } from "react";
import { DocxEditor } from "@eigenpal/docx-editor-react";
import { t } from "@fcboard/fcboard/i18n";

import "@eigenpal/docx-editor-react/styles.css";

import type { DocxEditorRef } from "@eigenpal/docx-editor-react";
import type { ReactNode } from "react";

export const WordOfficeView = ({
  file,
  name,
  dark,
  actions,
  onSave,
  registerDraft,
  onError,
  onActivity,
}: {
  file: Blob;
  name: string;
  dark: boolean;
  actions: ReactNode;
  onSave: (value: Blob) => void;
  registerDraft: (flush?: () => Promise<Blob | undefined>) => void;
  onError: (error: Error) => void;
  onActivity: () => void;
}) => {
  const editor = useRef<DocxEditorRef>(null);
  const dirty = useRef(false);
  useEffect(() => {
    registerDraft(async () => {
      if (!dirty.current) {
        return;
      }
      const buffer = await editor.current?.save();
      if (!buffer) {
        throw new Error(t("fcboard.could_not_capture_document"));
      }
      return new Blob([buffer]);
    });
    return () => registerDraft();
  }, [registerDraft]);
  return (
    <div
      className="fc-word-office"
      onScrollCapture={onActivity}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <DocxEditor
        ref={editor}
        documentBuffer={file}
        documentName={name}
        documentNameEditable={false}
        showFileOpen={false}
        showHelpMenu={false}
        colorMode={dark ? "dark" : "light"}
        renderTitleBarRight={() => actions}
        onEditorViewReady={onActivity}
        onError={onError}
        onSave={(content) => onSave(new Blob([content]))}
        onChange={() => {
          dirty.current = true;
          onActivity();
        }}
        loadingIndicator={<div role="status">{t("fcboard.processing")}</div>}
      />
    </div>
  );
};
