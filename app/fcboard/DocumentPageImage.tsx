import { useEffect, useState } from "react";

import type { CSSProperties } from "react";
import type { DocumentReader } from "./documentReader";

export const DocumentPageImage = ({
  reader,
  index,
  style,
}: {
  reader: DocumentReader;
  index: number;
  style: CSSProperties;
}) => {
  const [image, setImage] = useState("");
  useEffect(() => {
    const request = new AbortController();
    let url: string | undefined;
    const timer = setTimeout(() => {
      void reader
        .render(index, 480, request.signal)
        .then((frame) => {
          if (frame.image && !request.signal.aborted) {
            url = URL.createObjectURL(frame.image);
            setImage(url);
          }
        })
        .catch(() => {});
    }, 80);
    return () => {
      request.abort();
      clearTimeout(timer);
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [reader, index]);
  return (
    <div aria-hidden="true" className="fc-document-page-neighbor" style={style}>
      {image && <img src={image} alt="" draggable={false} />}
    </div>
  );
};
