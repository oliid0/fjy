import { useMemo } from "react";
import { renderSVG } from "uqr";

import { useI18n } from "@fcboard/fcboard/i18n";

interface QRCodeProps {
  value: string;
}

export const QRCode = ({ value }: QRCodeProps) => {
  const { t } = useI18n();
  const svgData = useMemo(() => {
    try {
      return renderSVG(value);
    } catch {
      return null;
    }
  }, [value]);

  if (!svgData) {
    return <span>{value}</span>;
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
