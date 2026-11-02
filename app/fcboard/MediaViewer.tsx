import { useEffect, useRef, useState } from "react";

import { MaterialPanel } from "./MaterialPanel";

export const MediaViewer = ({
  file,
  onClose,
}: {
  file: File;
  onClose: () => void;
}) => {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const value = URL.createObjectURL(file);
    setUrl(value);
    setError("");
    return () => URL.revokeObjectURL(value);
  }, [file]);
  return (
    <MaterialPanel
      centered
      role="dialog"
      aria-label="多媒体"
      className="fc-media-viewer fc-surface"
      onDismiss={onClose}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header>
        <strong>{file.name}</strong>
        <button onClick={onClose}>关闭</button>
      </header>
      <video
        ref={video}
        controls
        autoPlay
        playsInline
        src={url || undefined}
        onError={() =>
          setError(
            "此媒体无法播放，请检查文件格式及系统解码器。建议使用MP4/H.264或MP3格式。",
          )
        }
      />
      <button
        onClick={() => {
          void video.current
            ?.requestFullscreen()
            .catch((failure) => setError(String(failure)));
        }}
      >
        全屏播放
      </button>
      {error && <p role="alert">{error}</p>}
    </MaterialPanel>
  );
};
