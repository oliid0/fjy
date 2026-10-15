import { useEffect, useRef, useState } from "react";

import type { PPTXPreviewer } from "pptx-preview/dist/previewer/PPTXPreviewer";

export const FilePreview = ({
  file,
  onClose,
}: {
  file: File;
  onClose: () => void;
}) => {
  const host = useRef<HTMLDivElement>(null);
  const previewer = useRef<PPTXPreviewer | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const isPptx = /\.pptx$/i.test(file.name);
  const isImage =
    /^image\/(png|jpeg|gif|webp|bmp)$/.test(file.type) ||
    /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name);
  const isPdf = /\.pdf$/i.test(file.name);
  useEffect(() => {
    let active = true;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    if (isPptx) {
      void (async () => {
        try {
          const { init } = await import("pptx-preview");
          const buffer = await file.arrayBuffer();
          if (!active || !host.current) {
            return;
          }
          const width = Math.max(
            280,
            Math.min(960, host.current.clientWidth - 24),
          );
          previewer.current = init(host.current, {
            width,
            height: (width * 9) / 16,
            mode: "slide",
          });
          await previewer.current.preview(buffer);
          if (!active || !host.current) {
            return;
          }
          setPages(previewer.current.slideCount);
        } catch (failure) {
          if (active) {
            setError(`课件预览失败：${String(failure)}`);
          }
        } finally {
          if (active) {
            setLoading(false);
          }
        }
      })();
    } else {
      setLoading(false);
    }
    return () => {
      active = false;
      previewer.current?.destroy();
      previewer.current = null;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file, isPptx]);
  useEffect(() => {
    if (pages) {
      previewer.current?.renderSingleSlide(page);
    }
  }, [page, pages]);
  return (
    <section
      className={`fc-preview ${fullscreen ? "fc-preview--fullscreen" : ""}`}
      role="dialog"
      aria-modal="false"
      aria-label={`预览 ${file.name}`}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          if (fullscreen) {
            setFullscreen(false);
          } else {
            onClose();
          }
        }
      }}
    >
      <header>
        <strong>{file.name}</strong>
        <button onClick={onClose}>关闭预览</button>
      </header>
      {loading && <p role="status">正在解析课件…</p>}
      {error && <p role="alert">{error}</p>}
      {isPptx && <div className="fc-slides" ref={host} />}
      {isImage && <img src={url} alt={file.name} />}
      {isPdf && <iframe src={url} title={file.name} />}
      {!isPptx && !isImage && !isPdf && (
        <p>此格式暂不支持内嵌预览，请下载后使用设备应用打开。</p>
      )}
      <footer>
        {pages > 0 && (
          <>
            <button
              disabled={page === 0}
              onClick={() => setPage((value) => value - 1)}
            >
              上一页
            </button>
            <span>
              {page + 1} / {pages}
            </span>
            <button
              disabled={page >= pages - 1}
              onClick={() => setPage((value) => value + 1)}
            >
              下一页
            </button>
          </>
        )}
        <a href={url} download={file.name}>
          下载文件
        </a>
        <button
          onClick={() => {
            setFullscreen((value) => !value);
          }}
        >
          {fullscreen ? "退出全屏" : "全屏播放"}
        </button>
      </footer>
    </section>
  );
};
