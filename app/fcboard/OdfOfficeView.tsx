import { useEffect, useRef } from "react";
import { FilePreviewer } from "@dukeofwest/universal-file-preview";

export const OdfOfficeView = ({
  blob,
  name,
  onActivity,
  onError,
}: {
  blob: Blob;
  name: string;
  onActivity: () => void;
  onError: (failure: unknown) => void;
}) => {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onActivity, onError });
  callbacks.current = { onActivity, onError };
  useEffect(() => {
    if (!host.current) {
      return;
    }
    let active = true;
    const preview = new FilePreviewer({
      container: host.current,
      file: { name, source: blob },
      download: false,
      toolbar: false,
    });
    void preview
      .open()
      .then(() => {
        if (active) {
          callbacks.current.onActivity();
        }
      })
      .catch((error) => {
        if (active) {
          callbacks.current.onError(error);
        }
      });
    return () => {
      active = false;
      preview.destroy();
    };
  }, [blob, name]);
  return (
    <div ref={host} className="fc-odf-office" onScrollCapture={onActivity} />
  );
};
