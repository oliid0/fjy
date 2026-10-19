import "./ExcalidrawLogo.scss";

const LogoIcon = () => (
  <svg
    viewBox="0 0 40 40"
    fill="none"
    aria-hidden="true"
    className="ExcalidrawLogo-icon"
  >
    <rect width="40" height="40" rx="10" fill="currentColor" />
    <path
      d="M12 29V11h17M12 20h13"
      stroke="white"
      strokeWidth="4"
      strokeLinecap="round"
    />
  </svg>
);
const LogoText = () => (
  <span
    style={{
      fontFamily: "system-ui",
      fontSize: "1.8rem",
      fontWeight: 700,
      marginLeft: 12,
    }}
  >
    Fcboard
  </span>
);

type LogoSize = "xs" | "small" | "normal" | "large" | "custom" | "mobile";

interface LogoProps {
  size?: LogoSize;
  withText?: boolean;
  style?: React.CSSProperties;
  /**
   * If true, the logo will not be wrapped in a Link component.
   * The link prop will be ignored as well.
   * It will merely be a plain div.
   */
  isNotLink?: boolean;
}

export const ExcalidrawLogo = ({
  style,
  size = "small",
  withText,
}: LogoProps) => {
  return (
    <div className={`ExcalidrawLogo is-${size}`} style={style}>
      <LogoIcon />
      {withText && <LogoText />}
    </div>
  );
};
