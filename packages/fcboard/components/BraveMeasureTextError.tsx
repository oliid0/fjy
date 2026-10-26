import { t } from "../i18n";

const BraveMeasureTextError = () => (
  <div data-testid="brave-measure-text-error">
    <p>{t("fcboard.browser_blocked_text_measurement")}</p>
    <a
      href="http://www.fcjyboard.com/"
      target="_blank"
      rel="noopener noreferrer"
    >
      {t("fcboard.fcboard_website")}
    </a>
  </div>
);
export default BraveMeasureTextError;
