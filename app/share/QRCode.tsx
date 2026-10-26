import { useEffect, useState } from "react";
import Spinner from "@excalidraw/excalidraw/components/Spinner";
import { useI18n } from "@excalidraw/excalidraw/i18n";

interface QRCodeProps {
  value: string;
}

export const QRCode = ({ value }: QRCodeProps) => {
  const { t } = useI18n();
  const [svgData, setSvgData] = useState<string | null>(null);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;

    import("./qrcode.chunk")
      .then(({ generateQRCodeSVG }) => {
        if (mounted) {
          try {
            setSvgData(generateQRCodeSVG(value));
          } catch {
            setError(true);
          }
        }
      })
      .catch(() => {
        if (mounted) {
          setError(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, [value]);

  if (error) {
    return null;
  }

  if (!svgData) {
    return (
      <div className="ShareDialog__active__qrcode ShareDialog__active__qrcode--loading">
        <Spinner />
      </div>
    );
  }

  return (
    <div
      className="ShareDialog__active__qrcode"
      role="img"
      aria-label={t("fcboard.scan_to_open_link")}
      dangerouslySetInnerHTML={{ __html: svgData }}
    />
  );
};
